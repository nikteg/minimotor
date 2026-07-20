// A real multiplayer game over WebSocket. Open this page in two (or ten) tabs:
// every tab is a player, relayed through the dev server's /ws-relay endpoint
// (see vite.config.ts — a dumb broadcaster, no game logic on the server).
//
// Demonstrates the whole Net toolkit working together:
// - Net.connect with reconnectMs + heartbeatMs + idleTimeoutMs (dead links are
//   detected and the socket auto-reconnects),
// - transport.trySend from the fixed step (never throws mid-game),
// - Net.createInterpolator — remote players are rendered ~100 ms in the past,
//   blended between snapshots, so they glide instead of teleporting at the
//   network's packet rate (we deliberately send at only 20 Hz to prove it),
// - Perf.createNetMeter in the HUD for live traffic rates.
import { Minimotor } from "minimotor";

const meter = Minimotor.Perf.createNetMeter();
let vp = Minimotor.Stage.init("game", {
  plugins: [Minimotor.Perf.plugin({ net: meter })],
});
Minimotor.Stage.onResize((next) => (vp = next)); // movement clamps read vp live
const { Net, Loop, Keys, Draw, Audio, Mathf, UI } = Minimotor;

const PALETTE = ["#4ecdc4", "#ffd43b", "#ff6b6b", "#69db7c", "#b197fc", "#ffa94d"];
const id = Math.random().toString(36).slice(2, 8);
const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
const me = { x: Mathf.randRange(80, vp.w - 80), y: Mathf.randRange(80, vp.h - 80) };

const transport = Net.connect({
  url: location.origin.replace(/^http/, "ws") + "/ws-relay",
  reconnectMs: 1000,
  heartbeatMs: 5000, // keep quiet links alive…
  idleTimeoutMs: 15000, // …and declare truly silent ones dead → auto-reconnect
});

// Remote players: id → { interp, color, lastSeen }. Each one gets a snapshot
// interpolator; draw() samples it at (now − 100 ms).
const others = new Map();

transport.onMessage = (bytes) => {
  if (bytes.length === 0) return; // someone's heartbeat frame — not gameplay
  meter.recv(bytes.length);
  const msg = JSON.parse(new TextDecoder().decode(bytes));
  if (msg.game !== "netgame") return; // /ws-relay hosts several samples
  if (msg.bye) {
    others.delete(msg.id);
    return;
  }
  let p = others.get(msg.id);
  if (!p) {
    p = { interp: Net.createInterpolator({ delayMs: 100 }), color: msg.color };
    others.set(msg.id, p);
    Audio.Sfx.coin(); // someone joined
  }
  p.lastSeen = performance.now();
  p.interp.push({ x: msg.x, y: msg.y });
};

// Tell the others we're leaving (best effort — the 5s prune catches crashes).
addEventListener("pagehide", () => {
  transport.trySend(new TextEncoder().encode(JSON.stringify({ game: "netgame", id, bye: true })));
});

const SEND_EVERY = 3; // fixed steps → 20 Hz, so the interpolation visibly works
let step = 0;

Loop.run({
  update() {
    const speed = 4.5;
    if (Keys.down("ArrowLeft") || Keys.down("KeyA")) me.x -= speed;
    if (Keys.down("ArrowRight") || Keys.down("KeyD")) me.x += speed;
    if (Keys.down("ArrowUp") || Keys.down("KeyW")) me.y -= speed;
    if (Keys.down("ArrowDown") || Keys.down("KeyS")) me.y += speed;
    me.x = Mathf.clamp(me.x, 20, vp.w - 20);
    me.y = Mathf.clamp(me.y, 20, vp.h - 20);

    if (++step % SEND_EVERY === 0) {
      const payload = JSON.stringify({ game: "netgame", id, color, x: me.x, y: me.y });
      // trySend: false while (re)connecting — never throws in the game loop.
      if (transport.trySend(new TextEncoder().encode(payload))) meter.sent(payload.length);
    }

    // Prune players we haven't heard from (closed tabs, dead links).
    const now = performance.now();
    for (const [pid, p] of others) {
      if (now - p.lastSeen > 5000) others.delete(pid);
    }
  },

  draw() {
    const { ctx } = Draw;
    ctx.fillStyle = "#14141c";
    ctx.fillRect(0, 0, vp.w, vp.h);

    // Remote players — sampled from their snapshot buffers, 100 ms in the past.
    for (const p of others.values()) {
      const s = p.interp.sample();
      if (!s) continue;
      ctx.fillStyle = p.color ?? "#8aa";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // You.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(me.x, me.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    UI.text(
      transport.state === "connected"
        ? `connected — ${others.size} other player${others.size === 1 ? "" : "s"}`
        : `(${transport.state}) — is the dev server running?`,
      { x: 12, y: 10, size: 14, color: transport.state === "connected" ? "#6bff9e" : "#ffb454" },
    );
    UI.text("←→↑↓/WASD move — open this page in another tab to multiplayer", {
      x: 12,
      y: 30,
      size: 14,
      color: "dim",
    });
    UI.text("sends at 20 Hz; remote blobs glide via Net.createInterpolator", {
      x: 12,
      y: 48,
      size: 14,
      color: "dim",
    });
  },
});
