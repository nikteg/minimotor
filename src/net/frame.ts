// ---------- The room wire format ----------
// ONE frame layout for every room, whatever carries it: a WebRTC data channel
// between peers, or a WebSocket to a dedicated server. That is what lets
// `sync`, `syncBody`, `events`, `sharedItems` and `hostState` be written once
// against `Room` and work in either topology.
//
//   [u8 idLen][id][u8 tagLen][tag][payload]
//
// The sender id travels in the frame so whoever is relaying — the peer host or
// the server — forwards the bytes VERBATIM instead of parsing and
// re-serializing them once per recipient.
//
// An empty tag means the payload is a JSON app message (`send`/`onMessage`); a
// tag names a binary lane (`sendBytes`/`onBytes`). The reserved empty SENDER id
// marks a control frame from the relay itself (membership, host election),
// which is how one connection carries both without a second channel.

/** Sender id reserved for the relay's own control frames. */
export const CONTROL = "";

/** Membership and host notices, identical for both topologies. */
export type RoomNotice =
  | { type: "welcome"; id: string; host: string | null; peers: string[] }
  | { type: "peer-join"; id: string }
  | { type: "peer-leave"; id: string }
  | { type: "host"; id: string | null };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeJson = (value: unknown): Uint8Array => textEncoder.encode(JSON.stringify(value));
export const decodeJson = (bytes: Uint8Array): unknown => JSON.parse(textDecoder.decode(bytes));

export function frame(id: string, tag: string, payload: Uint8Array): Uint8Array {
  const idBytes = textEncoder.encode(id);
  const tagBytes = textEncoder.encode(tag);
  const out = new Uint8Array(2 + idBytes.length + tagBytes.length + payload.length);
  let at = 0;
  out[at++] = idBytes.length;
  out.set(idBytes, at);
  at += idBytes.length;
  out[at++] = tagBytes.length;
  out.set(tagBytes, at);
  at += tagBytes.length;
  out.set(payload, at);
  return out;
}

export interface Frame {
  from: string;
  tag: string;
  payload: Uint8Array;
}

export function unframe(bytes: Uint8Array): Frame | null {
  if (bytes.length < 2) return null;
  let at = 0;
  const idLen = bytes[at++];
  if (bytes.length < at + idLen + 1) return null;
  const from = textDecoder.decode(bytes.subarray(at, at + idLen));
  at += idLen;
  const tagLen = bytes[at++];
  if (bytes.length < at + tagLen) return null;
  const tag = tagLen === 0 ? "" : textDecoder.decode(bytes.subarray(at, at + tagLen));
  at += tagLen;
  return { from, tag, payload: bytes.subarray(at) };
}

/** Build a relay→client control frame. */
export const controlFrame = (notice: RoomNotice): Uint8Array =>
  frame(CONTROL, "", encodeJson(notice));
