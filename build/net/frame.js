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
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const encodeJson = (value) => textEncoder.encode(JSON.stringify(value));
export const decodeJson = (bytes) => JSON.parse(textDecoder.decode(bytes));
export function frame(id, tag, payload) {
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
export function unframe(bytes) {
    if (bytes.length < 2)
        return null;
    let at = 0;
    const idLen = bytes[at++];
    if (bytes.length < at + idLen + 1)
        return null;
    const from = textDecoder.decode(bytes.subarray(at, at + idLen));
    at += idLen;
    const tagLen = bytes[at++];
    if (bytes.length < at + tagLen)
        return null;
    const tag = tagLen === 0 ? "" : textDecoder.decode(bytes.subarray(at, at + tagLen));
    at += tagLen;
    return { from, tag, payload: bytes.subarray(at) };
}
/** Build a relay→client control frame. */
export const controlFrame = (notice) => frame(CONTROL, "", encodeJson(notice));
