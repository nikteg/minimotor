import { createNetMeter } from "minimotor/performance";
import { createDebug } from "minimotor/debug";
// A real multiplayer game over WebSocket — on the BINARY protocol, not JSON.
// Open this page in two (or ten) tabs: every tab is a player, relayed through
// the dev server's /ws-relay endpoint (see vite.config.ts — a dumb,
// byte-transparent broadcaster, no game logic on the server).
//
// Demonstrates the Net toolkit's binary path:
// - Net.connectProtocol with a MessageCodec — every frame is a hand-packed
//   little-endian blob (magic + flags + length-prefixed id + f32 positions),
//   not a JSON.stringify of an object. The codec IS the wire contract: decode()
//   answers `undefined` for any frame it doesn't own (a 0-byte heartbeat,
//   another sample's traffic, a tab still on the old JSON build), so mixed
//   tenants on the shared relay simply ignore each other.
// - reconnectMs + heartbeatMs + idleTimeoutMs (dead links are detected and the
//   socket auto-reconnects),
// - channel.trySend from the fixed step (never throws mid-game),
// - Net.createRoster — remote players are tracked, interpolated ~100 ms in the
//   past (blended between snapshots so they glide instead of teleporting at the
//   network's packet rate — we deliberately send at only 20 Hz to prove it),
//   and pruned when they go quiet, all in one helper,
// - Perf.createNetMeter in the HUD for live traffic rates — fed from the codec,
//   so it counts real binary wire bytes, not a JSON string's length.
import { createAudio } from "minimotor/audio";
import { createNet } from "minimotor/net";
import type { MessageCodec, Protocol } from "minimotor/net";
import { createUI } from "minimotor/ui";
import { Mathf, createApp } from "minimotor";

interface Vec {
  x: number;
  y: number;
}

// The whole wire contract, as a discriminated union. The `game: "netgame"`
// string the JSON version sent is gone — on the wire it's the 2-byte magic
// below, checked once in decode() before any field is read.
type NetMsg =
  | { kind: "pos"; id: string; color?: string; x: number; y: number }
  | { kind: "bye"; id: string };

type NetProto = Protocol<{ client: NetMsg; server: NetMsg }>;

// Wire layout, little-endian. A position frame is 26 bytes where the JSON
// equivalent was ~70:
//   [0]  1  magic hi  0x4e 'N'
//   [1]  1  magic lo  0x47 'G'
//   [2]  1  flags     bit0 = bye, bit1 = hasColor
//   [3]  1  idLen
//   [4]  idLen  id (UTF-8)
//   -- only if NOT bye --
//   -    1  colorLen (only if hasColor)
//   -    colorLen  color (UTF-8, only if hasColor)
//   -    4  x (f32)
//   -    4  y (f32)
const MAGIC_HI = 0x4e;
const MAGIC_LO = 0x47;
const FLAG_BYE = 0x01;
const FLAG_COLOR = 0x02;

const meter = createNetMeter();
const te = new TextEncoder();
const td = new TextDecoder();

const codec: MessageCodec<NetMsg, NetMsg> = {
  encode(msg) {
    const bye = msg.kind === "bye";
    const idBytes = te.encode(msg.id);
    const colorBytes = !bye && msg.color ? te.encode(msg.color) : null;
    const size = 4 + idBytes.length + (colorBytes ? 1 + colorBytes.length : 0) + (bye ? 0 : 8);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let o = 0;
    out[o++] = MAGIC_HI;
    out[o++] = MAGIC_LO;
    let flags = 0;
    if (bye) flags |= FLAG_BYE;
    if (colorBytes) flags |= FLAG_COLOR;
    out[o++] = flags;
    out[o++] = idBytes.length;
    out.set(idBytes, o);
    o += idBytes.length;
    if (colorBytes) {
      out[o++] = colorBytes.length;
      out.set(colorBytes, o);
      o += colorBytes.length;
    }
    if (!bye) {
      view.setFloat32(o, msg.x, true);
      o += 4;
      view.setFloat32(o, msg.y, true);
      o += 4;
    }
    meter.sent(out.length); // wire bytes, not the object's JSON length
    return out;
  },
  decode(frame) {
    const bytes = typeof frame === "string" ? te.encode(frame) : frame;
    // Shorter than magic+flags+idLen, or not carrying our magic, is not ours: a
    // 0-byte heartbeat, another sample's frame on the shared relay, or a tab
    // still on the old JSON build. Drop it — that return is load-bearing.
    if (bytes.length < 4 || bytes[0] !== MAGIC_HI || bytes[1] !== MAGIC_LO) return undefined;
    const flags = bytes[2];
    const idLen = bytes[3];
    if (bytes.length < 4 + idLen) return undefined; // truncated frame
    let o = 4;
    const id = td.decode(bytes.subarray(o, o + idLen));
    o += idLen;
    let msg: NetMsg;
    if (flags & FLAG_BYE) {
      msg = { kind: "bye", id };
    } else {
      let color: string | undefined;
      if (flags & FLAG_COLOR) {
        if (o >= bytes.length) return undefined;
        const colorLen = bytes[o++];
        if (bytes.length < o + colorLen + 8) return undefined;
        color = td.decode(bytes.subarray(o, o + colorLen));
        o += colorLen;
      }
      if (bytes.length < o + 8) return undefined;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const x = view.getFloat32(o, true);
      o += 4;
      const y = view.getFloat32(o, true);
      msg = color !== undefined ? { kind: "pos", id, color, x, y } : { kind: "pos", id, x, y };
    }
    meter.recv(bytes.length);
    return msg;
  },
};

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

const channel = Net.connectProtocol<NetProto>({
  url: location.origin.replace(/^http/, "ws") + "/ws-relay",
  codec,
  reconnectMs: 1000,
  heartbeatMs: 5000, // keep quiet links alive…
  idleTimeoutMs: 15000, // …and declare truly silent ones dead → auto-reconnect
});

// Remote players: the roster owns each peer's snapshot interpolator, last-seen
// stamp, join detection and idle prune; draw() samples it at (now − 100 ms).
// Colors are view-only, so we keep them in a small side map keyed by id.
const others = Net.createRoster<Vec>({ delayMs: 100 });
const colors = new Map<string, string>();

channel.onMessage = (msg) => {
  if (msg.kind === "bye") {
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
  channel.trySend({ kind: "bye", id });
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
      // trySend: false while (re)connecting — never throws in the game loop.
      channel.trySend({ kind: "pos", id, color, x: me.x, y: me.y });
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
      channel.state === "connected"
        ? `connected — ${others.size} other player${others.size === 1 ? "" : "s"}`
        : `(${channel.state}) — is the dev server running?`,
      { x: 12, y: 10, size: 14, color: channel.state === "connected" ? "#6bff9e" : "#ffb454" },
    );
    UI.text("←→↑↓/WASD move — open this page in another tab to multiplayer", {
      x: 12,
      y: 30,
      size: 14,
      color: "dim",
    });
    UI.text("sends packed binary frames at 20 Hz; remote blobs glide via Net.createRoster", {
      x: 12,
      y: 48,
      size: 14,
      color: "dim",
    });
  },
});
