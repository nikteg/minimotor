import { describe, it, expect } from "vitest";
import {
  rectsOverlap,
  circleHit,
  crossedDown,
  sweptAABB,
  slide,
  moveAndSlide,
  type Solid,
} from "../collision.js";

describe("rectsOverlap", () => {
  it("overlapping", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true));
  it("edge x", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false));
  it("edge y", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 })).toBe(false));
  it("separated", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false));
  it("contained", () =>
    expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 25, y: 25, w: 10, h: 10 })).toBe(
      true,
    ));
});

describe("circleHit", () => {
  it("true when circles overlap", () => expect(circleHit(0, 0, 10, 5, 0, 10)).toBe(true));
  it("false when farther apart than radii", () => expect(circleHit(0, 0, 5, 20, 0, 5)).toBe(false));
  it("false at the exact touching distance (strict)", () =>
    expect(circleHit(0, 0, 5, 10, 0, 5)).toBe(false));
});

describe("crossedDown", () => {
  it("true when the edge crosses the threshold downward", () =>
    expect(crossedDown(98, 102, 100)).toBe(true));
  it("false when still above the threshold", () => expect(crossedDown(80, 95, 100)).toBe(false));
  it("false when already below (no crossing)", () =>
    expect(crossedDown(102, 110, 100)).toBe(false));
});

describe("sweptAABB", () => {
  const player = { x: 0, y: 0, w: 10, h: 10 };

  it("catches a fast body that would tunnel through a thin target", () => {
    // A 2px-wide wall 50px to the right; the player moves 100px right this step.
    // A point-in-time overlap would miss it; the sweep catches it.
    const wall = { x: 50, y: 0, w: 2, h: 10 };
    expect(rectsOverlap({ ...player, x: 100 }, wall)).toBe(false); // end-of-step: past it
    const hit = sweptAABB(player, 100, 0, wall);
    expect(hit).not.toBeNull();
    // Player's right edge (x=10) reaches the wall's left face (x=50) after 40 of
    // the 100px move.
    expect(hit!.t).toBeCloseTo(0.4);
    expect(hit).toMatchObject({ nx: -1, ny: 0 });
  });

  it("returns null when the motion stays clear of the target", () => {
    const wall = { x: 50, y: 100, w: 10, h: 10 }; // far below the sweep line
    expect(sweptAABB(player, 100, 0, wall)).toBeNull();
  });

  it("returns null when the move stops short of the target", () => {
    const wall = { x: 50, y: 0, w: 10, h: 10 };
    expect(sweptAABB(player, 20, 0, wall)).toBeNull(); // only reaches x=20, wall at 50
  });

  it("reports null for boxes that already overlap (entry is in the past)", () => {
    const wall = { x: 5, y: 0, w: 10, h: 10 }; // overlapping at start
    expect(sweptAABB(player, 100, 0, wall)).toBeNull();
    // resting overlap is rectsOverlap's job:
    expect(rectsOverlap(player, wall)).toBe(true);
  });

  it("detects a vertical (no horizontal motion) drop onto a target", () => {
    const floor = { x: 0, y: 50, w: 10, h: 10 };
    const hit = sweptAABB(player, 0, 100, floor);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(0.4); // 40px gap over a 100px move
    expect(hit).toMatchObject({ nx: 0, ny: -1 });
  });

  it("returns null when a purely vertical move never overlaps in x", () => {
    const floor = { x: 50, y: 50, w: 10, h: 10 }; // off to the side
    expect(sweptAABB(player, 0, 100, floor)).toBeNull();
  });
});

describe("Collision.slide / moveAndSlide", () => {
  const floor = { x: 0, y: 100, w: 400, h: 20 };

  it("moves freely when nothing is in the way", () => {
    const body = { x: 0, y: 0, w: 10, h: 10 };
    const c = slide(body, { x: 5, y: 3 }, [floor]);
    expect(body.x).toBe(5);
    expect(body.y).toBe(3);
    expect(c.down).toBe(false);
    expect(c.impact).toBe(0);
  });

  it("lands on a floor and reports down contact + impact speed", () => {
    const body = { x: 0, y: 80, w: 10, h: 10 };
    const c = slide(body, { x: 0, y: 30 }, [floor]); // would tunnel to 110
    expect(body.y).toBeCloseTo(90, 1); // stopped on top of the floor
    expect(c.down).toBe(true);
    expect(c.impact).toBe(30);
  });

  it("slides along the floor: vertical stop keeps horizontal motion", () => {
    const body = { x: 0, y: 85, w: 10, h: 10 };
    slide(body, { x: 20, y: 10 }, [floor]);
    expect(body.y).toBeCloseTo(90, 1);
    expect(body.x).toBeGreaterThan(10); // tangential remainder applied
  });

  it("never tunnels at high speed (swept)", () => {
    const thin = { x: 0, y: 100, w: 400, h: 2 };
    const body = { x: 0, y: 0, w: 10, h: 10 };
    slide(body, { x: 0, y: 500 }, [thin]);
    expect(body.y).toBeCloseTo(90, 1); // caught the 2px platform
  });

  it("hits walls left/right", () => {
    const wall = { x: 50, y: 0, w: 10, h: 100 };
    const body = { x: 20, y: 40, w: 10, h: 10 };
    const c = slide(body, { x: 40, y: 0 }, [wall]);
    expect(body.x).toBeCloseTo(40, 1);
    expect(c.right).toBe(true);
  });

  it("oneWay platforms catch falls from above but pass from below/sides", () => {
    const shelf = { x: 0, y: 50, w: 100, h: 10, oneWay: true };
    const faller = { x: 10, y: 20, w: 10, h: 10 };
    const cf = slide(faller, { x: 0, y: 60 }, [shelf]);
    expect(cf.down).toBe(true);
    expect(faller.y).toBeCloseTo(40, 1);

    const jumper = { x: 10, y: 80, w: 10, h: 10 };
    const cj = slide(jumper, { x: 0, y: -60 }, [shelf]); // up through
    expect(cj.up).toBe(false);
    expect(jumper.y).toBe(20);
  });

  it("moveAndSlide zeroes blocked velocity and sets grounded", () => {
    const body = { x: 0, y: 80, w: 10, h: 10, vel: { x: 3, y: 30 }, grounded: false };
    const c = moveAndSlide(body, [floor]);
    expect(body.grounded).toBe(true);
    expect(body.vel.y).toBe(0); // landing clears vertical
    expect(body.vel.x).toBe(3); // horizontal untouched
    expect(c.impact).toBe(30);
  });

  it("accepts a SolidSource and mixed arrays", () => {
    const source = {
      solidsNear(_area: { x: number; y: number; w: number; h: number }, out: Solid[]) {
        out.push(floor);
        return out;
      },
    };
    const a = { x: 0, y: 80, w: 10, h: 10 };
    expect(slide(a, { x: 0, y: 30 }, source).down).toBe(true);
    const b = { x: 20, y: 80, w: 10, h: 10 };
    const wall = { x: 0, y: 0, w: 5, h: 200 };
    expect(slide(b, { x: -20, y: 0 }, [source, wall]).left).toBe(true);
    expect(b.x).toBeCloseTo(5, 1); // stopped against the wall from the source-mixed array
  });
});
