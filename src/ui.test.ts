import { describe, expect, it, vi } from "vitest";
import { pointInRect } from "./collision.js";
import { bar, buttonState, createFloats } from "./ui.js";

const mockCtx = () => {
  const calls: {
    fillText: [string, number, number][];
    fillRect: [number, number, number, number][];
  } = { fillText: [], fillRect: [] };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillText: (t: string, x: number, y: number) => calls.fillText.push([t, x, y]),
    fillRect: (x: number, y: number, w: number, h: number) => calls.fillRect.push([x, y, w, h]),
    strokeRect: vi.fn(),
    set globalAlpha(_v: number) {},
    get globalAlpha() {
      return 1;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe("UI floats", () => {
  it("rise, fade and expire on the fixed step", () => {
    const floats = createFloats();
    floats.spawn("+100", 50, 200, { vy: -100, life: 500 });
    expect(floats.size).toBe(1);

    floats.advance(250);
    const { ctx, calls } = mockCtx();
    floats.draw(ctx);
    expect(calls.fillText).toEqual([["+100", 50, 175]]); // rose 25px in 250ms

    floats.advance(250); // lifetime exhausted
    expect(floats.size).toBe(0);
    const second = mockCtx();
    floats.draw(second.ctx);
    expect(second.calls.fillText).toEqual([]);
  });

  it("clear() empties the pool", () => {
    const floats = createFloats();
    floats.spawn("a", 0, 0);
    floats.spawn("b", 0, 0);
    expect(floats.size).toBe(2);
    floats.clear();
    expect(floats.size).toBe(0);
  });
});

describe("UI buttonState", () => {
  const rect = { x: 100, y: 100, w: 80, h: 40 };

  it("reports hover/active/clicked from pointer state", () => {
    const idle = buttonState(rect, { x: 0, y: 0, down: false, released: false });
    expect(idle).toEqual({ hover: false, active: false, clicked: false });

    const hover = buttonState(rect, { x: 140, y: 120, down: false, released: false });
    expect(hover).toEqual({ hover: true, active: false, clicked: false });

    const held = buttonState(rect, { x: 140, y: 120, down: true, released: false });
    expect(held).toEqual({ hover: true, active: true, clicked: false });

    const clicked = buttonState(rect, { x: 140, y: 120, down: false, released: true });
    expect(clicked.clicked).toBe(true);
  });

  it("release outside the rect is not a click", () => {
    const out = buttonState(rect, { x: 10, y: 10, down: false, released: true });
    expect(out.clicked).toBe(false);
  });
});

describe("UI bar", () => {
  it("draws the track plus a clamped fill", () => {
    const { ctx, calls } = mockCtx();
    bar(ctx, 10, 20, 100, 8, 0.5);
    expect(calls.fillRect).toEqual([
      [10, 20, 100, 8],
      [10, 20, 50, 8],
    ]);

    const over = mockCtx();
    bar(over.ctx, 0, 0, 100, 8, 1.7); // clamped to full
    expect(over.calls.fillRect[1]).toEqual([0, 0, 100, 8]);

    const empty = mockCtx();
    bar(empty.ctx, 0, 0, 100, 8, -2); // clamped to none — no fill rect at all
    expect(empty.calls.fillRect).toEqual([[0, 0, 100, 8]]);
  });
});

describe("Collision.pointInRect", () => {
  it("includes edges, excludes outside", () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(pointInRect(5, 5, r)).toBe(true);
    expect(pointInRect(0, 0, r)).toBe(true);
    expect(pointInRect(10, 10, r)).toBe(true);
    expect(pointInRect(11, 5, r)).toBe(false);
    expect(pointInRect(5, -1, r)).toBe(false);
  });
});
