import { describe, it, expect } from "vitest";
import { createCamera, scrollColumns, createShake } from "../index.js";

describe("createCamera", () => {
  it("lerps toward the target and clamps to world bounds", () => {
    const cam = createCamera({ worldW: 1000, worldH: 600, viewW: 400, viewH: 300, damping: 0.5 });
    cam.update(700, 300); // wants x = 500, clamped later
    // One 0.5 lerp from 0 toward 500 = 250, within bounds (max 600)
    expect(cam.x).toBeCloseTo(250);
    // sx/sy are world→screen offsets
    expect(cam.sx(250)).toBeCloseTo(0);
  });

  it("clamps so the camera never shows past the world edge", () => {
    const cam = createCamera({ worldW: 500, worldH: 300, viewW: 400, viewH: 300, damping: 1 });
    cam.update(9999, 0);
    expect(cam.x).toBe(100); // worldW - viewW
  });

  it("centers the world when it is smaller than the view", () => {
    const cam = createCamera({ worldW: 200, worldH: 100, viewW: 400, viewH: 300, damping: 1 });
    cam.update(100, 50);
    expect(cam.x).toBe(-100); // (200 - 400) / 2 → world centered, not corner-pinned
    expect(cam.y).toBe(-100); // (100 - 300) / 2
    expect(cam.sx(0)).toBe(100); // left world edge sits 100px into the view
  });

  it("snapTo jumps straight to the (clamped) target", () => {
    const cam = createCamera({ worldW: 1000, worldH: 600, viewW: 400, viewH: 300 });
    cam.snapTo(700, 300);
    expect(cam.x).toBe(500);
    expect(cam.y).toBe(150);
  });

  it("wx/wy invert sx/sy, honoring zoom", () => {
    const cam = createCamera({ worldW: 1000, worldH: 600, viewW: 400, viewH: 300 });
    cam.snapTo(700, 300);
    cam.zoom = 2;
    expect(cam.wx(cam.sx(123))).toBeCloseTo(123);
    expect(cam.wy(cam.sy(45))).toBeCloseTo(45);
  });

  it("setView updates follow/clamp to the new viewport size", () => {
    const cam = createCamera({ worldW: 1000, worldH: 600, viewW: 400, viewH: 300 });
    cam.snapTo(700, 300);
    expect(cam.x).toBe(500);
    cam.setView(800, 600);
    cam.snapTo(700, 300);
    expect(cam.x).toBe(200); // wants 700 - 800/2, now clamped to worldW - 800
    expect(cam.y).toBe(0);
  });

  it("dt-corrected damping: one dtScale=2 update equals two dtScale=1 updates", () => {
    const cfg = { worldW: 1000, worldH: 600, viewW: 400, viewH: 300, damping: 0.3 };
    const a = createCamera(cfg);
    const b = createCamera(cfg);
    a.update(700, 300, 2);
    b.update(700, 300);
    b.update(700, 300);
    expect(a.x).toBeCloseTo(b.x);
  });
});

describe("scrollColumns", () => {
  it("emits columns across the viewport plus padding", () => {
    const xs: number[] = [];
    scrollColumns(0, 100, 300, (x) => xs.push(x), 1);
    // pad=1 → starts at -100, ends before 400
    expect(xs).toEqual([-100, 0, 100, 200, 300]);
  });

  it("wraps the screen offset but keeps the world seed stable across a wrap", () => {
    const seedAt = (scroll: number): number => {
      let firstSeed = 0;
      scrollColumns(scroll, 100, 300, (x, seed) => {
        // grab the seed of the column currently at screenX 0..100
        if (x >= 0 && x < 100) firstSeed = seed;
      });
      return firstSeed;
    };
    // Scrolling exactly one spacing shifts which world column sits at the origin
    // by one spacing — the seed advances by `spacing`, never jitters.
    expect(seedAt(100) - seedAt(0)).toBe(100);
  });

  it("handles negative scroll via positive modulo", () => {
    const xs: number[] = [];
    scrollColumns(-50, 100, 200, (x) => xs.push(x), 0);
    // offset = ((-50 % 100) + 100) % 100 = 50; pad=0 → columns at bx 0 and 100
    expect(xs).toEqual([-50, 50]);
  });
});

describe("createShake", () => {
  it("is idle until triggered", () => {
    const s = createShake(() => 1);
    expect(s.active).toBe(false);
    s.advance(16);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });

  it("decays linearly to zero over the duration", () => {
    const s = createShake(() => 1); // rng=1 → offset = amp*k
    s.add(10, 100);
    s.advance(50); // half-way: k = 0.5
    expect(s.x).toBeCloseTo(5);
    expect(s.active).toBe(true);
    s.advance(50); // reaches the end: k = 0
    expect(s.x).toBe(0);
    expect(s.active).toBe(false);
  });

  it("centers the jitter around zero (rng 0.5 → no offset)", () => {
    const s = createShake(() => 0.5);
    s.add(10, 100);
    s.advance(10);
    expect(s.x).toBeCloseTo(0);
  });

  it("stacks by keeping the stronger amplitude and restarting the fade", () => {
    const s = createShake(() => 1);
    s.add(4, 100);
    s.advance(90); // nearly faded
    s.add(20, 100); // stronger shake resets the fade
    s.advance(0);
    expect(s.active).toBe(true);
    s.advance(10);
    expect(Math.abs(s.x)).toBeGreaterThan(4);
  });
});
