import { describe, it, expect } from "vitest";
import { lerp, clamp, remap, pulse, wave, linear, easeIn, easeOut, easeInOut } from "./mathf.js";

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
});
