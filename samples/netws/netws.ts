// WebSocket console: connect to any server and echo messages back and forth.
// Demonstrates: Net.connect — transport.sendJson, transport.onMessage
// (string frames now arrive decoded), transport.onClose and transport.onState.
// No game loop; the engine's networking works standalone.
import { Net, type Transport } from "minimotor";

const dec = new TextDecoder();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const urlEl = $<HTMLInputElement>("url");
// Default to the echo endpoint the dev server hosts (see vite.config.ts) —
// always reachable, unlike public echo services.
urlEl.value = location.origin.replace(/^http/, "ws") + "/ws-echo";
const toggleEl = $<HTMLButtonElement>("toggle");
const sendEl = $<HTMLButtonElement>("send");
const msgEl = $<HTMLInputElement>("msg");
const logEl = $<HTMLPreElement>("log");
const dotEl = $<HTMLSpanElement>("dot");
const stateEl = $<HTMLSpanElement>("state");

let transport: Transport | null = null;

function log(text: string, cls = "meta") {
  const line = document.createElement("span");
  line.className = cls;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}\n`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setState(state: string) {
  dotEl.className = "dot " + state;
  stateEl.textContent = state;
  const connected = state === "connected";
  sendEl.disabled = !connected;
  toggleEl.textContent = state === "closed" || state === "idle" ? "Connect" : "Disconnect";
}

function disconnect() {
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

  // onState fires on every transition — no polling needed to reflect it in the UI.
  transport.onState = (state) => {
    setState(state);
    if (state === "connected") log("connected");
  };
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
