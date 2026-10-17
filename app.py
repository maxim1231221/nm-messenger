"""nm-messenger: простой веб-чат на FastAPI + WebSocket."""

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"
HISTORY_LIMIT = 100
MAX_NAME_LEN = 32
MAX_TEXT_LEN = 2000

app = FastAPI(title="nm-messenger")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ChatRoom:
    def __init__(self) -> None:
        self.clients: Dict[WebSocket, str] = {}
        self.history: deque = deque(maxlen=HISTORY_LIMIT)

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


room = ChatRoom()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


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
            text = str(data.get("text", "")).strip()[:MAX_TEXT_LEN]
            if not text:
                continue
            message = {"type": "message", "name": name, "text": text, "time": now()}
            room.history.append(message)
            await room.broadcast(message)
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        room.clients.pop(ws, None)
        await room.system(f"{name} вышел из чата")
