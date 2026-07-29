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

const welcome = (peers: string[] = [], id = "me") => ({
  type: "welcome",
  id,
  host: id, // we host: `adopt()` has nothing to dial
  peers,
});

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
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
