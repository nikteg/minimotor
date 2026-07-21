// ---------- Networking ----------
// Dependency-free multiplayer building blocks: a small WebSocket transport, a
// WebRTC data-channel peer, snapshot interpolation, and a remote-peer roster.
// Split by concern: types / websocket / webrtc / interpolation / roster.
export * from "./types.js";
export * from "./websocket.js";
export * from "./webrtc.js";
export * from "./rtc-session.js";
export * from "./interpolation.js";
export * from "./roster.js";
