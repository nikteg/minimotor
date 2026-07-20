import { describe, expect, it } from "vitest";
import { wrap, wrappedDelta, wrappedDistance } from "./goodies.js";

describe("Goodies.wrap", () => {
  it("wraps positive, negative and multi-span values into zero-based bounds", () => {
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(12, 10)).toBe(2);
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(-31, 10)).toBe(9);
  });

  it("supports an explicit minimum", () => {
    expect(wrap(180, -180, 180)).toBe(-180);
    expect(wrap(-181, -180, 180)).toBe(179);
    expect(wrap(540, -180, 180)).toBe(-180);
  });

  it("rejects empty, reversed and non-finite ranges", () => {
    expect(() => wrap(1, 0)).toThrow(RangeError);
    expect(() => wrap(1, 4, 4)).toThrow(RangeError);
    expect(() => wrap(1, 5, 4)).toThrow(RangeError);
    expect(() => wrap(1, Infinity)).toThrow(RangeError);
  });
});

describe("Goodies toroidal geometry", () => {
  it("returns the shortest signed displacement across either edge", () => {
    expect(wrappedDelta(98, 2, 100)).toBe(4);
    expect(wrappedDelta(2, 98, 100)).toBe(-4);
    expect(wrappedDelta(10, 40, 100)).toBe(30);
  });

  it("measures the shortest 2D wrapped distance", () => {
    expect(wrappedDistance(98, 49, 2, 1, 100, 50)).toBeCloseTo(Math.hypot(4, 2));
  });
});
