import { describe, it, expect, vi } from "vitest";
import { Particles } from "../particles.js";
import { createClockHandle } from "../clock.js";

function stepper(): { steps: () => number; advanceMs: (ms: number) => void } {
  let now = 0;
  return {
    steps: () => now,
    advanceMs(ms) {
      now += ms / (1000 / 60);
    },
  };
}

function sys(rng: () => number, t: ReturnType<typeof stepper>) {
  return Particles.create({ rng, clock: createClockHandle(t.steps) });
}

describe("Particles.create", () => {
  it("emits `count` particles per burst", () => {
    const p = sys(() => 0.5, stepper());
    p.burst({ at: { x: 0, y: 0 }, count: 8 });
    expect(p.count).toBe(8);
  });

  it("folds motion from the clock: velocity in px/step, gravity px/step²", () => {
    const t = stepper();
    // rng=0 → dir = angle - 0.5*spread; with angle 0, spread 0 → dir 0 (all +x).
    const p = sys(() => 0, t);
    p.burst({
      at: { x: 0, y: 0 },
      count: 1,
      angle: 0,
      spread: 0,
      speed: 2,
      gravity: 0.1,
      life: 10000,
    });
    t.advanceMs(10 * (1000 / 60)); // 10 steps
    const ctx = fakeCtx();
    p.render(ctx);
    expect(ctx.arc).toHaveBeenCalled();
    const [x, y] = ctx.arc.mock.calls[0];
    expect(x).toBeCloseTo(20); // 2 px/step × 10 steps
    expect(y).toBeCloseTo(0.1 * ((10 * 11) / 2)); // gravity integrates per step
  });

  it("culls particles once they outlive their lifetime", () => {
    const t = stepper();
    const p = sys(() => 0.5, t);
    p.burst({ at: { x: 0, y: 0 }, count: 5, life: 100 });
    t.advanceMs(50);
    expect(p.count).toBe(5);
    t.advanceMs(70); // total 120 > 100
    expect(p.count).toBe(0);
  });

  it("freezes with a held clock — pause needs no cooperation", () => {
    const t = stepper();
    const clock = createClockHandle(t.steps);
    const p = Particles.create({ rng: () => 0.5, clock });
    p.burst({ at: { x: 0, y: 0 }, count: 3, life: 100 });
    clock.hold();
    t.advanceMs(1000);
    expect(p.count).toBe(3); // still alive: their time never passed
  });

  it("emit() is chance-gated, one particle per call", () => {
    const t = stepper();
    let roll = 0;
    const p = Particles.create({ rng: () => roll, clock: createClockHandle(t.steps) });
    roll = 0.9;
    p.emit({ at: { x: 0, y: 0 }, chance: 0.5 }); // 0.9 >= 0.5 → no emit
    expect(p.count).toBe(0);
    roll = 0.1;
    p.emit({ at: { x: 0, y: 0 }, chance: 0.5 }); // 0.1 < 0.5 → emit
    expect(p.count).toBe(1);
  });

  it("fades alpha from 1 toward 0 across the lifetime", () => {
    const t = stepper();
    const p = sys(() => 0.5, t);
    p.burst({ at: { x: 0, y: 0 }, count: 1, life: 200, speed: 0 });
    t.advanceMs(9 * (1000 / 60)); // 9 whole steps = 150ms aged
    const ctx = fakeCtx();
    p.render(ctx);
    // Captured at fill() time (render resets globalAlpha to 1 afterwards).
    expect(ctx.alphas[0]).toBeCloseTo(0.25);
  });

  it("clear() drops everything", () => {
    const p = sys(() => 0.5, stepper());
    p.burst({ at: { x: 0, y: 0 }, count: 4 });
    p.clear();
    expect(p.count).toBe(0);
  });

  it("picks from a color array by rng", () => {
    const p = sys(() => 0, stepper()); // index 0
    p.burst({ at: { x: 0, y: 0 }, count: 1, color: ["#f00", "#0f0"], speed: 0, life: 1000 });
    const ctx = fakeCtx();
    p.render(ctx);
    expect(ctx.fillStyle).toBe("#f00");
  });
});

function fakeCtx() {
  const alphas: number[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(() => alphas.push(ctx.globalAlpha)),
    alphas,
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    arc: ReturnType<typeof vi.fn>;
    alphas: number[];
  };
}
