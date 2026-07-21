import { describe, it, expect, vi } from "vitest";
import { createClock } from "../clock.js";
import { easeOut, linear } from "../mathf.js";

describe("Clock timers", () => {
  it("after fires once at/after the delay, then is gone", () => {
    const c = createClock();
    const fn = vi.fn();
    c.after(100, fn);
    c.advance(60);
    expect(fn).not.toHaveBeenCalled();
    c.advance(60); // total 120 >= 100
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.size).toBe(0);
    c.advance(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("every repeats and can catch up multiple fires in one big step", () => {
    const c = createClock();
    const fn = vi.fn();
    c.every(100, fn);
    c.advance(250); // fires at 100 and 200 → 2
    expect(fn).toHaveBeenCalledTimes(2);
    c.advance(100); // 300 → once more
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("cancel stops a pending timer", () => {
    const c = createClock();
    const fn = vi.fn();
    const cancel = c.after(100, fn);
    cancel();
    c.advance(500);
    expect(fn).not.toHaveBeenCalled();
    expect(c.size).toBe(0);
  });

  it("a repeating timer can cancel itself from its callback", () => {
    const c = createClock();
    let n = 0;
    const cancel = c.every(50, () => {
      n++;
      if (n === 2) cancel();
    });
    c.advance(500); // would fire 10x, but self-cancels after 2
    expect(n).toBe(2);
  });
});

describe("Clock tweens", () => {
  it("interpolates fields and lands exactly on the target", () => {
    const c = createClock();
    const obj = { x: 0, alpha: 1 };
    c.tween(obj, { x: 100, alpha: 0 }, 100, linear);
    c.advance(50);
    expect(obj.x).toBeCloseTo(50);
    expect(obj.alpha).toBeCloseTo(0.5);
    c.advance(50);
    expect(obj.x).toBe(100);
    expect(obj.alpha).toBe(0);
    expect(c.size).toBe(0);
  });

  it("applies easing", () => {
    const c = createClock();
    const obj = { v: 0 };
    c.tween(obj, { v: 100 }, 100, easeOut);
    c.advance(50); // easeOut(0.5) = 0.75
    expect(obj.v).toBeCloseTo(75);
  });

  it("fires onDone once at completion", () => {
    const c = createClock();
    const done = vi.fn();
    c.tween({ x: 0 }, { x: 1 }, 100, linear, done);
    c.advance(100);
    expect(done).toHaveBeenCalledTimes(1);
    c.advance(100);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("cancel stops a tween mid-flight and leaves the value where it was", () => {
    const c = createClock();
    const obj = { x: 0 };
    const cancel = c.tween(obj, { x: 100 }, 100, linear);
    c.advance(30);
    cancel();
    c.advance(1000);
    expect(obj.x).toBeCloseTo(30);
  });
});
