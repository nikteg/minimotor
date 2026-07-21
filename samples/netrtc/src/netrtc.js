// Pure-WebRTC multiplayer: one client HOSTS, everyone else JOINS.
// Demonstrates: Minimotor.Net.host() / Net.join() — a star topology where the
// host holds a data channel to each guest and fans state out, while a WebSocket
// carries only the signaling handshake (SDP/ICE). Once the channels open, cursor
// traffic goes peer→peer and never touches the server.
//
// Open this page in two tabs (or two machines): click HOST in one, JOIN in the
// others. Move your mouse — every connected cursor shows up in every tab. The
// host relays: guests send their cursor to the host, the host merges them with
// its own and broadcasts the whole set back. Close the host tab and the server
// promotes the oldest guest; the survivors re-negotiate to it automatically.
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game");
Minimotor.Stage.onResize((next) => (vp = next));
const { Net, Pointer, UI, Loop } = Minimotor;

// Same-origin signaling relay hosted by the dev/preview server (vite.config.ts
// mounts `signaling()` here). Swap for your own deployment in production.
const SIGNAL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-signal`;

// A stable-ish colour per peer id, so each cursor keeps its hue across frames.
const PALETTE = ["#4ecdc4", "#ffe066", "#ff6b6b", "#a78bfa", "#6bff9e", "#ff9e64", "#5eead0"];
const hueOf = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

// role: null → menu; "host" | "guest" once chosen.
let role = null;
let session = null;
let status = "pick a role";

// cursors we currently draw: id → { x, y } in 0..1 normalized coords.
const cursors = new Map();
let myCursor = { x: 0.5, y: 0.5 };

function startHost() {
  role = "host";
  status = "connecting to relay…";
  cursors.clear();
  const room = Net.host({ signal: SIGNAL });
  session = room;
  room.onGuestJoin = () => (status = `hosting — ${room.guests.length} guest(s)`);
  room.onGuestLeave = (id) => {
    cursors.delete(id);
    status = `hosting — ${room.guests.length} guest(s)`;
  };
  room.onMessage = (id, msg) => cursors.set(id, msg); // a guest's cursor
}

function startGuest() {
  role = "guest";
  status = "connecting to relay…";
  cursors.clear();
  const me = Net.join({ signal: SIGNAL });
  session = me;
  me.onOpen = () => (status = `joined — host ${me.hostId}`);
  me.onClose = () => (status = "channel closed — waiting for a new host…");
  // The host broadcasts the full cursor set (its own + every guest's).
  me.onMessage = (state) => {
    cursors.clear();
    for (const id in state) cursors.set(id, state[id]);
  };
}

function leave() {
  session?.close();
  session = null;
  role = null;
  status = "pick a role";
  cursors.clear();
}

// Shareable deep-links: /netrtc/?role=host or ?role=join skip the menu, so you
// can bookmark a host tab and hand out a join link.
const wanted = new URLSearchParams(location.search).get("role");
if (wanted === "host") startHost();
else if (wanted === "join" || wanted === "guest") startGuest();

Loop.run({
  update() {
    // Track the pointer as normalized coords once we're in a session.
    if (role && Pointer.x >= 0) {
      myCursor = { x: Pointer.x / vp.w, y: Pointer.y / vp.h };
    }
    if (role === "guest") {
      session.send(myCursor); // stream my cursor to the host
    } else if (role === "host") {
      cursors.set(session.id || "host", myCursor); // include my own cursor
      // Fan the merged set out to every guest.
      const state = {};
      for (const [id, c] of cursors) state[id] = c;
      session.broadcast(state);
    }
  },

  draw(ctx) {
    ctx.clearRect(0, 0, vp.w, vp.h);

    if (!role) {
      UI.text("WebRTC Host / Join", { x: vp.w / 2, y: vp.h / 2 - 80, size: 28, bold: true, align: "center" });
      UI.text("Open this page in another tab and pick the opposite role.", {
        x: vp.w / 2,
        y: vp.h / 2 - 44,
        size: 15,
        color: "dim",
        align: "center",
      });
      const cx = vp.w / 2;
      if (UI.button(ctx, { x: cx - 170, y: vp.h / 2, w: 160, h: 48, label: "HOST A ROOM", variant: "primary" })) {
        startHost();
      }
      if (UI.button(ctx, { x: cx + 10, y: vp.h / 2, w: 160, h: 48, label: "JOIN A ROOM" })) {
        startGuest();
      }
      return;
    }

    // Every known cursor, host + guests alike.
    for (const [id, c] of cursors) {
      const mine = (role === "host" && id === (session.id || "host")) || (role === "guest" && id === session.id);
      ctx.fillStyle = hueOf(id);
      ctx.globalAlpha = mine ? 1 : 0.85;
      ctx.beginPath();
      ctx.arc(c.x * vp.w, c.y * vp.h, mine ? 13 : 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      UI.text(mine ? `${id} (you)` : id, { x: c.x * vp.w + 16, y: c.y * vp.h - 6, size: 12, color: "dim" });
    }

    UI.text(`role: ${role}`, { x: 16, y: 20, size: 15, bold: true });
    UI.text(status, { x: 16, y: 42, size: 14, color: "#ffb454" });
    UI.text(`cursors: ${cursors.size}`, { x: 16, y: 62, size: 13, color: "dim" });
    if (UI.button(ctx, { x: 16, y: vp.h - 56, w: 120, h: 38, label: "LEAVE" })) leave();
  },
});
