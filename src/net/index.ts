// ---------- Networking ----------
// Dependency-free multiplayer building blocks. The headline is the symmetric
// ROOM (`Net.join(url, { room })`) + declarative replication (`Net.sync`,
// or `Net.syncBody` for lightweight/Physics2D bodies);
// beneath them: a WebSocket transport, a WebRTC data-channel peer, snapshot
// interpolation, a remote-peer roster, and the asymmetric host/guest star
// sessions for host-authoritative designs.
export * from "./types.js";
export * from "./protocol.js";
export * from "./websocket.js";
export * from "./webrtc.js";
export * from "./room.js";
export {
  host as hostSession,
  join as joinSession,
  type HostSession,
  type GuestSession,
  type RtcSessionOptions,
} from "./rtc-session.js";
export * from "./interpolation.js";
export * from "./roster.js";
export * from "./body-state.js";
export * from "./events.js";
export * from "./entities.js";
export * from "./ownership.js";
export * from "./time.js";
export * from "./prediction.js";
export * from "./diagnostics.js";
export * from "./host-state.js";
export * from "./shared-items.js";
