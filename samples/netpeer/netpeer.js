// Peer-to-peer demo: a real WebRTC data channel, both ends in one page.
// Demonstrates: Minimotor.Net.createPeer — onSignal / applySignal handshake,
// transport.sendJson / onMessage, and transport.state.
//
// Normally the two peers run on different machines and you relay their signaling
// messages through a server (a WebSocket, a copy-paste, anything). Here both
// peers live in this tab and we wire each one's onSignal straight into the
// other's applySignal — so the handshake, the ICE and the data channel are all
// genuine, no server required. Move your mouse on the LEFT pane; the dot on the
// RIGHT is drawn only from bytes that traveled peer→peer over the channel.
import { Minimotor } from "minimotor";

// Host-side network meter, shown in the Perf HUD (top-right): message and byte
// rates for the cursor stream going out and the acks coming back.
const meter = Minimotor.Perf.createNetMeter();
const vp = Minimotor.Stage.init("game", {
  plugins: [Minimotor.Perf.plugin({ net: meter })],
});
const { Net, Pointer, Draw, Loop } = Minimotor;

const dec = new TextDecoder();

// "you" (host) and "peer" (guest). Loopback: whatever one wants to signal, hand
// straight to the other.
const you = Net.createPeer();
const peer = Net.createPeer();
you.onSignal = (sig) => peer.applySignal(sig);
peer.onSignal = (sig) => you.applySignal(sig);

// State shared with the draw loop.
let localN = { x: 0.5, y: 0.5 }; // your normalized cursor (0..1 within the pane)
let remoteN = null; // what the peer received, echoed back
let sent = 0;
let recvByPeer = 0;
let recvByYou = 0;

// The guest renders nothing itself — it just receives your cursor and bounces an
// acknowledgement back, so we can prove the channel is full-duplex.
peer.transport.onMessage = (bytes) => {
  const msg = JSON.parse(dec.decode(bytes));
  recvByPeer++;
  remoteN = msg; // the position that actually crossed the wire
  if (peer.transport.state === "connected") peer.transport.sendJson({ ack: recvByPeer });
};

you.transport.onMessage = (bytes) => {
  JSON.parse(dec.decode(bytes)); // ack
  recvByYou++;
  meter.recv(bytes.length);
};

you.connect(); // create the offer → loopback → answer → channel opens

Loop.run({
  update() {
    // Track the pointer while it's over the left pane.
    if (Pointer.x >= 0 && Pointer.x < vp.w / 2) {
      localN = { x: (Pointer.x / (vp.w / 2)) * 1, y: Pointer.y / vp.h };
    }
    // Stream your cursor to the peer over the data channel (once open).
    if (you.transport.state === "connected") {
      you.transport.sendJson(localN);
      sent++;
      meter.sent(JSON.stringify(localN).length);
    }
  },

  draw() {
    const { ctx } = Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);
    const half = vp.w / 2;

    // Divider + pane labels.
    ctx.strokeStyle = "#2a3340";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, vp.h);
    ctx.stroke();

    ctx.fillStyle = "#8aa";
    ctx.font = "bold 15px monospace";
    ctx.fillText("YOU  (host)  — move your mouse here", 16, 28);
    ctx.fillText("PEER (guest) — drawn from received bytes", half + 16, 28);

    // Your dot (left pane).
    ctx.fillStyle = "#4ecdc4";
    ctx.beginPath();
    ctx.arc(localN.x * half, localN.y * vp.h, 12, 0, Math.PI * 2);
    ctx.fill();

    // Peer's dot (right pane) — only if a message has arrived.
    if (remoteN) {
      ctx.fillStyle = "#ffe066";
      ctx.beginPath();
      ctx.arc(half + remoteN.x * half, remoteN.y * vp.h, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Status.
    const st = you.transport.state;
    ctx.fillStyle = st === "connected" ? "#6bff9e" : "#ffb454";
    ctx.font = "14px monospace";
    ctx.fillText(`channel: ${st}`, 16, vp.h - 44);
    ctx.fillStyle = "#8aa";
    ctx.fillText(`sent → ${sent}   peer received → ${recvByPeer}`, 16, vp.h - 24);
    ctx.fillText(`acks back ← ${recvByYou}`, 16, vp.h - 6);
    if (st !== "connected") {
      ctx.fillStyle = "#ffb454";
      ctx.fillText("negotiating peer connection…", half + 16, vp.h - 24);
    }
  },
});
