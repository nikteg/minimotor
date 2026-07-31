// The point of the Room abstraction: every Net primitive is written once and
// behaves the same whether the room is a WebRTC mesh or a dedicated server.
// These tests run the SAME assertions against a real `rooms()` server, driven
// through the real `socketRoom` client over a fake socket pair.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { socketRoom } from "@src/net/socket-room.js";
import { rooms, type BinarySocket } from "@src/net/server/rooms.js";
import { events } from "@src/net/events.js";
import { sharedItems } from "@src/net/shared-items.js";
import { syncBody } from "@src/net/body-state.js";
import { hostState } from "@src/net/host-state.js";

/** A socket pair: what the client "sends" is delivered to the server half and
 *  vice versa, synchronously. */
class FakeSocket {
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  /** The server-side handlers registered by `rooms()`. */
  private handlers = new Map<string, (raw: unknown) => void>();

  constructor(public url: string) {
    sockets.push(this);
    // Open (and only then let the server speak) once the caller has had a
    // chance to attach its handlers — a real socket cannot deliver before it
    // has returned from the constructor either.
    queueMicrotask(() => {
      this.onopen?.();
      server!.emit(this);
    });
  }
  /** Client → server. */
  send(data: Uint8Array) {
    this.handlers.get("message")?.(data.slice());
  }
  close() {
    this.readyState = 3;
    this.handlers.get("close")?.();
    this.onclose?.();
  }
  // ---- the ServerSocket half, as seen by `rooms()` ----
  on(event: string, handler: (raw: unknown) => void) {
    this.handlers.set(event, handler);
  }
  /** Server → client. */
  serverSend(data: string | Uint8Array) {
    const bytes = data as Uint8Array;
    this.onmessage?.({
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    });
  }
}

/** Stands in for a WebSocketServer: hands each new socket to `rooms()`. */
class FakeServer {
  private onConnection: ((socket: BinarySocket, request?: { url?: string }) => void) | null = null;
  on(_event: "connection", handler: (socket: BinarySocket, request?: { url?: string }) => void) {
    this.onConnection = handler;
  }
  emit(socket: FakeSocket) {
    const bound = {
      send: (data: string | Uint8Array) => socket.serverSend(data),
      readyState: 1,
      on: (event: string, handler: (raw: unknown) => void) => socket.on(event, handler),
    } as unknown as BinarySocket;
    this.onConnection?.(bound, { url: socket.url.replace(/^ws:\/\/[^/]+/, "") });
  }
}

let server: FakeServer | null = null;
let sockets: FakeSocket[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  server = new FakeServer();
  rooms(server);
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  server = null;
});

/** Two clients in the same server-hosted room. */
async function pair() {
  const first = socketRoom("ws://server/ws-rooms", { room: "arena" });
  await vi.advanceTimersByTimeAsync(0);
  const second = socketRoom("ws://server/ws-rooms", { room: "arena" });
  await vi.advanceTimersByTimeAsync(0);
  return [await first, await second] as const;
}

describe("a server-hosted Room runs the same primitives as a peer mesh", () => {
  it("welcomes, tracks membership, and elects the first client as host", async () => {
    const [a, b] = await pair();
    expect(a.id).toBe("c0");
    expect(b.id).toBe("c1");
    expect(a.peers).toEqual(["c1"]);
    expect(b.peers).toEqual(["c0"]);
    expect(a.hosting).toBe(true); // shared-state owner, exactly as in a mesh
    expect(b.hosting).toBe(false);
    expect(b.hostId).toBe("c0");
    expect(a.local).toBe(false);
    a.close();
    b.close();
  });

  it("isolates rooms by name", async () => {
    const here = socketRoom("ws://server/ws-rooms", { room: "arena" });
    const there = socketRoom("ws://server/ws-rooms", { room: "lobby" });
    await vi.advanceTimersByTimeAsync(0);
    const [x, y] = [await here, await there];
    expect(x.peers).toEqual([]);
    expect(y.peers).toEqual([]);
    expect(x.hosting && y.hosting).toBe(true); // each room has its own host
    x.close();
    y.close();
  });

  it("carries typed events", async () => {
    const [a, b] = await pair();
    const heard = vi.fn();
    events<{ shoot: { damage: number } }>(b).on("shoot", heard);
    events<{ shoot: { damage: number } }>(a).emit("shoot", { damage: 7 });
    expect(heard).toHaveBeenCalledWith({ damage: 7 }, "c0");
    a.close();
    b.close();
  });

  it("carries packed body snapshots on the binary lane", async () => {
    const [a, b] = await pair();
    const body = { x: 12.5, y: -3, vel: { x: 1, y: 0 }, color: "#abc", state: "run" };
    const sender = syncBody(a, body, { hz: 60 });
    const receiver = syncBody(b, { x: 0, y: 0, vx: 0, vy: 0 }, { hz: 60, delayMs: 0 });
    await vi.advanceTimersByTimeAsync(20);
    const seen = receiver.latest("c0");
    expect(seen).toMatchObject({ id: "c0", x: 12.5, y: -3, color: "#abc", state: "run" });
    sender.stop();
    receiver.stop();
    a.close();
    b.close();
  });

  it("runs host-authoritative shared items", async () => {
    const [a, b] = await pair();
    let clock = 0;
    const now = () => clock;
    const host = sharedItems(a, [{ x: 5 }], { respawnMs: 1000, now });
    const guest = sharedItems(b, [{ x: 5 }], { respawnMs: 1000, now });
    guest.take([...guest][0]);
    expect([...guest]).toEqual([]);
    expect([...host]).toEqual([]); // the host confirmed it
    clock = 2000;
    expect([...guest]).toHaveLength(1); // and it respawned everywhere
    host.stop();
    guest.stop();
    a.close();
    b.close();
  });

  it("replicates host state to guests", async () => {
    const [a, b] = await pair();
    let world = { round: 1 };
    const owned = hostState(a, { state: () => world, hz: 20 });
    const mirror = hostState(b, { state: () => ({ round: 0 }), hz: 20 });
    world = { round: 4 };
    await vi.advanceTimersByTimeAsync(60);
    expect(mirror.value).toEqual({ round: 4 });
    owned.stop();
    mirror.stop();
    a.close();
    b.close();
  });

  it("announces leaves and migrates the shared-state owner", async () => {
    const [a, b] = await pair();
    const left = vi.fn();
    b.onLeave(left);
    a.close();
    expect(left).toHaveBeenCalledWith("c0");
    expect(b.peers).toEqual([]);
    expect(b.hosting).toBe(true); // promoted, as a peer would be
    b.close();
  });

  it("counts wire traffic without re-serializing", async () => {
    const [a, b] = await pair();
    a.send({ hello: true });
    expect(a.traffic!.sent).toBe(1);
    expect(a.traffic!.sentBytes).toBeGreaterThan(0);
    expect(b.traffic!.received).toBeGreaterThan(0);
    a.close();
    b.close();
  });

  it("refuses a frame that claims to come from someone else", async () => {
    const [a, b] = await pair();
    const heard = vi.fn();
    b.onMessage(heard);

    // c0's own socket, speaking as c1: the server must drop it rather than
    // let one client forge another's identity (or the relay's).
    const encoder = new TextEncoder();
    const body = encoder.encode(JSON.stringify({ spoofed: true }));
    const asPeer = new Uint8Array([2, ...encoder.encode("c1"), 0, ...body]);
    const asRelay = new Uint8Array([0, 0, ...body]);
    sockets[0].send(asPeer);
    sockets[0].send(asRelay);
    expect(heard).not.toHaveBeenCalled();

    // The same frame sent honestly still arrives.
    const honest = new Uint8Array([2, ...encoder.encode("c0"), 0, ...body]);
    sockets[0].send(honest);
    expect(heard).toHaveBeenCalledWith("c0", { spoofed: true });
    a.close();
    b.close();
  });
});
