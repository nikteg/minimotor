import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBodyState,
  bodyState,
  extrapolateBodyState,
  lerpBodyState,
  syncBodies,
  syncBody,
} from "../body-state.js";
import type { Room } from "../room.js";

afterEach(() => vi.useRealTimers());

describe("Net.bodyState", () => {
  it("flattens lightweight bodies and keeps collision/animation metadata", () => {
    expect(
      bodyState({
        x: 1,
        y: 2,
        w: 32,
        h: 32,
        vel: { x: -3, y: 4 },
        grounded: true,
        facing: -1,
        color: "#4ecdc4",
      }),
    ).toEqual({
      x: 1,
      y: 2,
      vx: -3,
      vy: 4,
      w: 32,
      h: 32,
      grounded: true,
      facing: -1,
      color: "#4ecdc4",
    });
  });

  it("supports Physics2D bodies", () => {
    expect(bodyState({ x: 1, y: 2, vx: 3, vy: 4, rot: 0.5, spin: -0.25 })).toEqual({
      x: 1,
      y: 2,
      vx: 3,
      vy: 4,
      rot: 0.5,
      spin: -0.25,
    });
  });

  it("interpolates Physics2D rotation across the shortest arc", () => {
    const a = { x: 0, y: 0, vx: 0, vy: 0, rot: Math.PI - 0.1 };
    const b = { x: 10, y: 0, vx: 2, vy: 0, rot: -Math.PI + 0.1 };
    const mid = lerpBodyState(a, b, 0.5);
    expect(mid.x).toBe(5);
    expect(Math.abs(mid.rot)).toBeCloseTo(Math.PI);
  });

  it("extrapolates observed motion without assuming velocity units", () => {
    expect(
      extrapolateBodyState(
        { x: 0, y: 5, vx: 999, vy: 999 },
        { x: 10, y: 15, vx: 999, vy: 999 },
        1.5,
      ),
    ).toMatchObject({ x: 15, y: 20 });
  });

  it("applies snapshots to nested and Physics2D velocity shapes", () => {
    const nested = { x: 0, y: 0, vel: { x: 0, y: 0 }, grounded: false };
    applyBodyState(nested, { x: 1, y: 2, vx: 3, vy: 4, grounded: true });
    expect(nested).toEqual({ x: 1, y: 2, vel: { x: 3, y: 4 }, grounded: true });

    const physics = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0 };
    applyBodyState(physics, { x: 1, y: 2, vx: 3, vy: 4, rot: 0.5, spin: 0.25 });
    expect(physics).toEqual({ x: 1, y: 2, vx: 3, vy: 4, rot: 0.5, spin: 0.25 });
  });

  it("syncs a live body with one call", () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const room = {
      peers: ["peer"],
      peerCount: 1,
      closed: false,
      send: (message: unknown) => void sent.push(message),
      onMessage: () => () => {},
      onLeave: () => () => {},
    } as unknown as Room<unknown>;
    const body = { x: 1, y: 2, vx: 3, vy: 4, rot: 0, spin: 0 };

    const peers = syncBody(room, body, { hz: 10, now: () => 0 });
    vi.advanceTimersByTime(100);
    expect(sent[0]).toMatchObject({ s: bodyState(body) });
    peers.stop();
  });

  it("defaults single-body sync to 60 Hz", () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const room = {
      peers: ["peer"],
      peerCount: 1,
      closed: false,
      send: (message: unknown) => void sent.push(message),
      onMessage: () => () => {},
      onLeave: () => () => {},
    } as unknown as Room<unknown>;
    const peers = syncBody(room, { x: 0, y: 0, vx: 0, vy: 0 });
    vi.advanceTimersByTime(15);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    peers.stop();
  });

  it("syncs dynamic body collections with one serializer", () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const room = {
      peers: ["peer"],
      peerCount: 1,
      closed: false,
      send: (message: unknown) => void sent.push(message),
      onMessage: () => () => {},
      onLeave: () => () => {},
    } as unknown as Room<unknown>;
    const bodies = [{ id: "crate", x: 1, y: 2, vx: 3, vy: 4, rot: 0, spin: 0 }];
    const peers = syncBodies(room, () => bodies, { id: (body) => body.id, hz: 10 });
    vi.advanceTimersByTime(100);
    expect(sent[0]).toMatchObject({
      entities: [{ id: "crate", state: bodyState(bodies[0]) }],
    });
    peers.stop();
  });
});
