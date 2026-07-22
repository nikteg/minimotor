import { describe, expect, it } from "vitest";
import { createCamera } from "../camera.js";

// A hand-cranked step source: cameras fold forward by elapsed steps on read.
function stepper(): { steps: () => number; advance: (n: number) => void } {
  let now = 0;
  return {
    steps: () => now,
    advance(n) {
      now += n;
    },
  };
}

const VIEW = { w: 400, h: 300 };

describe("createCamera (pull-based lens)", () => {
  it("starts at identity and stays put with no target", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, steps: t.steps });
    t.advance(100);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.zoom).toBe(1);
  });

  it("rect exposes the visible world slice", () => {
    const cam = createCamera({ view: VIEW, zoom: 2 });
    const r = cam.rect;
    expect(r.w).toBe(200); // view / zoom
    expect(r.h).toBe(150);
  });

  it("folds toward the target by elapsed steps — reads are lazy", () => {
    const t = stepper();
    const target = { x: 1000, y: 0, w: 0, h: 0 };
    const cam = createCamera({ view: VIEW, follow: target, damping: 0.5, steps: t.steps });
    expect(cam.x).toBe(0); // no steps elapsed yet
    t.advance(1);
    const afterOne = cam.x;
    expect(afterOne).toBeGreaterThan(0);
    t.advance(1);
    expect(cam.x).toBeGreaterThan(afterOne);
  });

  it("rigid damping (1) locks onto the target center", () => {
    const t = stepper();
    const target = { x: 500, y: 400, w: 20, h: 20 };
    const cam = createCamera({ view: VIEW, follow: target, damping: 1, steps: t.steps });
    t.advance(1);
    // Target center (510, 410) should sit at view center.
    expect(cam.x).toBeCloseTo(510 - VIEW.w / 2);
    expect(cam.y).toBeCloseTo(410 - VIEW.h / 2);
  });

  it("respects the deadzone: small target moves don't move the camera", () => {
    const t = stepper();
    const target = { x: 500, y: 400, w: 0, h: 0 };
    const cam = createCamera({
      view: VIEW,
      follow: target,
      damping: 1,
      deadzone: { w: 100, h: 100 },
      steps: t.steps,
    });
    t.advance(10); // converge: target rides the deadzone's trailing edge
    const beforeX = cam.x;
    target.x -= 30; // move INTO the box — absorbed, camera stays
    t.advance(10);
    expect(cam.x).toBe(beforeX);
    target.x += 60; // out past the edge — camera follows
    t.advance(10);
    expect(cam.x).toBeGreaterThan(beforeX);
  });

  it("clamps to the world and centers when the world is smaller than the view", () => {
    const t = stepper();
    const target = { x: -500, y: 0, w: 0, h: 0 };
    const cam = createCamera({
      view: VIEW,
      world: { w: 2000, h: 1000 },
      follow: target,
      damping: 1,
      steps: t.steps,
    });
    t.advance(1);
    expect(cam.x).toBe(0); // clamped at the left edge
    // A world narrower than the view centers instead:
    const small = createCamera({
      view: VIEW,
      world: { w: 200, h: 1000 },
      follow: target,
      damping: 1,
      steps: t.steps,
    });
    t.advance(1);
    expect(small.x).toBe((200 - VIEW.w) / 2);
  });

  it("snap() jumps to the desired position immediately", () => {
    const t = stepper();
    const target = { x: 1000, y: 800, w: 0, h: 0 };
    const cam = createCamera({ view: VIEW, follow: target, damping: 0.1, steps: t.steps });
    cam.snap();
    expect(cam.x).toBeCloseTo(1000 - VIEW.w / 2);
    expect(cam.y).toBeCloseTo(800 - VIEW.h / 2);
  });

  it("fit frames the whole rect (minimap lens)", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, fit: { w: 2000, h: 1000 }, steps: t.steps });
    const r = cam.rect;
    expect(r.x).toBe(0);
    expect(r.w).toBe(2000);
    expect(cam.zoom).toBe(Math.min(VIEW.w / 2000, VIEW.h / 1000));
  });

  it("toWorld and toScreen invert each other", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, zoom: 2, steps: t.steps });
    cam.x = 100;
    cam.y = 50;
    const screen = cam.toScreen({ x: 150, y: 80 }, { x: 0, y: 0 });
    expect(screen).toEqual({ x: 100, y: 60 });
    const world = cam.toWorld(screen, { x: 0, y: 0 });
    expect(world.x).toBeCloseTo(150);
    expect(world.y).toBeCloseTo(80);
  });

  it("shake never outlives its duration and leaves the culling rect unshaken", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, steps: t.steps });
    cam.shake(10, 100); // ≈ 6 steps
    t.advance(2);
    expect(cam.rect.x).toBe(0); // rect (culling) ignores shake
    t.advance(100); // long past the duration
    expect(cam.x).toBe(0);
  });
});
