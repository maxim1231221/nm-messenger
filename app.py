"""nm-messenger: простой веб-чат на FastAPI + WebSocket."""

import json
import re
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
HISTORY_FILE = Path(__file__).parent / "history.json"
HISTORY_LIMIT = 100
MAX_NAME_LEN = 32
MAX_TEXT_LEN = 2000
MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_URL_RE = re.compile(r"^/uploads/[0-9a-f]{32}\.(jpg|png|gif|webp)$")

app = FastAPI(title="nm-messenger")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


class ChatRoom:
    def __init__(self) -> None:
        self.clients: Dict[WebSocket, str] = {}
        self.history: deque = deque(load_history(), maxlen=HISTORY_LIMIT)

    def add(self, message: dict) -> None:
        self.history.append(message)
        save_history(self.history)

    def clear(self) -> None:
        for message in self.history:
            image = message.get("image")
            if image:
                (UPLOAD_DIR / Path(image).name).unlink(missing_ok=True)
        self.history.clear()
        save_history(self.history)

    def online(self) -> list:
        return sorted(set(self.clients.values()))

    async def broadcast(self, payload: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                self.clients.pop(ws, None)

    async def system(self, text: str) -> None:
        await self.broadcast({"type": "system", "text": text, "time": now()})
        await self.broadcast({"type": "users", "users": self.online()})


def load_history() -> list:
    """Читает сохранённую историю, чтобы чат не пропадал после перезапуска сервера."""
    try:
        data = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [m for m in data if isinstance(m, dict)] if isinstance(data, list) else []


def save_history(history) -> None:
    # Пишем во временный файл и подменяем, чтобы при сбое не получить обрезанный JSON.
    tmp = HISTORY_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(list(history), ensure_ascii=False), encoding="utf-8")
    tmp.replace(HISTORY_FILE)


room = ChatRoom()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def image_extension(data: bytes) -> Optional[str]:
    """Определяет формат картинки по первым байтам, а не по тому, что прислал клиент."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/upload")
async def upload(request: Request) -> dict:
    if int(request.headers.get("content-length") or 0) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Файл слишком большой (максимум 10 МБ)")
    data = await request.body()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Файл слишком большой (максимум 10 МБ)")
    ext = image_extension(data)
    if ext is None:
        raise HTTPException(415, "Можно отправлять только JPEG, PNG, GIF или WebP")
    filename = f"{uuid.uuid4().hex}.{ext}"
    (UPLOAD_DIR / filename).write_bytes(data)
    return {"url": f"/uploads/{filename}"}


@app.websocket("/ws")
async def chat(ws: WebSocket) -> None:
    await ws.accept()

    # Первое сообщение от клиента — его имя.
    try:
        hello = await ws.receive_json()
    except (WebSocketDisconnect, ValueError):
        return
    name = str(hello.get("name", "")).strip()[:MAX_NAME_LEN]
    if not name:
        await ws.close(code=4000, reason="Имя не указано")
        return

    room.clients[ws] = name
    await ws.send_json({"type": "history", "messages": list(room.history)})
    await room.system(f"{name} вошёл в чат")

    try:
        while True:
            data = await ws.receive_json()
            if data.get("action") == "clear":
                room.clear()
                await room.broadcast({"type": "cleared"})
                await room.system(f"{name} очистил чат")
                continue
            text = str(data.get("text", "")).strip()[:MAX_TEXT_LEN]
            image = str(data.get("image", ""))
            if not IMAGE_URL_RE.match(image):
                image = ""
            if not text and not image:
                continue
            message = {"type": "message", "name": name, "text": text, "time": now()}
            if image:
                message["image"] = image
            room.add(message)
            await room.broadcast(message)
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        room.clients.pop(ws, None)
        await room.system(f"{name} вышел из чата")
