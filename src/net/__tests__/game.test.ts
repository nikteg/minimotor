import { afterEach, describe, expect, it, vi } from "vitest";
import { game, playerColor } from "@src/net/game.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** No relay: every join attempt fails, so `Net.game` must fall back to solo. */
class DeadWS {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = "arraybuffer";
  constructor() {
    queueMicrotask(() => this.onclose?.());
  }
  send() {}
  close() {}
}

describe("Net.game", () => {
  it("falls back to a solo game when no relay answers", async () => {
    vi.stubGlobal("WebSocket", DeadWS);
    const player = { x: 0, y: 0, vel: { x: 0, y: 0 }, color: "#fff" };
    const net = await game({ url: "ws://nope/ws-signal", room: "test" });
    const players = net.share(player);

    expect(net.online).toBe(false);
    expect(net.count).toBe(1);
    expect(net.index).toBe(0);
    expect([...players]).toEqual([]);
    // The whole surface stays callable offline — that is the point of it.
    expect(players.latest("nobody")).toBeNull();
    expect(players.size).toBe(0);
    expect(net.rttMs).toBe(0);
    expect(typeof net.now).toBe("number");
    net.events.emit("anything" as never, {} as never);
    players.snap("nobody");

    const coins = net.items([{ x: 4 }], { respawnMs: 1000 });
    expect([...coins]).toHaveLength(1);
    coins.take([...coins][0]);
    expect([...coins]).toHaveLength(0); // solo host takes it immediately
    coins.stop();
    net.close();
  });

  it("shares nothing until asked, and can share several things", async () => {
    vi.stubGlobal("WebSocket", DeadWS);
    const net = await game({ url: "ws://nope/ws-signal" });
    const players = net.share({ x: 0, y: 0, vx: 0, vy: 0 });
    const scores = net.share(() => ({ score: 3, name: "a" }));
    expect([...players]).toEqual([]);
    expect([...scores]).toEqual([]);
    // close() stops every channel it handed out.
    net.close();
  });

  it("accepts a plain ice server list without WebRTC types", async () => {
    vi.stubGlobal("WebSocket", DeadWS);
    const net = await game({
      url: "ws://nope/ws-signal",
      ice: [
        "stun:stun.example.com:3478",
        { url: "turn:turn.example.com", username: "u", password: "p" },
      ],
    });
    expect(net.online).toBe(false);
    net.close();
  });

  it("gives each player slot its own color", () => {
    const colors = [0, 1, 2, 3].map(playerColor);
    expect(new Set(colors).size).toBe(4);
    expect(colors[0]).toMatch(/^hsl\(/);
  });
});
