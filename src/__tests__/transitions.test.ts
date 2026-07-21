import { describe, it, expect, vi } from "vitest";
import { fade, wipe, run } from "../transitions.js";

function mockCtx() {
  return {
    globalAlpha: 1,
    fillStyle: "",
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> };
}

const vp = { w: 800, h: 600 };

describe("Transitions.run", () => {
  it("swaps exactly once, at full coverage", () => {
    const swap = vi.fn();
    const t = run(fade(400), swap);
    t.advance(199);
    expect(swap).not.toHaveBeenCalled();
    t.advance(1); // hits the midpoint
    expect(swap).toHaveBeenCalledTimes(1);
    t.advance(300); // never again
    expect(swap).toHaveBeenCalledTimes(1);
    expect(t.done).toBe(true);
  });

  it("coverage ramps 0→1 then back to 0", () => {
    const spec = { durationMs: 400, render: vi.fn() };
    const t = run(spec, vi.fn());
    const ctx = mockCtx();
    t.advance(100); // quarter in → half covered
    t.draw(ctx, vp);
    expect(spec.render).toHaveBeenLastCalledWith(ctx, 0.5, vp);
    t.advance(100); // midpoint → fully covered
    t.draw(ctx, vp);
    expect(spec.render).toHaveBeenLastCalledWith(ctx, 1, vp);
    t.advance(300); // past the end → clamped back to 0
    t.draw(ctx, vp);
    expect(spec.render).toHaveBeenLastCalledWith(ctx, 0, vp);
  });
});

describe("Transitions.fade", () => {
  it("draws a full-screen rect at alpha t", () => {
    const ctx = mockCtx();
    fade(400, "#123").render(ctx, 0.5, vp);
    expect(ctx.globalAlpha).toBe(0.5); // set before save() snapshot is restored by mock? — mock keeps value
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });
});

describe("Transitions.wipe", () => {
  it("sweeps a curtain sized by t from the matching edge", () => {
    const cases = [
      ["left", [400, 0, 400, 600]],
      ["right", [0, 0, 400, 600]],
      ["up", [0, 300, 800, 300]],
      ["down", [0, 0, 800, 300]],
    ] as const;
    for (const [dir, rect] of cases) {
      const ctx = mockCtx();
      wipe(400, dir).render(ctx, 0.5, vp);
      expect(ctx.fillRect).toHaveBeenCalledWith(...rect);
    }
  });
});
