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

  it("returns owned vectors unless an output vector is supplied", () => {
    const cam = createCamera({ view: VIEW });
    const first = cam.toScreen({ x: 1, y: 2 });
    const second = cam.toScreen({ x: 3, y: 4 });
    expect(first).not.toBe(second);
    expect(first).toEqual({ x: 1, y: 2 });
    const out = { x: 0, y: 0 };
    expect(cam.toWorld({ x: 5, y: 6 }, out)).toBe(out);
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

// ---------- The lens mapping ----------
// `applyLens`, `toWorld` and `toScreen` all read one `mapping()`, so a pick can
// never disagree with what was drawn. These pin the three properties that were
// previously wrong: the pixel snap happens in DEVICE space, `into` lenses map
// through their sub-rect, and shake is included.

describe("camera lens mapping", () => {
  it("snaps the translation in device space, not world space", () => {
    // At zoom 3, rounding the WORLD coordinate would quantize camera motion to
    // 3-device-pixel jumps. Every device-space translation must be integral,
    // and moving a third of a world pixel must still move exactly one.
    for (const zoom of [1, 2, 3]) {
      const cam = createCamera({ view: VIEW, zoom });
      const seen: number[] = [];
      for (const x of [10, 10 + 1 / zoom, 10 + 2 / zoom]) {
        cam.x = x;
        const screen = cam.toScreen({ x: 0, y: 0 });
        expect(Number.isInteger(screen.x)).toBe(true);
        seen.push(screen.x);
      }
      // Three successive sub-world-pixel nudges → three distinct device px.
      expect(new Set(seen).size).toBe(3);
    }
  });

  it("toScreen inverts toWorld", () => {
    const cam = createCamera({ view: VIEW, zoom: 2 });
    cam.x = 37.4;
    cam.y = -12.6;
    const world = cam.toWorld({ x: 130, y: 90 });
    const back = cam.toScreen({ x: world.x, y: world.y }, { x: 0, y: 0 });
    expect(back.x).toBeCloseTo(130, 6);
    expect(back.y).toBeCloseTo(90, 6);
  });

  it("scales by exactly the zoom, whatever the snap does to the offset", () => {
    const cam = createCamera({ view: VIEW, zoom: 2 });
    cam.x = 33.3;
    cam.y = 77.7;
    const origin = cam.toScreen({ x: 0, y: 0 }, { x: 0, y: 0 });
    const unit = cam.toScreen({ x: 1, y: 1 }, { x: 0, y: 0 });
    expect(unit.x - origin.x).toBeCloseTo(2, 6);
    expect(unit.y - origin.y).toBeCloseTo(2, 6);
  });

  it("maps through an `into` sub-rect for split screen / minimaps", () => {
    const cam = createCamera({ view: VIEW, fit: { w: 800, h: 600 } });
    const into = { x: 300, y: 20, w: 80, h: 60 };
    // The fit rect maps uniformly onto `into`: world (0,0) → the rect's corner,
    // world (800,600) → its opposite corner.
    const tl = cam.toScreen({ x: 0, y: 0 }, { x: 0, y: 0 }, { into });
    const br = cam.toScreen({ x: 800, y: 600 }, { x: 0, y: 0 }, { into });
    expect(tl.x).toBeCloseTo(300, 6);
    expect(tl.y).toBeCloseTo(20, 6);
    expect(br.x).toBeCloseTo(380, 6);
    expect(br.y).toBeCloseTo(80, 6);
    // …and picking inside the sub-rect inverts it.
    const world = cam.toWorld({ x: 340, y: 50 }, { x: 0, y: 0 }, { into });
    expect(world.x).toBeCloseTo(400, 6);
    expect(world.y).toBeCloseTo(300, 6);
  });

  it("includes shake in the mapping", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, steps: t.steps });
    const quiet = cam.toScreen({ x: 100, y: 100 }, { x: 0, y: 0 }).x;
    cam.shake(40, 500);
    t.advance(1);
    const shaken = cam.toScreen({ x: 100, y: 100 }, { x: 0, y: 0 }).x;
    expect(shaken).not.toBe(quiet);
  });
});

describe("camera shake restack", () => {
  it("keeps the stronger amplitude even when the current offset is zero", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, steps: t.steps });
    cam.shake(50, 1000);
    t.advance(1);
    const strong = Math.abs(cam.toScreen({ x: 0, y: 0 }, { x: 0, y: 0 }).x);
    // Restack with a WEAKER shake: the running 50 must win, not be replaced.
    cam.shake(1, 1000);
    t.advance(1);
    const after = Math.abs(cam.toScreen({ x: 0, y: 0 }, { x: 0, y: 0 }).x);
    expect(after).toBeGreaterThan(strong / 10);
  });

  it("does not resurrect a shake that already faded out", () => {
    const t = stepper();
    const cam = createCamera({ view: VIEW, steps: t.steps });
    cam.shake(100, 100); // ~6 steps
    t.advance(500); // long past the fade
    cam.shake(2, 1000); // a small new one starts from 2, not from 100
    t.advance(1);
    expect(Math.abs(cam.toScreen({ x: 0, y: 0 }, { x: 0, y: 0 }).x)).toBeLessThanOrEqual(2);
  });
});
