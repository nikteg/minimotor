import { describe, it, expect } from "vitest";
import { rectsOverlap, circleHit, crossedDown, sweptAABB } from "../collision.js";

describe("rectsOverlap", () => {
  it("overlapping", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true));
  it("edge x", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false));
  it("edge y", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 })).toBe(false));
  it("separated", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false));
  it("contained", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 25, y: 25, w: 10, h: 10 })).toBe(
      true,
    ));
});

describe("circleHit", () => {
  it("true when circles overlap", () => expect(circleHit(0, 0, 10, 5, 0, 10)).toBe(true));
  it("false when farther apart than radii", () => expect(circleHit(0, 0, 5, 20, 0, 5)).toBe(false));
  it("false at the exact touching distance (strict)", () =>
    expect(circleHit(0, 0, 5, 10, 0, 5)).toBe(false));
});

describe("crossedDown", () => {
  it("true when the edge crosses the threshold downward", () =>
    expect(crossedDown(98, 102, 100)).toBe(true));
  it("false when still above the threshold", () => expect(crossedDown(80, 95, 100)).toBe(false));
  it("false when already below (no crossing)", () =>
    expect(crossedDown(102, 110, 100)).toBe(false));
});

describe("sweptAABB", () => {
  const player = { x: 0, y: 0, w: 10, h: 10 };

  it("catches a fast body that would tunnel through a thin target", () => {
    // A 2px-wide wall 50px to the right; the player moves 100px right this step.
    // A point-in-time overlap would miss it; the sweep catches it.
    const wall = { x: 50, y: 0, w: 2, h: 10 };
    expect(rectsOverlap({ ...player, x: 100 }, wall)).toBe(false); // end-of-step: past it
    const hit = sweptAABB(player, 100, 0, wall);
    expect(hit).not.toBeNull();
    // Player's right edge (x=10) reaches the wall's left face (x=50) after 40 of
    // the 100px move.
    expect(hit!.t).toBeCloseTo(0.4);
    expect(hit).toMatchObject({ nx: -1, ny: 0 });
  });

  it("returns null when the motion stays clear of the target", () => {
    const wall = { x: 50, y: 100, w: 10, h: 10 }; // far below the sweep line
    expect(sweptAABB(player, 100, 0, wall)).toBeNull();
  });

  it("returns null when the move stops short of the target", () => {
    const wall = { x: 50, y: 0, w: 10, h: 10 };
    expect(sweptAABB(player, 20, 0, wall)).toBeNull(); // only reaches x=20, wall at 50
  });

  it("reports null for boxes that already overlap (entry is in the past)", () => {
    const wall = { x: 5, y: 0, w: 10, h: 10 }; // overlapping at start
    expect(sweptAABB(player, 100, 0, wall)).toBeNull();
    // resting overlap is rectsOverlap's job:
    expect(rectsOverlap(player, wall)).toBe(true);
  });

  it("detects a vertical (no horizontal motion) drop onto a target", () => {
    const floor = { x: 0, y: 50, w: 10, h: 10 };
    const hit = sweptAABB(player, 0, 100, floor);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(0.4); // 40px gap over a 100px move
    expect(hit).toMatchObject({ nx: 0, ny: -1 });
  });

  it("returns null when a purely vertical move never overlaps in x", () => {
    const floor = { x: 50, y: 50, w: 10, h: 10 }; // off to the side
    expect(sweptAABB(player, 0, 100, floor)).toBeNull();
  });
});
