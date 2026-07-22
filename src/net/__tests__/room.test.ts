import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sync, type Room } from "../room.js";

// A fake room: pure handler plumbing, captured sends.
function fakeRoom() {
  const messageFns = new Set<(from: string, msg: unknown) => void>();
  const leaveFns = new Set<(id: string) => void>();
  const sent: unknown[] = [];
  const room: Room<unknown> & {
    emit(from: string, msg: unknown): void;
    leave(id: string): void;
    sent: unknown[];
  } = {
    id: "me",
    peers: [],
    hosting: false,
    closed: false,
    send: (msg) => void sent.push(msg),
    onMessage(fn) {
      messageFns.add(fn);
      return () => messageFns.delete(fn);
    },
    onJoin: () => () => {},
    onLeave(fn) {
      leaveFns.add(fn);
      return () => leaveFns.delete(fn);
    },
    close() {},
    emit(from, msg) {
      for (const fn of messageFns) fn(from, msg);
    },
    leave(id) {
      for (const fn of leaveFns) fn(id);
    },
    sent,
  };
  return room;
}

describe("Net.sync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("broadcasts our state at the configured rate", () => {
    const room = fakeRoom();
    let x = 1;
    const ghosts = sync(room, { hz: 10, state: () => ({ x }), now: () => 0 });
    vi.advanceTimersByTime(100);
    expect(room.sent.length).toBe(1);
    x = 5;
    vi.advanceTimersByTime(100);
    expect(room.sent.length).toBe(2);
    expect((room.sent[1] as { s: { x: number } }).s.x).toBe(5);
    ghosts.stop();
    vi.advanceTimersByTime(1000);
    expect(room.sent.length).toBe(2); // stopped
  });

  it("collects peer snapshots and yields interpolated states with ids", () => {
    const room = fakeRoom();
    let now = 0;
    const ghosts = sync<{ x: number }>(room, {
      hz: 10,
      state: () => ({ x: 0 }),
      delayMs: 0,
      now: () => now,
    });
    room.emit("peer-1", { __mm_sync: 1, s: { x: 10 } });
    now = 100;
    room.emit("peer-1", { __mm_sync: 1, s: { x: 20 } });
    const states = [...ghosts];
    expect(states.length).toBe(1);
    expect(states[0].id).toBe("peer-1");
    expect(states[0].x).toBeGreaterThanOrEqual(10);
    expect(states[0].x).toBeLessThanOrEqual(20);
    ghosts.stop();
  });

  it("ignores non-sync room traffic and drops leavers", () => {
    const room = fakeRoom();
    const ghosts = sync<{ x: number }>(room, { hz: 10, state: () => ({ x: 0 }), now: () => 0 });
    room.emit("peer-1", { hello: true }); // plain game message: not ours
    expect(ghosts.size).toBe(0);
    room.emit("peer-1", { __mm_sync: 1, s: { x: 1 } });
    expect(ghosts.size).toBe(1);
    room.leave("peer-1");
    expect(ghosts.size).toBe(0);
    ghosts.stop();
  });

  it("prunes peers that go quiet past the timeout", () => {
    const room = fakeRoom();
    let now = 0;
    const ghosts = sync<{ x: number }>(room, {
      hz: 10,
      state: () => ({ x: 0 }),
      timeoutMs: 500,
      delayMs: 0,
      now: () => now,
    });
    room.emit("peer-1", { __mm_sync: 1, s: { x: 1 } });
    now = 1000;
    expect([...ghosts].length).toBe(0); // pruned on iteration
    ghosts.stop();
  });
});
