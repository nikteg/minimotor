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
import { bodiesCodec, bodyCodec } from "../body-codec.js";

afterEach(() => vi.useRealTimers());

/** A room that records what went onto the binary lane. */
function captureRoom() {
  const sent: Array<{ tag: string; bytes: Uint8Array }> = [];
  const room = {
    id: "me",
    peers: ["peer"],
    peerCount: 1,
    closed: false,
    send: () => {},
    onMessage: () => () => {},
    sendBytes: (tag: string, bytes: Uint8Array) => void sent.push({ tag, bytes: bytes.slice() }),
    onBytes: () => () => {},
    onLeave: () => () => {},
  } as unknown as Room<unknown>;
  return { room, sent };
}

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
        state: "climb",
        area: "forest",
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
      state: "climb",
      area: "forest",
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

  it("snaps instead of interpolating between different areas", () => {
    const next = { x: 5, y: 8, vx: 0, vy: 0, area: "cave" };
    expect(lerpBodyState({ x: 100, y: 200, vx: 1, vy: 2, area: "field" }, next, 0.1)).toEqual(next);
    expect(
      extrapolateBodyState({ x: 100, y: 200, vx: 1, vy: 2, area: "field" }, next, 1.5),
    ).toEqual(next);
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
    const { room, sent } = captureRoom();
    const body = { x: 1, y: 2, vx: 3, vy: 4, rot: 0, spin: 0 };

    const peers = syncBody(room, body, { hz: 10, now: () => 0 });
    vi.advanceTimersByTime(100);
    expect(bodyCodec().decode(sent[0].bytes)).toEqual({ state: bodyState(body), sentAt: 0 });
    peers.stop();
  });

  it("defaults single-body sync to 60 Hz", () => {
    vi.useFakeTimers();
    const { room, sent } = captureRoom();
    const peers = syncBody(room, { x: 0, y: 0, vx: 0, vy: 0 });
    vi.advanceTimersByTime(15);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    peers.stop();
  });

  it("syncs dynamic body collections with one serializer", () => {
    vi.useFakeTimers();
    const { room, sent } = captureRoom();
    const bodies = [{ id: "crate", x: 1, y: 2, vx: 3, vy: 4, rot: 0, spin: 0 }];
    const peers = syncBodies(room, () => bodies, { id: (body) => body.id, hz: 10, now: () => 0 });
    vi.advanceTimersByTime(100);
    expect(bodiesCodec().decode(sent[0].bytes)).toEqual({
      state: [{ id: "crate", state: bodyState(bodies[0]) }],
      sentAt: 0,
    });
    peers.stop();
  });

  it("packs a body snapshot far smaller than its JSON", () => {
    const state = bodyState({
      x: 123.5,
      y: 67.25,
      vel: { x: 1.5, y: -3.25 },
      w: 22,
      h: 28,
      grounded: true,
      facing: -1,
      color: "#4ecdc4",
      state: "run",
      area: "forest",
    });
    const packed = bodyCodec().encode(state, 1234.5);
    expect(packed.length).toBeLessThan(JSON.stringify(state).length / 2);
    expect(bodyCodec().decode(packed)).toEqual({ state, sentAt: 1234.5 });
  });

  it("round-trips only the fields a body actually has", () => {
    const minimal = { x: -0.5, y: 4, vx: 0, vy: 0 };
    expect(bodyCodec().decode(bodyCodec().encode(minimal, 7))).toEqual({
      state: minimal,
      sentAt: 7,
    });
  });

  it("rejects a truncated or foreign snapshot instead of decoding garbage", () => {
    const packed = bodyCodec().encode({ x: 1, y: 2, vx: 0, vy: 0, state: "idle" }, 0);
    expect(bodyCodec().decode(packed.subarray(0, 4))).toBeNull();
    expect(bodyCodec().decode(packed.subarray(0, packed.length - 2))).toBeNull();
  });
});
