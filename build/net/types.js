// ---------- Networking ----------
// WebSocket and WebRTC data channel transports with a common interface.
//
// WebSocket:
//   const ws = Net.connect("wss://server.example/game");
//   ws.send(new Uint8Array([1, 2, 3]));
//   ws.onMessage = (data) => { ... };
//
// WebRTC (peer-to-peer):
//   const peer = Net.createPeer();
//   peer.onSignal = (signal) => signalingServer.send(signal);
//   // When you receive a signal from the other peer:
//   peer.applySignal(receivedSignal);
//   peer.onMessage = (data) => { ... };
//   peer.send(data);
export {};
