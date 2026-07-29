import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBodyState, bodyState, lerpBodyState, syncBody } from "../body-state.js";
import type { Room } from "../room.js";

afterEach(() => vi.useRealTimers());

describe("Net.bodyState", () => {
  it("flattens lightweight bodies and keeps animation metadata", () => {
    expect(
      bodyState({
        x: 1,
        y: 2,
        w: 32,
        h: 32,
        vel: { x: -3, y: 4 },
        grounded: true,
        facing: -1,
      }),
    ).toEqual({ x: 1, y: 2, vx: -3, vy: 4, grounded: true, facing: -1 });
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
});
