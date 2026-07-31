// Module-local collision tests.
import { describe, it, expect } from "vitest";
import {
  rectsOverlap,
  circleHit,
  crossedDown,
  sweptAABB,
  slide,
  moveAndSlide,
  dropThrough,
  slopeY,
  climbLadder,
  grid,
  contacts,
  type Solid,
  type SolidSource,
} from "@src/collision/index.js";

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

  it("drops through only while standing on a one-way platform", () => {
    const shelf = { x: 0, y: 50, w: 100, h: 8, oneWay: true };
    const body = { x: 10, y: 40, w: 10, h: 10, vel: { x: 0, y: 0 }, grounded: true };
    expect(dropThrough(body, [shelf])).toBe(true);
    expect(body.y).toBe(41);
    expect(body.vel.y).toBe(1);
    expect(body.grounded).toBe(false);
    moveAndSlide(body, [shelf]);
    expect(body.y).toBe(42);

    const floor = { x: 0, y: 50, w: 100, h: 8 };
    const solidBody = { x: 10, y: 40, w: 10, h: 10, vel: { x: 0, y: 0 }, grounded: true };
    expect(dropThrough(solidBody, [floor])).toBe(false);
    expect(solidBody).toMatchObject({ y: 40, grounded: true });
  });

  it("lands on slopes, follows them horizontally, and passes through from below", () => {
    const slope: Solid = { x: 0, y: 0, w: 100, h: 100, slope: "up-right" };
    expect(slopeY(slope as Solid & { slope: "up-right" }, 50)).toBe(50);

    const body = { x: 45, y: 0, w: 10, h: 10, vel: { x: 0, y: 60 }, grounded: false };
    moveAndSlide(body, [slope]);
    expect(body.grounded).toBe(true);
    expect(body.y).toBeCloseTo(40, 2);

    body.vel = { x: 10, y: 0 };
    moveAndSlide(body, [slope]);
    expect(body.grounded).toBe(true);
    expect(body.y).toBeCloseTo(30, 2);

    const jumper = { x: 45, y: 70, w: 10, h: 10, vel: { x: 0, y: -30 }, grounded: false };
    moveAndSlide(jumper, [slope]);
    expect(jumper.y).toBe(40);
    expect(jumper.grounded).toBe(false);
  });

  it("walks from either slope direction onto an adjoining solid plateau", () => {
    const rightSlope: Solid = { x: 0, y: 0, w: 64, h: 32, slope: "up-right" };
    const rightPlateau: Solid = { x: 64, y: 0, w: 64, h: 64 };
    const right = {
      x: 38,
      y: -20,
      w: 20,
      h: 20,
      vel: { x: 0, y: 24 },
      grounded: false,
    };
    moveAndSlide(right, [rightSlope, rightPlateau]);
    for (let i = 0; i < 10; i++) {
      right.vel.x = 4;
      right.vel.y = 0.5;
      moveAndSlide(right, [rightSlope, rightPlateau]);
    }
    expect(right.x).toBeGreaterThan(54);
    expect(right.grounded).toBe(true);
    expect(right.y + right.h).toBeCloseTo(0, 2);

    const leftPlateau: Solid = { x: 0, y: 0, w: 64, h: 64 };
    const leftSlope: Solid = { x: 64, y: 0, w: 64, h: 32, slope: "up-left" };
    const left = {
      x: 90,
      y: -8,
      w: 20,
      h: 20,
      vel: { x: 0, y: 24 },
      grounded: false,
    };
    moveAndSlide(left, [leftPlateau, leftSlope]);
    for (let i = 0; i < 10; i++) {
      left.vel.x = -4;
      left.vel.y = 0.5;
      moveAndSlide(left, [leftPlateau, leftSlope]);
    }
    expect(left.x).toBeLessThan(64);
    expect(left.grounded).toBe(true);
    expect(left.y + left.h).toBeCloseTo(0, 2);
  });

  it("walks up a steep slope defined by a tall rectangle", () => {
    const ground: Solid = { x: -32, y: 32, w: 32, h: 16 };
    const slope: Solid = { x: 0, y: 0, w: 16, h: 32, slope: "up-right" };
    const plateau: Solid = { x: 16, y: 0, w: 16, h: 32 };
    const body = {
      x: -12,
      y: 8,
      w: 12,
      h: 24,
      vel: { x: 0, y: 0 },
      grounded: true,
    };
    for (let step = 0; step < 28; step++) {
      body.vel.x = 1;
      body.vel.y = 0.25;
      moveAndSlide(body, [ground, slope, plateau]);
    }
    expect(body.x).toBeGreaterThan(14);
    expect(body.grounded).toBe(true);
    expect(body.y + body.h).toBeCloseTo(0, 2);
  });

  it("walks down a steep slope onto its lower ground", () => {
    const ground: Solid = { x: -32, y: 32, w: 32, h: 16 };
    const slope: Solid = { x: 0, y: 0, w: 16, h: 32, slope: "up-right" };
    const plateau: Solid = { x: 16, y: 0, w: 16, h: 32 };
    const body = {
      x: 18,
      y: -24,
      w: 12,
      h: 24,
      vel: { x: 0, y: 0 },
      grounded: true,
    };
    for (let step = 0; step < 28; step++) {
      body.vel.x = -1;
      body.vel.y = 0.25;
      moveAndSlide(body, [ground, slope, plateau]);
    }
    expect(body.x).toBeLessThan(0);
    expect(body.grounded).toBe(true);
    expect(body.y + body.h).toBeCloseTo(32, 2);
  });

  it("enters and remains on a ladder with one helper", () => {
    const ladder = { x: 0, y: 0, w: 20, h: 100 };
    const body = { x: 2, y: 20, w: 10, h: 10, vel: { x: 0, y: 4 }, grounded: true };
    expect(climbLadder(body, [ladder], -1)).toBe(true);
    expect(body).toMatchObject({ grounded: false, vel: { y: -3 } });
    expect(body.x).toBeGreaterThan(2); // easing toward the ladder center
    expect(climbLadder(body, [ladder], 0, { active: true })).toBe(true);
    expect(body.vel.y).toBe(0);
    expect(climbLadder(body, [ladder], 0, { active: true, horizontal: 0.5 })).toBe(false);
    body.x = 100;
    expect(climbLadder(body, [ladder], 0, { active: true })).toBe(false);
  });

  it("can grab a ladder automatically on contact", () => {
    const ladder = { x: 0, y: 0, w: 20, h: 100 };
    const body = { x: 2, y: 20, w: 10, h: 10, vel: { x: 0, y: 4 }, grounded: false };
    expect(climbLadder(body, [ladder], 0)).toBe(false);
    expect(climbLadder(body, [ladder], 0, { autoGrab: true })).toBe(true);
    expect(body.vel.y).toBe(0);
  });

  it("enters a ladder below a platform by pressing down", () => {
    const ladder = { x: 0, y: 20, w: 20, h: 100 };
    const source = {
      laddersNear(area: { x: number; y: number; w: number; h: number }, out: Array<typeof ladder>) {
        if (area.y + area.h > ladder.y) out.push(ladder);
        return out;
      },
    };
    const body = { x: 5, y: 10, w: 10, h: 10, vel: { x: 0, y: 0 }, grounded: true };
    expect(climbLadder(body, source, 0)).toBe(false);
    expect(climbLadder(body, source, 1)).toBe(true);
    expect(body).toMatchObject({ grounded: false, vel: { y: 3 } });
  });

  it("climbs through a one-way ladder cap, then stands on it", () => {
    const ladder = { x: 0, y: 0, w: 20, h: 100 };
    const cap = { x: 0, y: 0, w: 20, h: 20, oneWay: true };
    const body = { x: 5, y: 10, w: 10, h: 10, vel: { x: 0, y: 0 }, grounded: false };
    let climbing = true;
    while (climbing) {
      climbing = climbLadder(body, [ladder], -1, { active: climbing });
      moveAndSlide(body, [cap]);
    }
    for (let step = 0; step < 20 && !body.grounded; step++) {
      body.vel.y += 0.5;
      moveAndSlide(body, [cap]);
    }
    expect(body.grounded).toBe(true);
    expect(body.y).toBeCloseTo(-10, 1);
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

describe("Collision.grid", () => {
  const box = (x: number, y: number): Solid => ({ x, y, w: 16, h: 16 });

  it("reports only the solids near the queried area", () => {
    const solids = [box(0, 0), box(1000, 0), box(0, 1000)];
    const g = grid(solids, 64);
    expect(g.size).toBe(3);
    expect(g.solidsNear({ x: -8, y: -8, w: 40, h: 40 }, [])).toEqual([solids[0]]);
    expect(g.solidsNear({ x: 990, y: -8, w: 40, h: 40 }, [])).toEqual([solids[1]]);
    expect(g.solidsNear({ x: 500, y: 500, w: 40, h: 40 }, [])).toEqual([]);
  });

  it("reports a solid straddling several cells exactly once", () => {
    // 200px wide at a 16px cell — spans 13 cells, and the query covers them all.
    const wide: Solid = { x: 0, y: 0, w: 200, h: 8 };
    const g = grid([wide], 16);
    expect(g.solidsNear({ x: -50, y: -50, w: 400, h: 200 }, [])).toEqual([wide]);
  });

  it("appends to the caller's array rather than replacing it", () => {
    const g = grid([box(0, 0)], 64);
    const out: Solid[] = [box(500, 500)];
    expect(g.solidsNear({ x: 0, y: 0, w: 16, h: 16 }, out)).toBe(out);
    expect(out).toHaveLength(2);
  });

  it("handles negative coordinates", () => {
    const far = box(-1000, -1000);
    const g = grid([far, box(0, 0)], 64);
    expect(g.solidsNear({ x: -1010, y: -1010, w: 40, h: 40 }, [])).toEqual([far]);
  });

  it("stays correct across many queries (stamp dedupe doesn't leak between calls)", () => {
    const wide: Solid = { x: 0, y: 0, w: 200, h: 8 };
    const g = grid([wide], 16);
    const area = { x: -50, y: -50, w: 400, h: 200 };
    for (let i = 0; i < 5; i++) expect(g.solidsNear(area, [])).toEqual([wide]);
  });

  it("rebuild() re-buckets for a changed set", () => {
    const a = box(0, 0);
    const b = box(1000, 1000);
    const g = grid([a], 64);
    g.rebuild([b]);
    expect(g.size).toBe(1);
    expect(g.solidsNear({ x: 0, y: 0, w: 16, h: 16 }, [])).toEqual([]);
    expect(g.solidsNear({ x: 1000, y: 1000, w: 16, h: 16 }, [])).toEqual([b]);
  });

  it("rejects a non-positive cell size", () => {
    expect(() => grid([], 0)).toThrow(/cellSize/);
    expect(() => grid([], -8)).toThrow(/cellSize/);
  });

  it("drives moveAndSlide exactly like the equivalent plain array", () => {
    const floor: Solid[] = [];
    for (let i = 0; i < 40; i++) floor.push({ x: i * 16, y: 100, w: 16, h: 16 });

    const viaArray = { x: 50, y: 60, w: 10, h: 10, vel: { x: 3, y: 60 }, grounded: false };
    const viaGrid = { x: 50, y: 60, w: 10, h: 10, vel: { x: 3, y: 60 }, grounded: false };
    const ca = contacts();
    const cg = contacts();
    moveAndSlide(viaArray, floor, ca);
    moveAndSlide(viaGrid, grid(floor, 32), cg);

    expect(viaGrid.x).toBeCloseTo(viaArray.x, 10);
    expect(viaGrid.y).toBeCloseTo(viaArray.y, 10);
    expect(viaGrid.grounded).toBe(viaArray.grounded);
    expect(viaGrid.grounded).toBe(true); // …and it actually landed
    expect(cg).toEqual(ca);
  });
});

describe("Collision.contacts (the scratch opt-out)", () => {
  const floor: Solid[] = [{ x: 0, y: 100, w: 200, h: 20 }];

  it("two bodies sharing the default scratch alias each other", () => {
    const lands = { x: 10, y: 60, w: 10, h: 10, vel: { x: 0, y: 60 }, grounded: false };
    const flies = { x: 10, y: 10, w: 10, h: 10, vel: { x: 0, y: 1 }, grounded: false };
    const first = moveAndSlide(lands, floor);
    expect(first.down).toBe(true);
    moveAndSlide(flies, floor); // second call rewrites the same object
    expect(first.down).toBe(false); // the first body's result is gone
  });

  it("…and does not when each body brings its own out", () => {
    const lands = { x: 10, y: 60, w: 10, h: 10, vel: { x: 0, y: 60 }, grounded: false };
    const flies = { x: 10, y: 10, w: 10, h: 10, vel: { x: 0, y: 1 }, grounded: false };
    const a = contacts();
    const b = contacts();
    moveAndSlide(lands, floor, a);
    moveAndSlide(flies, floor, b);
    expect(a.down).toBe(true); // survives the second resolve
    expect(b.down).toBe(false);
    expect(a).not.toBe(b);
  });

  it("slide() takes an out too, and returns the very object passed in", () => {
    const rect = { x: 10, y: 60, w: 10, h: 10 };
    const out = contacts();
    expect(slide(rect, { x: 0, y: 60 }, floor, out)).toBe(out);
    expect(out.down).toBe(true);
  });

  it("clears stale flags on a contact-free move", () => {
    const out = contacts();
    const rect = { x: 10, y: 60, w: 10, h: 10 };
    slide(rect, { x: 0, y: 60 }, floor, out);
    expect(out.down).toBe(true);
    slide({ x: 10, y: 0, w: 10, h: 10 }, { x: 1, y: 0 }, floor, out);
    expect(out.down).toBe(false);
    expect(out.impact).toBe(0);
  });
});

describe("Collision solids-array scanning", () => {
  it("notices a source appended to an array it has already seen", () => {
    const platform: Solid = { x: 0, y: 100, w: 200, h: 20 };
    const source: SolidSource = { solidsNear: (_a, out) => (out.push(platform), out) };
    const solids: Array<Solid | SolidSource> = [];

    // First pass: plain (and empty) — nothing to hit.
    const drop = { x: 10, y: 60, w: 10, h: 10, vel: { x: 0, y: 60 }, grounded: false };
    moveAndSlide(drop, solids);
    expect(drop.grounded).toBe(false);

    // Appending a source changes the array's length, so the memo is discarded.
    solids.push(source);
    const drop2 = { x: 10, y: 60, w: 10, h: 10, vel: { x: 0, y: 60 }, grounded: false };
    moveAndSlide(drop2, solids);
    expect(drop2.grounded).toBe(true);
  });

  it("keeps mixed arrays working across repeat calls", () => {
    const platform: Solid = { x: 0, y: 100, w: 200, h: 20 };
    const source: SolidSource = { solidsNear: (_a, out) => (out.push(platform), out) };
    const solids: Array<Solid | SolidSource> = [source, { x: 0, y: 300, w: 200, h: 20 }];
    for (let i = 0; i < 3; i++) {
      const body = { x: 10, y: 60, w: 10, h: 10, vel: { x: 0, y: 60 }, grounded: false };
      moveAndSlide(body, solids);
      expect(body.grounded).toBe(true);
    }
  });
});
