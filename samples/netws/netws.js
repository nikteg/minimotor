// WebSocket console: connect to any server and echo messages back and forth.
// Demonstrates: Minimotor.Net.connect — transport.sendJson, transport.onMessage
// (string frames now arrive decoded), transport.onClose and polling
// transport.state. No game loop; the engine's networking works standalone.
import { Minimotor } from "minimotor";

const { Net } = Minimotor;
const dec = new TextDecoder();

const $ = (id) => document.getElementById(id);
const urlEl = $("url");
// Default to the echo endpoint the dev server hosts (see vite.config.ts) —
// always reachable, unlike public echo services.
urlEl.value = location.origin.replace(/^http/, "ws") + "/ws-echo";
const toggleEl = $("toggle");
const sendEl = $("send");
const msgEl = $("msg");
const logEl = $("log");
const dotEl = $("dot");
const stateEl = $("state");

let transport = null;
let poll = null;

function log(text, cls = "meta") {
  const line = document.createElement("span");
  line.className = cls;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}\n`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setState(state) {
  dotEl.className = "dot " + state;
  stateEl.textContent = state;
  const connected = state === "connected";
  sendEl.disabled = !connected;
  toggleEl.textContent = state === "closed" || state === "idle" ? "Connect" : "Disconnect";
}

function disconnect() {
  if (poll) clearInterval(poll);
  poll = null;
  if (transport) transport.close();
  transport = null;
  setState("closed");
}

function connect() {
  const url = urlEl.value.trim();
  if (!url) return;
  log(`connecting to ${url}`);
  setState("connecting");

  transport = Net.connect({ url });

  transport.onMessage = (bytes) => {
    const text = dec.decode(bytes);
    log(`← ${text}`, "recv");
  };
  transport.onClose = () => {
    log("connection closed");
    disconnect();
  };

  // state is a property, not an event — poll it to reflect open/closed in the UI.
  let last = "connecting";
  poll = setInterval(() => {
    if (!transport) return;
    if (transport.state !== last) {
      last = transport.state;
      setState(last);
      if (last === "connected") log("connected");
    }
  }, 150);
}

toggleEl.addEventListener("click", () => {
  if (transport) disconnect();
  else connect();
});

function send() {
  const text = msgEl.value;
  if (!text || !transport || transport.state !== "connected") return;
  transport.sendJson({ text });
  log(`→ ${JSON.stringify({ text })}`, "sent");
  msgEl.value = "";
}

sendEl.addEventListener("click", send);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

setState("idle");
log("ready — press Connect");
