import { describe, it, expect } from "vitest";
import { createCamera, scrollColumns } from "./camera.js";

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
