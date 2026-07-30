// `Net.join` against a fake relay socket: the welcome handshake, and the
// reconnect path (P4.3) — a dropped relay used to end the room permanently.
// Every test keeps US as the host so `adopt()` never opens an RTCPeerConnection
// (jsdom has none); the relay link is what's under test here, not the mesh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, type RoomStatus } from "../room.js";

interface FakeSocket {
  url: string;
  binaryType: string;
  sent: string[];
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: unknown): void;
  close(): void;
  /** Test driver: the relay accepts and speaks. */
  open(): void;
  say(notice: unknown): void;
  drop(): void;
}

let sockets: FakeSocket[] = [];
const last = (): FakeSocket => sockets[sockets.length - 1];

class FakeWebSocket {
  constructor(url: string) {
    const self = this as unknown as FakeSocket;
    self.url = url;
    self.sent = [];
    self.onopen = self.onmessage = self.onclose = self.onerror = null;
    self.send = (data: unknown) => void self.sent.push(String(data));
    self.close = () => self.onclose?.();
    self.open = () => self.onopen?.();
    self.say = (notice: unknown) => self.onmessage?.({ data: JSON.stringify(notice) });
    self.drop = () => self.onclose?.();
    sockets.push(self);
  }
}

/** Minimal RTC doubles: enough for a guest to dial its host and for us to see
 *  which of the two data channels each send landed on. */
class FakeChannel {
  label: string;
  readyState = "connecting";
  binaryType = "";
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(label: string) {
    this.label = label;
  }
  send(data: Uint8Array) {
    this.sent.push(data.slice());
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

let channels: FakeChannel[] = [];
const laneNamed = (label: string): FakeChannel => channels.find((c) => c.label === label)!;

class FakePeerConnection {
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription = { type: "offer", sdp: "x" };
  onicecandidate: unknown = null;
  ondatachannel: unknown = null;
  onconnectionstatechange: unknown = null;
  createDataChannel(label: string) {
    const channel = new FakeChannel(label);
    channels.push(channel);
    return channel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "x" });
  }
  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "x" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.resolve();
  }
  addIceCandidate() {
    return Promise.resolve();
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.connectionState = "closed";
  }
}

/** Read back one wire frame: [u8 idLen][id][u8 tagLen][tag][payload]. */
function readFrame(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  let at = 0;
  const idLength = bytes[at++];
  const from = decoder.decode(bytes.subarray(at, at + idLength));
  at += idLength;
  const tagLength = bytes[at++];
  const tag = decoder.decode(bytes.subarray(at, at + tagLength));
  at += tagLength;
  return { from, tag, payload: bytes.subarray(at) };
}

const welcome = (peers: string[] = [], id = "me") => ({
  type: "welcome",
  id,
  host: id, // we host: `adopt()` has nothing to dial
  peers,
});

beforeEach(() => {
  sockets = [];
  channels = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Net.join", () => {
  it("resolves on the relay's welcome and reports the membership", async () => {
    const joining = join("/ws");
    last().open();
    last().say(welcome(["a", "b"]));
    const room = await joining;
    expect(room.id).toBe("me");
    expect(room.peers).toEqual(["a", "b"]);
    expect(room.hostId).toBe("me");
    expect(room.status).toBe("connected");
    room.close();
    expect(room.status).toBe("closed");
  });

  it("rejects — without retrying — when the relay never answers", async () => {
    const joining = join("/ws", { timeoutMs: 1000 });
    const failed = joining.catch((e: Error) => e.message);
    last().open();
    vi.advanceTimersByTime(1000);
    expect(await failed).toMatch(/never answered/);
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(1); // offline is the app's call, not ours
  });

  it("rejects when the socket dies before the join lands", async () => {
    const joining = join("/ws");
    const failed = joining.catch((e: Error) => e.message);
    last().drop();
    expect(await failed).toMatch(/unreachable/);
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(1);
  });

  it("can fall back to the same API as a local host", async () => {
    const joining = join("/ws", { fallback: "local" });
    last().drop();
    const room = await joining;
    expect(room.local).toBe(true);
    expect(room.hosting).toBe(true);
    expect(room.id).toBe("local");
    expect(room.peerCount).toBe(0);
  });
});

describe("Net.join reconnect", () => {
  it("reopens after a drop, backing off exponentially until the relay answers", async () => {
    const joining = join("/ws", { retryMs: 100, maxRetryMs: 400 });
    last().open();
    last().say(welcome());
    const room = await joining;
    const seen: RoomStatus[] = [];
    room.onStatus((s) => seen.push(s));

    last().drop();
    expect(room.status).toBe("reconnecting");
    expect(sockets.length).toBe(1); // nothing yet — the first delay is 100ms

    vi.advanceTimersByTime(99);
    expect(sockets.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(sockets.length).toBe(2);

    // That attempt fails too: the next wait is 200ms, then 400ms, then capped.
    last().drop();
    vi.advanceTimersByTime(199);
    expect(sockets.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(sockets.length).toBe(3);
    last().drop();
    vi.advanceTimersByTime(400);
    expect(sockets.length).toBe(4);
    last().drop();
    vi.advanceTimersByTime(400); // capped at maxRetryMs, not 800
    expect(sockets.length).toBe(5);

    // The relay comes back.
    last().open();
    last().say(welcome([], "me-2"));
    expect(room.status).toBe("connected");
    expect(room.id).toBe("me-2"); // a reconnect gets a fresh id from the relay
    expect(seen).toEqual(["reconnecting", "connected"]);

    // …and the backoff starts over from `retryMs` on the next drop.
    last().drop();
    vi.advanceTimersByTime(100);
    expect(sockets.length).toBe(6);
    room.close();
  });

  it("reports membership churn across a reconnect as ordinary join/leave", async () => {
    const joining = join("/ws", { retryMs: 10 });
    last().open();
    last().say(welcome(["a", "b"]));
    const room = await joining;
    const left: string[] = [];
    const joined: string[] = [];
    room.onLeave((id) => left.push(id));
    room.onJoin((id) => joined.push(id));

    last().drop();
    vi.advanceTimersByTime(10);
    last().open();
    last().say(welcome(["b", "c"], "me-2")); // `a` gave up, `c` arrived
    expect(left).toEqual(["a"]);
    expect(joined).toEqual(["c"]);
    expect(room.peers).toEqual(["b", "c"]);
    room.close();
  });

  it("honours reconnect: false and maxRetries", async () => {
    const off = join("/ws", { reconnect: false });
    last().open();
    last().say(welcome());
    const roomOff = await off;
    last().drop();
    expect(roomOff.status).toBe("closed");
    expect(roomOff.closed).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(1);

    sockets = [];
    const limited = join("/ws", { retryMs: 10, maxRetries: 2 });
    last().open();
    last().say(welcome());
    const room = await limited;
    last().drop();
    vi.advanceTimersByTime(10);
    last().drop(); // attempt 2
    vi.advanceTimersByTime(20);
    last().drop(); // out of attempts
    expect(room.status).toBe("closed");
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(3); // the original plus its two retries
  });

  it("stops retrying once the room is closed", async () => {
    const joining = join("/ws", { retryMs: 50 });
    last().open();
    last().say(welcome());
    const room = await joining;
    last().drop();
    expect(room.status).toBe("reconnecting");
    room.close();
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(1);
    expect(room.status).toBe("closed");
  });
});

describe("Net.join delivery lanes", () => {
  /** Join as a GUEST so `adopt()` dials the host and opens both channels. */
  async function guestRoom() {
    const joining = join("/ws");
    last().open();
    last().say({ type: "welcome", id: "me", host: "h", peers: ["h"] });
    const room = await joining;
    for (const channel of channels) channel.open();
    return room;
  }

  it("puts messages on the reliable lane and snapshots on the unreliable one", async () => {
    const room = await guestRoom();
    expect(channels.map((c) => c.label)).toEqual(["mm-fast", "mm-safe"]);

    room.send({ hello: true });
    room.sendBytes("b", new Uint8Array([1, 2, 3]));
    // An explicit opt-out puts a message on the unreliable lane too.
    room.send({ snapshot: true }, { reliable: false });

    expect(laneNamed("mm-safe").sent).toHaveLength(1);
    expect(laneNamed("mm-fast").sent).toHaveLength(2);

    const event = readFrame(laneNamed("mm-safe").sent[0]);
    expect(event).toMatchObject({ from: "me", tag: "" });
    expect(JSON.parse(new TextDecoder().decode(event.payload))).toEqual({ hello: true });

    const snapshot = readFrame(laneNamed("mm-fast").sent[0]);
    expect(snapshot).toMatchObject({ from: "me", tag: "b" });
    expect(Array.from(snapshot.payload)).toEqual([1, 2, 3]);
    room.close();
  });

  it("routes each lane to the matching listener, tagged with the true sender", async () => {
    const room = await guestRoom();
    const messages: unknown[] = [];
    const packets: Array<{ from: string; bytes: number[] }> = [];
    room.onMessage((from, msg) => messages.push({ from, msg }));
    room.onBytes("b", (from, bytes) => packets.push({ from, bytes: Array.from(bytes) }));

    // The host forwards another guest's frame verbatim, so `from` is the
    // ORIGINAL sender rather than the peer we received it from.
    const encoder = new TextEncoder();
    const jsonPayload = encoder.encode(JSON.stringify({ shot: 1 }));
    const framed = new Uint8Array([1, 97, 0, ...jsonPayload]); // id "a", empty tag
    laneNamed("mm-safe").onmessage?.({ data: framed.buffer });
    laneNamed("mm-fast").onmessage?.({ data: new Uint8Array([1, 98, 1, 98, 9, 9]).buffer });

    expect(messages).toEqual([{ from: "a", msg: { shot: 1 } }]);
    expect(packets).toEqual([{ from: "b", bytes: [9, 9] }]);
    room.close();
  });

  it("survives a truncated or malformed frame", async () => {
    const room = await guestRoom();
    const heard = vi.fn();
    room.onMessage(heard);
    laneNamed("mm-safe").onmessage?.({ data: new Uint8Array([9]).buffer }); // too short
    laneNamed("mm-safe").onmessage?.({ data: new Uint8Array([1, 97, 0, 123]).buffer }); // bad JSON
    expect(heard).not.toHaveBeenCalled();
    expect(room.status).toBe("connected");
    room.close();
  });

  it("closes and forgets a peer's channels when it leaves", async () => {
    const room = await guestRoom();
    last().say({ type: "peer-leave", id: "h" });
    expect(laneNamed("mm-fast").readyState).toBe("closed");
    expect(laneNamed("mm-safe").readyState).toBe("closed");
    // Nothing is queued at a departed peer.
    const before = laneNamed("mm-fast").sent.length;
    room.sendBytes("b", new Uint8Array([1]));
    expect(laneNamed("mm-fast").sent).toHaveLength(before);
    room.close();
  });
});
