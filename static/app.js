const $ = (id) => document.getElementById(id);

let ws = null;
let myName = "";

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  myName = $("name").value.trim();
  if (!myName) return;
  try { localStorage.setItem("nm-name", myName); } catch {}
  $("login").hidden = true;
  $("chat").hidden = false;
  connect();
  $("text").focus();
});

try { $("name").value = localStorage.getItem("nm-name") || ""; } catch {}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ name: myName }));
    setStatus("онлайн", true);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "history") {
      $("messages").innerHTML = "";
      data.messages.forEach(addMessage);
    } else if (data.type === "message") {
      addMessage(data);
    } else if (data.type === "system") {
      addSystem(data.text);
    } else if (data.type === "users") {
      renderUsers(data.users);
    }
  };

  ws.onclose = () => {
    setStatus("нет связи, переподключаюсь…", false);
    setTimeout(connect, 2000);
  };
}

$("send-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ text }));
  $("text").value = "";
});

// Фото: выбираешь файл — он уменьшается, загружается на сервер и уходит в чат.
// Текст из поля ввода (если есть) отправляется подписью к фото.
$("photo").addEventListener("change", async () => {
  const file = $("photo").files[0];
  $("photo").value = "";
  if (!file || !ws || ws.readyState !== WebSocket.OPEN) return;

  const label = $("photo").parentElement;
  label.classList.add("busy");
  try {
    const blob = await shrinkImage(file);
    const res = await fetch("/upload", {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Не удалось загрузить фото");
    ws.send(JSON.stringify({ image: data.url, text: $("text").value.trim() }));
    $("text").value = "";
  } catch (err) {
    addSystem(err.message || "Не удалось загрузить фото");
  } finally {
    label.classList.remove("busy");
  }
});

// Уменьшает фото до 1600px по длинной стороне и пережимает в JPEG.
// GIF не трогаем, чтобы не сломать анимацию.
async function shrinkImage(file, maxSide = 1600) {
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

function addMessage({ name, text, image, time }) {
  const li = document.createElement("li");
  li.className = "message" + (name === myName ? " mine" : "");

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${name} · ${formatTime(time)}`;
  li.append(meta);

  if (image) {
    const link = document.createElement("a");
    link.href = image;
    link.target = "_blank";
    link.rel = "noopener";
    const img = document.createElement("img");
    img.src = image;
    img.alt = "Фото";
    img.className = "photo";
    img.addEventListener("load", scrollToBottomIfNear);
    link.append(img);
    li.append(link);
  }

  if (text) {
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;
    li.append(body);
  }

  append(li);
}

let stickToBottom = true;
$("messages").addEventListener("scroll", () => {
  const list = $("messages");
  stickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
});

function scrollToBottomIfNear() {
  if (stickToBottom) $("messages").scrollTop = $("messages").scrollHeight;
}

function addSystem(text) {
  const li = document.createElement("li");
  li.className = "system";
  li.textContent = text;
  append(li);
}

function append(li) {
  const list = $("messages");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(li);
  if (atBottom) list.scrollTop = list.scrollHeight;
}

function renderUsers(users) {
  const list = $("users");
  list.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.textContent = u === myName ? `${u} (ты)` : u;
    list.append(li);
  });
}

function setStatus(text, ok) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("ok", ok);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
