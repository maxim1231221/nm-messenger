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

function addMessage({ name, text, time }) {
  const li = document.createElement("li");
  li.className = "message" + (name === myName ? " mine" : "");

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${name} · ${formatTime(time)}`;

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;

  li.append(meta, body);
  append(li);
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
