import { describe, it, expect } from "vitest";
import { serve, type ServerSocket } from "../room.js";
import { signaling } from "../signaling.js";

// A WebSocket-like socket + server test double.
class MockSocket implements ServerSocket {
  sent: string[] = [];
  readyState = 1;
  handlers: Record<string, (...a: any[]) => void> = {};
  send(data: string) {
    this.sent.push(data);
  }
  on(event: string, handler: (...a: any[]) => void) {
    this.handlers[event] = handler;
  }
  message(raw: string) {
    this.handlers.message?.(raw);
  }
  close() {
    this.handlers.close?.();
  }
  json() {
    return this.sent.map((s) => JSON.parse(s));
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

describe("net/server signaling", () => {
  it("welcomes with id + existing peers, announces join/leave, routes signals", () => {
    const srv = new MockServer();
    signaling(srv);
    const a = srv.connect();
    expect(a.json()).toEqual([{ type: "welcome", id: "c0", peers: [] }]);

    const b = srv.connect();
    // b learns c0 is already present; a is told b joined
    expect(b.json()[0]).toEqual({ type: "welcome", id: "c1", peers: ["c0"] });
    expect(a.json().at(-1)).toEqual({ type: "peer-join", id: "c1" });

    // a signals b → b receives it tagged with the sender
    a.message(JSON.stringify({ type: "signal", to: "c1", signal: { type: "offer", sdp: "s" } }));
    expect(b.json().at(-1)).toEqual({
      type: "signal",
      from: "c0",
      signal: { type: "offer", sdp: "s" },
    });

    a.close();
    expect(b.json().at(-1)).toEqual({ type: "peer-leave", id: "c0" });
  });
});
