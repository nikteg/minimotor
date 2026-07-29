// ---------- Server primitives (Node) ----------
// The authoritative/relay half of multiplayer: rooms (connection lifecycle +
// JSON broadcast/relay/send over any WebSocket-like server), a fixed-rate
// tick, and a WebRTC signaling relay. Reached via the `minimotor/server`
// entry point — kept out of the browser bundle.
export * from "./room.js";
export * from "./tick.js";
export * from "./signaling.js";
export * from "./presence.js";
export * from "./matchmaker.js";
export type {
  Protocol,
  ProtocolShape,
  StateOf,
  EventsOf,
  RequestsOf,
  ClientMessageOf,
  ServerMessageOf,
} from "../protocol.js";
export { createInputBuffer, type InputBuffer, type PredictedInput } from "../prediction.js";
