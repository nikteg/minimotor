import { describe, it, expect, vi } from "vitest";
import { sheet, states } from "../index.js";

// A sheet 4 cols × 2 rows of 32×32 cells.
const img = { width: 128, height: 64 } as HTMLImageElement;

describe("Anim.sheet frame math", () => {
  it("maps the starting cell to a source rect", () => {
    const a = sheet(img, { fw: 32, fh: 32 });
    expect(a.rect).toEqual({ sx: 0, sy: 0, sw: 32, sh: 32 });
  });

  it("advances row-major across the grid at the configured fps", () => {
    const a = sheet(img, { fw: 32, fh: 32, fps: 10 }); // 100ms/frame, 8 frames
    a.update(100);
    expect(a.frame).toBe(1);
    expect(a.rect).toEqual({ sx: 32, sy: 0, sw: 32, sh: 32 });
    a.update(300); // → frame 4 = row 1, col 0
    expect(a.frame).toBe(4);
    expect(a.rect).toEqual({ sx: 0, sy: 32, sw: 32, sh: 32 });
  });

  it("loops by default and holds/report done when loop is false", () => {
    const looping = sheet(img, { fw: 32, fh: 32, fps: 10, frames: [0, 1] });
    looping.update(200); // 2 steps → wraps back to 0
    expect(looping.frame).toBe(0);
    expect(looping.done).toBe(false);

    const once = sheet(img, { fw: 32, fh: 32, fps: 10, frames: [0, 1], loop: false });
    once.update(1000); // plenty
    expect(once.frame).toBe(1); // clamped at last
    expect(once.done).toBe(true);
  });

  it("uses an explicit frame list and cols override", () => {
    const a = sheet(img, { fw: 32, fh: 32, fps: 10, cols: 4, frames: [5, 7] });
    // cell 5 = row 1, col 1
    expect(a.rect).toEqual({ sx: 32, sy: 32, sw: 32, sh: 32 });
    a.update(100);
    expect(a.frame).toBe(1);
    // cell 7 = row 1, col 3
    expect(a.rect).toEqual({ sx: 96, sy: 32, sw: 32, sh: 32 });
  });

  it("reset returns to the first frame", () => {
    const a = sheet(img, { fw: 32, fh: 32, fps: 10 });
    a.update(250);
    expect(a.frame).not.toBe(0);
    a.reset();
    expect(a.frame).toBe(0);
    expect(a.done).toBe(false);
  });

  it("a single-frame animation never advances", () => {
    const a = sheet(img, { fw: 32, fh: 32, frames: [3] });
    a.update(9999);
    expect(a.frame).toBe(0);
  });

  it("draw blits the current frame's sub-rect, centered by default", () => {
    const a = sheet(img, { fw: 32, fh: 32, fps: 10 });
    a.update(100); // frame 1 → sx 32
    const calls: unknown[][] = [];
    const ctx = {
      drawImage: (...args: unknown[]) => calls.push(args),
    } as unknown as CanvasRenderingContext2D;
    a.draw(ctx, 100, 50);
    // drawImage(img, sx, sy, sw, sh, dx-ax*w, dy-ay*h, w, h)
    expect(calls[0]).toEqual([img, 32, 0, 32, 32, 100 - 16, 50 - 16, 32, 32]);
  });
});

describe("Anim.states", () => {
  it("switches named clips, resets on transitions, and delegates playback", () => {
    const idle = sheet(img, { fw: 32, fh: 32, fps: 10, frames: [0, 1] });
    const run = sheet(img, { fw: 32, fh: 32, fps: 10, frames: [2, 3] });
    const hero = states({ idle, run }, "idle");

    hero.update(100);
    expect(hero.state).toBe("idle");
    expect(hero.frame).toBe(1);
    expect(hero.play("run")).toBe(true);
    expect(hero.frame).toBe(0);
    hero.update(100);
    expect(hero.rect.sx).toBe(96);

    // Re-selecting a state does not interrupt it unless explicitly requested.
    expect(hero.play("run")).toBe(false);
    expect(hero.frame).toBe(1);
    hero.play("run", { restart: true });
    expect(hero.frame).toBe(0);
  });

  it("can reset all clips and reports invalid states", () => {
    const idle = sheet(img, { fw: 32, fh: 32, fps: 10 });
    const run = sheet(img, { fw: 32, fh: 32, fps: 10 });
    const hero = states({ idle, run }, "idle");
    hero.play("run");
    hero.update(100);
    hero.resetAll();
    expect(hero.state).toBe("idle");
    expect(hero.frame).toBe(0);
    expect(() => hero.play("missing" as "idle")).toThrow(/unknown state/);
    expect(() => states({ idle }, "missing" as "idle")).toThrow(/missing initial state/);
  });
});
