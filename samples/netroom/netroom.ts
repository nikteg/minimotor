import { createPerformanceMonitoring } from "minimotor/performance";
import { createInput } from "minimotor/input";
import { createCamera } from "minimotor/camera";
import { createNet } from "minimotor/net";
import { createUI } from "minimotor/ui";
// The smallest real multiplayer game: everyone in a room, everyone visible.
//
// Demonstrates the whole headline API, which is three lines:
//   Net.game()      join a room (or play solo if nothing answers)
//   net.share(me)   replicate my blob, get everyone else's back interpolated
//   net.items(...)  a host-authoritative, respawning pickup everyone agrees on
//
// The SAME code runs peer-to-peer or against a dedicated server — only the
// `server` option below differs, and the TRANSPORT buttons just reload the page
// with `?server` on or off. Nothing after that one line changes.
//
// Open this page in two tabs (or two machines on the same network) and move
// with the arrow keys or WASD.
import { createApp } from "minimotor";

// A fixed logical resolution: the engine letterboxes it into any window, so
// every player sees the same world whatever their screen.
const game = createApp("game", {
  background: "#0e1116",
  resolution: { w: 800, h: 450 },
});
const view = game.viewport;
const { Draw, Loop } = game;
const Input = createInput(game);
const Camera = createCamera(game);
const Net = createNet(game);
const UI = createUI(game, Input);
const params = new URLSearchParams(location.search);
const onServer = params.has("server");
const roomName = params.get("room") ?? "netroom";

// ---- the only networking in this file ----
const net = await Net.game({
  room: roomName,
  // Peer-to-peer when absent; every byte through one server when present.
  ...(onServer ? { server: "/ws-rooms" } : {}),
});

// A plain object with a position and a velocity — no base class, no registration.
const me = {
  x: 80 + net.index * 40,
  y: 225,
  vel: { x: 0, y: 0 },
  color: Net.playerColor(net.index),
};

// Share it. `players` is everyone ELSE, interpolated and ready to draw.
const players = net.share(me);

// A row of shared pickups, owned by whoever the room elected as host: taken
// once, seen by everyone, back after 3 seconds. Two players racing along the
// row is the whole point — only one of them can win each coin.
const SPAWNS = [
  { x: 260, y: 225 },
  { x: 400, y: 225 },
  { x: 540, y: 225 },
];
let score = 0;
const coins = net.items(SPAWNS, {
  respawnMs: 3000,
  // `canTake` is where a real game would verify the taker is actually close
  // enough — the host runs it, so a lying client gets refused.
  onTake: (_coin, by) => void (by === net.id && score++),
});

createPerformanceMonitoring(game, { net: net.meter });

const input = Input.map({
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
});

const SPEED = 3;
const RADIUS = 12;

/** Reload into the other transport, or into a fresh room, with everything else
 *  identical — the point being that only the URL changes. */
const go = (room: string, server: boolean): void => {
  location.search = `?room=${encodeURIComponent(room)}${server ? "&server" : ""}`;
};

Loop.run({
  update() {
    me.vel.x = input.axis("left", "right") * SPEED;
    me.vel.y = input.axis("up", "down") * SPEED;
    me.x = Math.max(RADIUS, Math.min(view.w - RADIUS, me.x + me.vel.x));
    me.y = Math.max(RADIUS, Math.min(view.h - RADIUS, me.y + me.vel.y));

    for (const coin of coins) {
      if (Math.hypot(coin.x - me.x, coin.y - me.y) < RADIUS + 8) coins.take(coin);
    }
  },

  draw() {
    // ---- world ----
    // Empty sockets show where a taken coin will come back.
    for (const spawn of SPAWNS) Draw.circle(spawn.x, spawn.y, 9, "rgba(255,209,102,.12)");
    for (const coin of coins) {
      Draw.circle(coin.x, coin.y, 8, "#ffd166");
      Draw.circle(coin.x - 2, coin.y - 3, 2, "#fff6d8");
    }

    // Everyone else, then me on top. Remote blobs carry the color and position
    // their owner shared; nothing here knows how they arrived.
    for (const other of players) {
      Draw.circle(other.x, other.y, RADIUS, other.color ?? "#888");
      UI.worldLabel(
        `P${other.index + 1}`,
        { x: other.x, y: other.y },
        { camera: Camera, offset: { y: -RADIUS - 8 }, size: 11, color: "dim" },
      );
    }
    Draw.circle(me.x, me.y, RADIUS, me.color);
    Draw.circle(me.x - 4, me.y - 5, 4, "rgba(255,255,255,.35)");
    UI.worldLabel(
      `P${net.index + 1} · you`,
      { x: me.x, y: me.y },
      { camera: Camera, offset: { y: -RADIUS - 8 }, size: 11, bold: true, color: me.color },
    );

    // ---- HUD ----
    UI.panel({ x: 8, y: 8, w: 300, title: "NETROOM" }, () => {
      UI.text(`room  ${roomName}`, { size: 12 });
      UI.text(
        net.online
          ? `${net.count} in room · ` +
              (net.hosting ? "you own the shared state" : `guest · ${Math.round(net.rttMs)} ms`)
          : "solo — nothing answered, and this exact code still runs",
        { size: 11, color: net.online ? "dim" : "#ffb454", wrap: true },
      );
      UI.row({ gap: 6 }, () => {
        UI.text(`coins ${score}`, { size: 12, bold: true, color: "#ffd166" });
        UI.text(`· ${[...coins].length}/${SPAWNS.length} up`, { size: 11, color: "dim" });
      });
      if (UI.button({ id: "new-room", label: "new room", h: 22, w: 90 }))
        go(`room-${Math.random().toString(36).slice(2, 7)}`, onServer);
    });

    UI.panel({ x: view.w - 268, y: 8, w: 260, title: "TRANSPORT" }, () => {
      UI.row({ gap: 6 }, () => {
        const switched = UI.button({
          id: "mode-p2p",
          label: "peer-to-peer",
          // Two labels of very different length, so pin the font rather than
          // letting the default bold 16px squeeze "peer-to-peer" to an ellipsis.
          font: "bold 12px monospace",
          w: 115,
          h: 26,
          variant: onServer ? "default" : "primary",
          disabled: !onServer,
          tooltip: onServer ? "reload as a WebRTC mesh" : "already peer-to-peer",
        });
        if (switched) go(roomName, false);
        if (
          UI.button({
            id: "mode-server",
            label: "server",
            font: "bold 12px monospace",
            w: 115,
            h: 26,
            variant: onServer ? "primary" : "default",
            disabled: onServer,
            tooltip: onServer ? "already relayed by the server" : "reload through /ws-rooms",
          })
        )
          go(roomName, true);
      });
      UI.text(
        onServer
          ? "every byte relayed by one server — room, clock, items and codec unchanged"
          : "direct WebRTC between peers — the relay only carries the handshake",
        { size: 10, color: "dim", wrap: true },
      );
    });

    // Who is here — the same roster, in both topologies.
    UI.panel({ x: view.w - 268, y: 132, w: 260, title: `PLAYERS · ${net.count}` }, () => {
      const seat = (id: string, color: string, label: string, mine: boolean) =>
        UI.row({ id, gap: 8, h: 14 }, () => {
          UI.bar({ value: 1, w: 8, h: 8, fill: color, bg: color });
          UI.text(label, { size: 11, bold: mine, color: mine ? "accent" : "dim" });
        });
      seat("seat-me", me.color, `P${net.index + 1} you${net.hosting ? " · host" : ""}`, true);
      for (const other of players)
        seat(
          `seat-${other.id}`,
          other.color ?? "#888",
          `P${other.index + 1}${other.id === net.room.hostId ? " · host" : ""}`,
          false,
        );
    });

    UI.text("arrows / WASD to move · grab the coins before anyone else does", {
      x: 12,
      y: view.h - 22,
      size: 11,
      color: "dim",
    });
    UI.drawTips();
  },
});

// Exposed so the end-to-end tests can assert on real room state rather than
// pixels — a sample is also a testbed.
Object.defineProperty(window, "netroom", {
  value: {
    get id() {
      return net.id;
    },
    get online() {
      return net.online;
    },
    get count() {
      return net.count;
    },
    get hosting() {
      return net.hosting;
    },
    get hostId() {
      return net.room.hostId;
    },
    get peers() {
      return [...net.room.peers];
    },
    get topology() {
      return onServer ? "server" : "p2p";
    },
    get stage() {
      return { w: view.w, h: view.h };
    },
    // The HUD buttons are canvas widgets, so a test can't query the DOM for
    // them: `UI.layoutCapture` is the engine's own layout-debug recorder, and
    // `UI.layoutTree()` then reports the rect every widget really resolved to.
    layoutCapture: (on: boolean) => UI.layoutCapture(on),
    layoutTree: () => UI.layoutTree(),
    get me() {
      return { x: me.x, y: me.y, color: me.color };
    },
    get others() {
      return [...players].map((p) => ({ id: p.id, x: p.x, y: p.y, color: p.color }));
    },
    get coins() {
      return [...coins].length;
    },
    get score() {
      return score;
    },
  },
});
