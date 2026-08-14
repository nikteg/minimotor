import { describe, it, expect } from "vitest";
import { serve, serveProtocol, type ServerSocket } from "@src/net/server/room.js";
import { signaling } from "@src/net/server/signaling.js";
import type { MessageCodec, Protocol } from "@src/net/protocol.js";

// A WebSocket-like socket + server test double.
class MockSocket implements ServerSocket {
  sent: (string | Uint8Array)[] = [];
  readyState = 1;
  handlers: Record<string, (...a: any[]) => void> = {};
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  on(event: string, handler: (...a: any[]) => void) {
    this.handlers[event] = handler;
  }
  message(raw: string | Uint8Array) {
    this.handlers.message?.(raw);
  }
  close() {
    this.handlers.close?.();
  }
  json() {
    return this.sent.map((s) => JSON.parse(String(s)));
  }
}
class MockServer {
  private conn?: (s: ServerSocket) => void;
  on(event: "connection", handler: (s: ServerSocket) => void) {
    if (event === "connection") this.conn = handler;
  }
  connect(): MockSocket {
    const s = new MockSocket();
    this.conn?.(s);
    return s;
  }
}

describe("net/server room", () => {
  it("broadcasts JSON to every client", () => {
    const srv = new MockServer();
    const room = serve(srv);
    const a = srv.connect();
    const b = srv.connect();
    room.broadcast({ hi: 1 });
    expect(a.json()).toEqual([{ hi: 1 }]);
    expect(b.json()).toEqual([{ hi: 1 }]);
  });

  it("relay skips the sender", () => {
    const srv = new MockServer();
    const room = serve(srv);
    const a = srv.connect();
    const b = srv.connect();
    room.relay(room.clients[0], { m: "x" });
    expect(a.sent).toEqual([]); // sender
    expect(b.json()).toEqual([{ m: "x" }]);
  });

  it("parses inbound JSON and ignores non-JSON", () => {
    const srv = new MockServer();
    const got: unknown[] = [];
    serve(srv, { onMessage: (_c, msg) => got.push(msg) });
    const a = srv.connect();
    a.message(JSON.stringify({ type: "state", x: 3 }));
    a.message("not json{");
    expect(got).toEqual([{ type: "state", x: 3 }]);
  });

  it("uses one protocol for inbound and outbound messages", () => {
    type App = Protocol<{
      client: { type: "move"; x: number };
      server: { type: "world"; x: number };
    }>;
    const srv = new MockServer();
    const room = serveProtocol<App>(srv, {
      onMessage(client, msg) {
        room.send(client, { type: "world", x: msg.x });
      },
    });
    const client = srv.connect();
    client.message('{"type":"move","x":4}');
    expect(client.json()).toEqual([{ type: "world", x: 4 }]);
  });

  it("assigns stable ids and removes clients on close", () => {
    const srv = new MockServer();
    const left: string[] = [];
    const room = serve(srv, { onLeave: (c) => left.push(c.id) });
    const a = srv.connect();
    srv.connect();
    expect(room.clients.map((c) => c.id)).toEqual(["c0", "c1"]);
    a.close();
    expect(room.clients.map((c) => c.id)).toEqual(["c1"]);
    expect(left).toEqual(["c0"]);
  });

  it("skips sockets that aren't open", () => {
    const srv = new MockServer();
    const room = serve(srv);
    const a = srv.connect();
    a.readyState = 3; // CLOSED
    room.broadcast({ n: 1 });
    expect(a.sent).toEqual([]);
  });
});

// ---------- RoomOptions.codec ----------
// A room given no codec must behave EXACTLY as it did before the option
// existed, which is the half of this that has to keep being true; the packed
// half only has to work.

/** One tag byte plus one f32 — the smallest thing that is genuinely not text.
 *  `decode` answers undefined for anything else, which is the contract the
 *  heartbeat and a peer on an older build both rely on. */
type Tick = { type: "tick"; n: number };
const TAG = 0x7a;
const tickCodec: MessageCodec<Tick, Tick> = {
  encode(message) {
    const bytes = new Uint8Array(5);
    bytes[0] = TAG;
    new DataView(bytes.buffer).setFloat32(1, message.n, true);
    return bytes;
  },
  decode(frame) {
    if (typeof frame === "string" || frame.length !== 5 || frame[0] !== TAG) return undefined;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
    return { type: "tick", n: view.getFloat32(1, true) };
  },
};

describe("net/server room codec", () => {
  it("stays on JSON when no codec is given", () => {
    const srv = new MockServer();
    const room = serve(srv);
    const a = srv.connect();
    room.broadcast({ hi: 1 });
    expect(typeof a.sent[0]).toBe("string");
    expect(a.json()).toEqual([{ hi: 1 }]);
  });

  it("encodes send, broadcast and relay through the codec", () => {
    const srv = new MockServer();
    const room = serve<Tick, Tick>(srv, { codec: tickCodec });
    const a = srv.connect();
    const b = srv.connect();
    room.broadcast({ type: "tick", n: 1.5 });
    room.send(room.clients[0], { type: "tick", n: 2 });
    room.relay(room.clients[0], { type: "tick", n: 3 });
    expect(a.sent.every((frame) => frame instanceof Uint8Array)).toBe(true);
    expect(a.sent.map((frame) => tickCodec.decode(frame as Uint8Array)?.n)).toEqual([1.5, 2]);
    expect(b.sent.map((frame) => tickCodec.decode(frame as Uint8Array)?.n)).toEqual([1.5, 3]);
  });

  it("encodes one frame per broadcast, not one per client", () => {
    const srv = new MockServer();
    let encodes = 0;
    const room = serve<Tick, Tick>(srv, {
      codec: {
        encode(message) {
          encodes++;
          return tickCodec.encode(message);
        },
        decode: tickCodec.decode,
      },
    });
    srv.connect();
    srv.connect();
    srv.connect();
    room.broadcast({ type: "tick", n: 1 });
    expect(encodes).toBe(1);
  });

  it("decodes inbound frames and drops what the codec refuses", () => {
    const srv = new MockServer();
    const got: Tick[] = [];
    serve<Tick, Tick>(srv, { codec: tickCodec, onMessage: (_c, msg) => got.push(msg) });
    const a = srv.connect();
    a.message(tickCodec.encode({ type: "tick", n: 4 }) as Uint8Array);
    a.message(new Uint8Array(0)); // the default heartbeat frame
    a.message(new Uint8Array([0x01, 0x02])); // a lane this codec knows nothing about
    a.message('{"type":"tick","n":9}'); // valid JSON, and still not this codec's
    expect(got).toEqual([{ type: "tick", n: 4 }]);
  });

  it("carries a codec through serveProtocol in both directions", () => {
    type App = Protocol<{ client: Tick; server: Tick }>;
    const srv = new MockServer();
    const room = serveProtocol<App>(srv, {
      codec: tickCodec,
      onMessage(client, msg) {
        room.send(client, { type: "tick", n: msg.n * 2 });
      },
    });
    const client = srv.connect();
    client.message(tickCodec.encode({ type: "tick", n: 21 }) as Uint8Array);
    expect(tickCodec.decode(client.sent[0] as Uint8Array)).toEqual({ type: "tick", n: 42 });
  });
});

describe("net/server signaling", () => {
  it("welcomes with id + existing peers, announces join/leave, routes signals", () => {
    const srv = new MockServer();
    signaling(srv);
    const a = srv.connect();
    // first peer is the host — welcome names itself as host
    expect(a.json()).toEqual([{ type: "welcome", id: "c0", host: "c0", peers: [] }]);

    const b = srv.connect();
    // b learns c0 is the host and already present; a is told b joined
    expect(b.json()[0]).toEqual({ type: "welcome", id: "c1", host: "c0", peers: ["c0"] });
    expect(a.json().at(-1)).toEqual({ type: "peer-join", id: "c1" });

    // a signals b → b receives it tagged with the sender
    a.message(JSON.stringify({ type: "signal", to: "c1", signal: { type: "offer", sdp: "s" } }));
    expect(b.json().at(-1)).toEqual({
      type: "signal",
      from: "c0",
      signal: { type: "offer", sdp: "s" },
    });

    a.close();
    // host (c0) left: b hears the leave, then that it's the promoted host
    expect(b.json().at(-2)).toEqual({ type: "peer-leave", id: "c0" });
    expect(b.json().at(-1)).toEqual({ type: "host", id: "c1" });
  });

  it("promotes the oldest remaining peer when the host leaves", () => {
    const srv = new MockServer();
    signaling(srv);
    const a = srv.connect(); // c0 — host
    const b = srv.connect(); // c1
    const c = srv.connect(); // c2

    a.close(); // host drops
    expect(b.json().at(-1)).toEqual({ type: "host", id: "c1" }); // c1 promoted
    expect(c.json().at(-1)).toEqual({ type: "host", id: "c1" });

    // a fresh peer now learns c1 is the host
    const d = srv.connect();
    expect(d.json()[0]).toEqual({
      type: "welcome",
      id: "c3",
      host: "c1",
      peers: ["c1", "c2"],
    });
  });
});
