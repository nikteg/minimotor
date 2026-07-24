// Peer-to-peer demo: a real WebRTC data channel, both ends in one page.
// Demonstrates: Net.createPeer — onSignal / applySignal handshake,
// transport.sendJson / onMessage, and transport.state.
//
// Normally the two peers run on different machines and you relay their signaling
// messages through a server (a WebSocket, a copy-paste, anything). Here both
// peers live in this tab and we wire each one's onSignal straight into the
// other's applySignal — so the handshake, the ICE and the data channel are all
// genuine, no server required. Move your mouse on the LEFT pane; the dot on the
// RIGHT is drawn only from bytes that traveled peer→peer over the channel.
import { Draw, Keys, Loop, Net, Perf, Pointer, Stage, UI } from "minimotor";

interface Vec {
  x: number;
  y: number;
}

// Host-side network meter, shown in the Perf HUD (top-right): message and byte
// rates for the cursor stream going out and the acks coming back.
const meter = Perf.createNetMeter();
// The viewport is LIVE (mutated on resize) — both panes lay out from it.
const vp = Stage.init("game", {
  background: "#0e1116",
  plugins: [Perf.plugin({ net: meter })],
});

const dec = new TextDecoder();

// "you" (host) and "peer" (guest). Loopback: whatever one wants to signal, hand
// straight to the other.
const you = Net.createPeer();
const peer = Net.createPeer();
you.onSignal = (sig) => peer.applySignal(sig);
peer.onSignal = (sig) => you.applySignal(sig);

// State shared with the draw loop.
let localN: Vec = { x: 0.5, y: 0.5 }; // your normalized cursor (0..1 within the pane)
let remoteN: Vec | null = null; // what the peer received, echoed back
let sent = 0;
let recvByPeer = 0;
let recvByYou = 0;

// The guest's view of your cursor, two ways: the raw last packet, and a
// snapshot interpolator that renders ~100ms in the past, blending between
// packets. Toggle with I to see what interpolation buys — especially while
// idle-skipping below keeps the packet rate low.
let interpolate = true;
const interp = Net.createInterpolator<Vec>({ delayMs: 100 });

// The guest renders nothing itself — it just receives your cursor and bounces an
// acknowledgement back, so we can prove the channel is full-duplex.
peer.transport.onMessage = (bytes) => {
  const msg = JSON.parse(dec.decode(bytes)) as Vec;
  recvByPeer++;
  remoteN = msg; // the position that actually crossed the wire
  interp.push({ x: msg.x, y: msg.y });
  if (peer.transport.state === "connected") peer.transport.sendJson({ ack: recvByPeer });
};

you.transport.onMessage = (bytes) => {
  JSON.parse(dec.decode(bytes)); // ack
  recvByYou++;
  meter.recv(bytes.length);
};

you.connect(); // create the offer → loopback → answer → channel opens

let lastSent: Vec | null = null; // skip sends while the cursor hasn't moved

Loop.run({
  update() {
    if (Keys.pressed("KeyI")) interpolate = !interpolate;

    // Track the pointer while it's over the left pane.
    if (Pointer.x >= 0 && Pointer.x < vp.w / 2) {
      localN = { x: Pointer.x / (vp.w / 2), y: Pointer.y / vp.h };
    }
    // Stream your cursor to the peer over the data channel (once open) —
    // but only when it actually moved. An idle cursor costs zero bytes.
    const moved = !lastSent || lastSent.x !== localN.x || lastSent.y !== localN.y;
    if (moved && you.transport.state === "connected") {
      you.transport.sendJson(localN);
      lastSent = localN;
      sent++;
      meter.sent(JSON.stringify(localN).length);
    }
  },

  draw() {
    const half = vp.w / 2;

    // Divider + pane labels.
    Draw.line(half, 0, half, vp.h, "#2a3340", 2);

    UI.text("YOU  (host)  — move your mouse here", {
      x: 16,
      y: 13,
      size: 15,
      bold: true,
      color: "dim",
    });
    UI.text("PEER (guest) — drawn from received bytes", {
      x: half + 16,
      y: 13,
      size: 15,
      bold: true,
      color: "dim",
    });

    // Your dot (left pane).
    Draw.circle(localN.x * half, localN.y * vp.h, 12, "#4ecdc4");

    // Peer's dot (right pane) — raw last packet, or sampled from the
    // interpolator's snapshot buffer (~100ms in the past, gliding).
    const shown = interpolate ? (interp.sample() ?? remoteN) : remoteN;
    if (shown) {
      Draw.circle(half + shown.x * half, shown.y * vp.h, 12, "#ffe066");
    }

    // Status.
    const st = you.transport.state;
    UI.text(`channel: ${st}`, {
      x: 16,
      y: vp.h - 58,
      size: 14,
      color: st === "connected" ? "#6bff9e" : "#ffb454",
    });
    UI.text(`sent → ${sent}   peer received → ${recvByPeer}`, {
      x: 16,
      y: vp.h - 38,
      size: 14,
      color: "dim",
    });
    UI.text(`acks back ← ${recvByYou}`, { x: 16, y: vp.h - 20, size: 14, color: "dim" });
    UI.text(
      `I: interpolation ${interpolate ? "ON — guest glides 100ms behind" : "OFF — guest snaps per packet"}`,
      { x: half + 16, y: vp.h - 20, size: 14, color: "dim" },
    );
    if (st !== "connected") {
      UI.text("negotiating peer connection…", {
        x: half + 16,
        y: vp.h - 38,
        size: 14,
        color: "#ffb454",
      });
    }
  },
});
