import { describe, it, expect, vi } from "vitest";
import { createParticles } from "./particles.js";

describe("createParticles", () => {
  it("emits `count` particles per burst", () => {
    const p = createParticles(() => 0.5);
    p.burst(0, 0, { count: 8 });
    expect(p.count).toBe(8);
  });

  it("moves particles by velocity and applies gravity (px/s over ms)", () => {
    // rng=0 → dir = angle - 0.5*spread; with angle 0, spread 0 → dir 0 (all +x).
    const p = createParticles(() => 0);
    p.burst(0, 0, { count: 1, angle: 0, spread: 0, speed: 100, gravity: 200, life: 10000 });
    p.advance(1000); // one second
    // vx = 100 → x ≈ 100; vy starts 0, gains 200 → y ≈ 200 (moved after the kick)
    const ctx = fakeCtx();
    p.draw(ctx);
    expect(ctx.arc).toHaveBeenCalled();
    const [x, y] = ctx.arc.mock.calls[0];
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(200);
  });

  it("culls particles once they outlive their lifetime", () => {
    const p = createParticles(() => 0.5);
    p.burst(0, 0, { count: 5, life: 100 });
    p.advance(50);
    expect(p.count).toBe(5);
    p.advance(60); // total 110 > 100
    expect(p.count).toBe(0);
  });

  it("fades alpha from 1 toward 0 across the lifetime", () => {
    const p = createParticles(() => 0.5);
    p.burst(0, 0, { count: 1, life: 100, speed: 0 });
    p.advance(75); // 75% aged
    const ctx = fakeCtx();
    p.draw(ctx);
    // Captured at fill() time (draw resets globalAlpha to 1 afterwards).
    expect(ctx.alphas[0]).toBeCloseTo(0.25);
  });

  it("clear() drops everything", () => {
    const p = createParticles(() => 0.5);
    p.burst(0, 0, { count: 4 });
    p.clear();
    expect(p.count).toBe(0);
  });

  it("picks from a color array by rng", () => {
    const p = createParticles(() => 0); // index 0
    p.burst(0, 0, { count: 1, colors: ["#f00", "#0f0"], speed: 0, life: 1000 });
    const ctx = fakeCtx();
    p.draw(ctx);
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
