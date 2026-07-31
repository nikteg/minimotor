// Module-local scalar math tests.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  lerp,
  clamp,
  remap,
  pulse,
  wave,
  linear,
  easeIn,
  easeOut,
  easeInOut,
  randRange,
  randInt,
  randItem,
  distance,
  angleBetween,
} from "@src/math/mathf.js";

describe("Mathf", () => {
  it("lerp interpolates and extrapolates", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it("clamp bounds to the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("remap moves between ranges", () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(remap(0, 0, 1, -1, 1)).toBe(-1);
  });

  it("pulse stays in 0..1 and peaks/troughs at the sine extremes", () => {
    expect(pulse(0)).toBeCloseTo(0.5);
    expect(pulse(Math.PI / 2)).toBeCloseTo(1);
    expect(pulse(-Math.PI / 2)).toBeCloseTo(0);
  });

  it("wave scales sine by amplitude", () => {
    expect(wave(Math.PI / 2, 3)).toBeCloseTo(3);
    expect(wave(0)).toBe(0);
  });

  it("easings hit the 0 and 1 endpoints", () => {
    for (const e of [linear, easeIn, easeOut, easeInOut]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
    }
  });

  it("easing shapes differ at the midpoint", () => {
    expect(linear(0.5)).toBeCloseTo(0.5);
    expect(easeIn(0.5)).toBeCloseTo(0.25); // slow start
    expect(easeOut(0.5)).toBeCloseTo(0.75); // fast start
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  describe("randomness", () => {
    afterEach(() => vi.restoreAllMocks());

    it("randRange maps 0 and ~1 to the range ends", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(randRange(10, 20)).toBe(10);
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      expect(randRange(10, 20)).toBe(15);
    });

    it("randInt is inclusive at both ends", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(randInt(3, 6)).toBe(3);
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      expect(randInt(3, 6)).toBe(6);
    });

    it("randItem indexes into the array", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      expect(randItem(["a", "b", "c", "d"])).toBe("c");
    });
  });

  it("distance is the Euclidean length", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it("angleBetween points from a toward b", () => {
    expect(angleBetween(0, 0, 1, 0)).toBeCloseTo(0);
    expect(angleBetween(0, 0, 0, 1)).toBeCloseTo(Math.PI / 2);
  });
});
