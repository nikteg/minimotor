import { createNetMeter } from "minimotor/performance";
import { createDebug } from "minimotor/debug";
// A real multiplayer game over WebSocket. Open this page in two (or ten) tabs:
// every tab is a player, relayed through the dev server's /ws-relay endpoint
// (see vite.config.ts — a dumb broadcaster, no game logic on the server).
//
// Demonstrates the whole Net toolkit working together:
// - Net.connect with reconnectMs + heartbeatMs + idleTimeoutMs (dead links are
//   detected and the socket auto-reconnects),
// - transport.trySend from the fixed step (never throws mid-game),
// - Net.createRoster — remote players are tracked, interpolated ~100 ms in the
//   past (blended between snapshots so they glide instead of teleporting at the
//   network's packet rate — we deliberately send at only 20 Hz to prove it),
//   and pruned when they go quiet, all in one helper,
// - Perf.createNetMeter in the HUD for live traffic rates.
import { createAudio } from "minimotor/audio";
import { createNet } from "minimotor/net";
import { createUI } from "minimotor/ui";
import { Mathf, createApp } from "minimotor";

const dec = new TextDecoder();

interface Vec {
  x: number;
  y: number;
}
interface NetMsg {
  game: string;
  id: string;
  bye?: boolean;
  color?: string;
  x: number;
  y: number;
}

const meter = createNetMeter();
// The viewport is LIVE (mutated on resize) — movement clamps read it fresh.
const game = createApp("game", {
  background: "#14141c",
});
createDebug(game, { initial: "performance", perf: { net: meter } });
const vp = game.viewport;
const { Draw, Keys, Loop } = game;
const Audio = createAudio(game);
const Net = createNet(game);
const UI = createUI(game);

const sfx = Audio.sfx({ join: Audio.Recipes.coin() });

const PALETTE = ["#4ecdc4", "#ffd43b", "#ff6b6b", "#69db7c", "#b197fc", "#ffa94d"];
const id = Math.random().toString(36).slice(2, 8);
const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
const me: Vec = { x: Mathf.randRange(80, vp.w - 80), y: Mathf.randRange(80, vp.h - 80) };

const transport = Net.connect({
  url: location.origin.replace(/^http/, "ws") + "/ws-relay",
  reconnectMs: 1000,
  heartbeatMs: 5000, // keep quiet links alive…
  idleTimeoutMs: 15000, // …and declare truly silent ones dead → auto-reconnect
});

// Remote players: the roster owns each peer's snapshot interpolator, last-seen
// stamp, join detection and idle prune; draw() samples it at (now − 100 ms).
// Colors are view-only, so we keep them in a small side map keyed by id.
const others = Net.createRoster<Vec>({ delayMs: 100 });
const colors = new Map<string, string>();

transport.onMessage = (bytes) => {
  if (bytes.length === 0) return; // someone's heartbeat frame — not gameplay
  meter.recv(bytes.length);
  const msg = JSON.parse(dec.decode(bytes)) as NetMsg;
  if (msg.game !== "netgame") return; // /ws-relay hosts several samples
  if (msg.bye) {
    others.remove(msg.id);
    colors.delete(msg.id);
    return;
  }
  const { isNew } = others.update(msg.id, { x: msg.x, y: msg.y });
  if (isNew) {
    if (msg.color) colors.set(msg.id, msg.color);
    sfx.join.play(); // someone joined
  }
};

// Tell the others we're leaving (best effort — the 5s prune catches crashes).
addEventListener("pagehide", () => {
  transport.trySend(new TextEncoder().encode(JSON.stringify({ game: "netgame", id, bye: true })));
});

const SEND_EVERY = 3; // fixed steps → 20 Hz, so the interpolation visibly works
let step = 0;

Loop.run({
  update() {
    const speed = 4.5; // px/step
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

    // Prune players we haven't heard from (closed tabs, dead links); forget
    // their colors too so the side map doesn't leak.
    for (const pid of others.prune()) colors.delete(pid);
  },

  draw() {
    // Remote players — sampled from their snapshot buffers, 100 ms in the past.
    for (const [pid, s] of others.sample()) {
      Draw.circle(s, 16, colors.get(pid) ?? "#8aa");
    }

    // You.
    Draw.circle(me, 16, color);
    const { ctx } = Draw; // raw-ctx escape hatch for the outline ring
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(me.x, me.y, 16, 0, Math.PI * 2);
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
