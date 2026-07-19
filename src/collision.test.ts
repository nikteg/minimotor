import { describe, it, expect } from "vitest";
import { rectsOverlap, circleHit, crossedDown } from "./collision.js";

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
