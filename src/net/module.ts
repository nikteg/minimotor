// ---------- Networking module ----------
// Dependency-free multiplayer, in three tiers — start at the top.
//
//   Net.game({ room, body })   one call: join, replicate, interpolate, events,
//                              shared items, network clock, solo fallback.
//   Net.join / Net.syncBody    the symmetric room and declarative replication,
//   Net.events / Net.sharedItems   when you want to assemble your own mix.
//   Net.connect / Net.createPeer   raw transports, snapshot interpolation, the
//                              peer roster, and host/guest star sessions.
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
export * from "./game.js";
export * from "./frame.js";
export * from "./socket-room.js";
export * from "./interpolation.js";
export * from "./roster.js";
export * from "./body-state.js";
export * from "./body-codec.js";
export * from "./events.js";
export * from "./entities.js";
export * from "./ownership.js";
export * from "./time.js";
export * from "./prediction.js";
export * from "./diagnostics.js";
export * from "./host-state.js";
export * from "./shared-items.js";
