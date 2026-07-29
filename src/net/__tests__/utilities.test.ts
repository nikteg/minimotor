import { afterEach, describe, expect, it, vi } from "vitest";
import type { Room, RoomStatus } from "../room.js";
import { events } from "../events.js";
import { bindEntities, syncEntities } from "../entities.js";
import { hasAuthority, memberIndex, own, owns } from "../ownership.js";
import { networkTime } from "../time.js";
import { createInputBuffer, createPrediction } from "../prediction.js";
import { monitorRoom, simulateNetwork } from "../diagnostics.js";
import { hostState } from "../host-state.js";
import { sharedItems } from "../shared-items.js";

interface TestRoom extends Room<unknown> {
  emit(from: string, message: unknown): void;
}

function pair(): [TestRoom, TestRoom] {
  const make = (id: string, hostId: string): TestRoom => {
    const messages = new Set<(from: string, message: unknown) => void>();
    const joins = new Set<(id: string) => void>();
    const leaves = new Set<(id: string) => void>();
    const statuses = new Set<(status: RoomStatus) => void>();
    return {
      id,
      peers: [],
      peerCount: 1,
      hostId,
      hosting: id === hostId,
      closed: false,
      status: "connected",
      onStatus(fn) {
        statuses.add(fn);
        return () => statuses.delete(fn);
      },
      send() {},
      onMessage(fn) {
        messages.add(fn);
        return () => messages.delete(fn);
      },
      onJoin(fn) {
        joins.add(fn);
        return () => joins.delete(fn);
      },
      onLeave(fn) {
        leaves.add(fn);
        return () => leaves.delete(fn);
      },
      close() {},
      emit(from, message) {
        for (const fn of messages) fn(from, message);
      },
    };
  };
  const a = make("a", "a");
  const b = make("b", "a");
  (a.peers as string[]).push("b");
  (b.peers as string[]).push("a");
  a.send = (message) => b.emit("a", message);
  b.send = (message) => a.emit("b", message);
  return [a, b];
}

afterEach(() => vi.useRealTimers());

describe("Net multiplayer utilities", () => {
  it("sends typed events without consuming unrelated room messages", () => {
    const [a, b] = pair();
    const outgoing = events<{ shoot: { damage: number } }>(a);
    const incoming = events<{ shoot: { damage: number } }>(b);
    const handler = vi.fn();
    incoming.on("shoot", handler);
    outgoing.emit("shoot", { damage: 7 });
    expect(handler).toHaveBeenCalledWith({ damage: 7 }, "a");
    outgoing.stop();
    incoming.stop();
  });

  it("routes requests to the current host, including local host requests", () => {
    const [hostRoom, guestRoom] = pair();
    const host = events<{ collect: { id: number } }>(hostRoom);
    const guest = events<{ collect: { id: number } }>(guestRoom);
    const handler = vi.fn();
    host.onRequest("collect", handler);
    guest.request("collect", { id: 2 });
    host.request("collect", { id: 3 });
    expect(handler.mock.calls).toEqual([
      [{ id: 2 }, "b"],
      [{ id: 3 }, "a"],
    ]);
    host.stop();
    guest.stop();
  });

  it("syncs, binds, and despawns dynamic entities", () => {
    vi.useFakeTimers();
    const [a, b] = pair();
    let local = [{ id: "ball", x: 4 }];
    const sent = syncEntities(a, {
      entities: () => local,
      id: (entity) => entity.id,
      state: (entity) => ({ x: entity.x }),
      hz: 10,
      delayMs: 0,
    });
    const received = syncEntities(b, {
      entities: () => [],
      id: () => "",
      state: () => ({}),
      hz: 10,
      delayMs: 0,
    });
    vi.advanceTimersByTime(100);
    expect([...received]).toEqual([{ x: 4, owner: "a", id: "ball" }]);

    const destroyed = vi.fn();
    const binding = bindEntities(received, {
      create: (state) => ({ x: state.x }),
      apply: (target, state) => (target.x = state.x),
      destroy: destroyed,
    });
    binding.update();
    expect(binding.entities.size).toBe(1);
    local = [];
    vi.advanceTimersByTime(100);
    binding.update();
    expect(binding.entities.size).toBe(0);
    expect(destroyed).toHaveBeenCalledOnce();
    binding.stop();
    sent.stop();
    received.stop();
  });

  it("provides local and host ownership helpers", () => {
    const [host, guest] = pair();
    const state = own(guest, { x: 1 });
    expect(state).toEqual({ x: 1, owner: "b" });
    expect(owns(guest, state)).toBe(true);
    expect(owns(host, state)).toBe(false);
    expect(hasAuthority(host)).toBe(true);
    expect(memberIndex(host)).toBe(0);
    expect(memberIndex(guest)).toBe(1);
  });

  it("synchronizes guest time to the host", () => {
    vi.useFakeTimers();
    const [host, guest] = pair();
    const hostClock = networkTime(host, { now: () => 1000 });
    const guestClock = networkTime(guest, { now: () => 100 });
    expect(guestClock.ready).toBe(true);
    expect(guestClock.now).toBe(1000);
    expect(guestClock.offsetMs).toBe(900);
    hostClock.stop();
    guestClock.stop();
  });

  it("syncs shared state from the current host", () => {
    vi.useFakeTimers();
    const [host, guest] = pair();
    let coins = [0, 0];
    const hosted = hostState(host, { state: () => coins, hz: 10 });
    const remote = hostState(guest, { state: () => [], hz: 10 });
    coins = [0, 5000];
    vi.advanceTimersByTime(100);
    expect(remote.value).toEqual([0, 5000]);
    hosted.stop();
    remote.stop();
  });

  it("shares authoritative respawning items with optimistic hiding", () => {
    vi.useFakeTimers();
    const [hostRoom, guestRoom] = pair();
    let now = 100;
    const hostTaken = vi.fn();
    const guestTaken = vi.fn();
    const hostEffect = vi.fn();
    const guestEffect = vi.fn();
    const host = sharedItems(hostRoom, [{ x: 5 }], {
      channel: "coins",
      respawnMs: 1000,
      now: () => now,
      canTake: (_coin, by) => by === "b",
      onTake: hostTaken,
      onEffect: hostEffect,
    });
    const guest = sharedItems(guestRoom, [{ x: 5 }], {
      channel: "coins",
      respawnMs: 1000,
      now: () => now,
      onTake: guestTaken,
      onEffect: guestEffect,
    });

    const coin = [...guest][0];
    guest.take(coin);
    expect([...guest]).toEqual([]);
    expect([...host]).toEqual([]);
    expect(hostTaken).toHaveBeenCalledWith(expect.objectContaining({ x: 5, id: 0 }), "b");
    expect(guestTaken).toHaveBeenCalledOnce();
    expect(hostEffect).toHaveBeenCalledOnce();
    expect(guestEffect).toHaveBeenCalledOnce();

    now = 1100;
    expect([...host]).toHaveLength(1);
    expect([...guest]).toHaveLength(1);
    host.stop();
    guest.stop();
  });

  it("plays a guest pickup effect immediately without waiting for authority", () => {
    vi.useFakeTimers();
    const [hostRoom, guestRoom] = pair();
    const host = sharedItems(hostRoom, [{ x: 5 }], { canTake: () => false });
    const effect = vi.fn();
    const guest = sharedItems(guestRoom, [{ x: 5 }], { onEffect: effect });
    guest.take([...guest][0]);
    expect(effect).toHaveBeenCalledWith(expect.objectContaining({ x: 5, id: 0 }), "b");
    host.stop();
    guest.stop();
  });

  it("reconciles predicted input and buffers authoritative input", () => {
    let x = 0;
    const prediction = createPrediction<number, number>({
      restore: (state) => (x = state),
      simulate: (input) => (x += input),
    });
    const first = prediction.step(2, 16);
    prediction.step(3, 16);
    prediction.reconcile(1, first.sequence);
    expect(x).toBe(4);
    expect(prediction.pending).toBe(1);

    const buffer = createInputBuffer<number>();
    expect(buffer.push("p", first)).toBe(true);
    expect(buffer.push("p", first)).toBe(false);
    expect(buffer.drain("p")).toEqual([first]);
    expect(buffer.acknowledged("p")).toBe(first.sequence);
  });

  it("monitors traffic and simulates latency/loss once per message", () => {
    vi.useFakeTimers();
    const [rawA, rawB] = pair();
    const a = monitorRoom(rawA, () => 42);
    const b = monitorRoom(rawB, () => 42);
    const received = vi.fn();
    b.onMessage(received);
    b.onMessage(() => {});
    a.send({ hello: true });
    expect(a.stats.sentMessages).toBe(1);
    expect(b.stats.receivedMessages).toBe(1);

    const delayed = simulateNetwork(a, { latencyMs: 100, random: () => 0.5 });
    delayed.send({ later: true });
    expect(received).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(received).toHaveBeenCalledTimes(2);

    const dropped = simulateNetwork(a, { loss: 1, random: () => 0 });
    dropped.send({ never: true });
    vi.runAllTimers();
    expect(received).toHaveBeenCalledTimes(2);
  });
});
