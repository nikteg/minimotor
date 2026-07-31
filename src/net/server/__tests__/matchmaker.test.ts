import { describe, it, expect } from "vitest";
import { matchmake } from "@src/net/server/matchmaker.js";
import type { ServerSocket } from "@src/net/server/room.js";

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
  message(raw: unknown) {
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

const routeJoin = { route: (m: any) => (m.type === "join" ? String(m.code) : null) };

describe("net/server matchmaker", () => {
  it("groups clients by code and scopes broadcast to a room", () => {
    const srv = new MockServer();
    const mm = matchmake(srv, routeJoin);
    const a = srv.connect();
    const b = srv.connect();
    const c = srv.connect();
    a.message(JSON.stringify({ type: "join", code: "A" }));
    b.message(JSON.stringify({ type: "join", code: "A" }));
    c.message(JSON.stringify({ type: "join", code: "B" }));

    expect(mm.rooms.map((r) => r.code).sort()).toEqual(["A", "B"]);
    expect(mm.room("A")!.clients.length).toBe(2);

    mm.room("A")!.broadcast({ hi: 1 });
    expect(a.json()).toEqual([{ hi: 1 }]);
    expect(b.json()).toEqual([{ hi: 1 }]);
    expect(c.sent).toEqual([]); // different room
  });

  it("delivers post-join messages to onMessage with the room; relay skips sender", () => {
    const srv = new MockServer();
    const got: Array<[string, unknown]> = [];
    matchmake(srv, {
      ...routeJoin,
      onMessage: (client, msg, room) => {
        got.push([room.code, msg]);
        room.relay(client, msg);
      },
    });
    const a = srv.connect();
    const b = srv.connect();
    a.message(JSON.stringify({ type: "join", code: "R" }));
    b.message(JSON.stringify({ type: "join", code: "R" }));
    a.message(JSON.stringify({ move: 3 })); // post-join
    expect(got).toEqual([["R", { move: 3 }]]);
    expect(b.json().at(-1)).toEqual({ move: 3 }); // relayed to b, not a
    expect(a.json()).toEqual([]); // a is the sender + never got a broadcast
  });

  it("ignores messages from unroutable (unjoined) clients", () => {
    const srv = new MockServer();
    let messages = 0;
    matchmake(srv, { ...routeJoin, onMessage: () => messages++ });
    const a = srv.connect();
    a.message(JSON.stringify({ move: 1 })); // no join yet → dropped
    expect(messages).toBe(0);
  });

  it("drops a room when its last client leaves", () => {
    const srv = new MockServer();
    const left: string[] = [];
    const mm = matchmake(srv, { ...routeJoin, onLeave: (_c, room) => left.push(room.code) });
    const a = srv.connect();
    const b = srv.connect();
    a.message(JSON.stringify({ type: "join", code: "X" }));
    b.message(JSON.stringify({ type: "join", code: "X" }));
    a.close();
    expect(mm.room("X")!.clients.length).toBe(1); // still open (b remains)
    b.close();
    expect(mm.room("X")).toBeUndefined(); // empty → dropped
    expect(left).toEqual(["X", "X"]);
  });
});
