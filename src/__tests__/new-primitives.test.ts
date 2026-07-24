import { describe, expect, it } from "vitest";
import { approach, damp, lerpAngle, pingPong } from "../mathf.js";
import { circleRect, separateCircles, bounceInBounds } from "../collision.js";
import { letterboxView, formatClock, createScoreTracker } from "../game.js";
import { randFreeCell, shuffle, addToInventory, beatClock, nearest } from "../goodies/index.js";
import { patrol, trail, undoStack, seedRng } from "../gizmos/index.js";
import { grid } from "../ui/index.js";
import { createRoster } from "../net/index.js";

describe("Mathf.approach", () => {
  it("moves toward target without overshooting", () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10); // clamps at target
    expect(approach(10, 0, 4)).toBe(6);
    expect(approach(1, 0, 4)).toBe(0);
    expect(approach(5, 5, 2)).toBe(5);
  });
});

describe("Mathf.damp", () => {
  it("eases toward target, frame-rate independent", () => {
    // Two half-steps must land where one full step of the same total dt does.
    const rate = 4;
    const one = damp(0, 10, rate, 0.5);
    const two = damp(damp(0, 10, rate, 0.25), 10, rate, 0.25);
    expect(two).toBeCloseTo(one, 6);
    expect(damp(0, 10, rate, 0)).toBe(0); // no time → no move
    expect(damp(0, 10, rate, 100)).toBeCloseTo(10, 4); // long time → arrives
  });
});

describe("Mathf.lerpAngle", () => {
  it("takes the short way across the ±pi seam", () => {
    const near = Math.PI - 0.1;
    const to = -Math.PI + 0.1; // just across the seam
    const mid = lerpAngle(near, to, 0.5);
    // Short arc crosses +pi (wrapping), not back through 0.
    expect(Math.abs(mid) > Math.PI - 0.2 || Math.abs(mid) > 3).toBe(true);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
  });
});

describe("Mathf.pingPong", () => {
  it("bounces between min and max", () => {
    expect(pingPong(0, 0, 10)).toBe(0);
    expect(pingPong(5, 0, 10)).toBe(5);
    expect(pingPong(10, 0, 10)).toBe(10);
    expect(pingPong(15, 0, 10)).toBe(5); // reflected back down
    expect(pingPong(20, 0, 10)).toBe(0);
    expect(pingPong(-3, 0, 10)).toBe(3); // negative t reflects too
  });
});

describe("Collision.circleRect", () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  it("returns null when apart, a normal+depth when touching", () => {
    expect(circleRect(20, 5, 3, rect)).toBeNull();
    const c = circleRect(12, 5, 3, rect); // 2px past the right edge, r=3 → overlap 1
    expect(c).not.toBeNull();
    expect(c!.nx).toBe(1);
    expect(c!.ny).toBe(0);
    expect(c!.depth).toBeCloseTo(1);
  });
  it("pushes out the nearest edge when the centre is inside", () => {
    const c = circleRect(2, 5, 1, rect); // inside, nearest edge is left (x=0)
    expect(c!.nx).toBe(-1);
    expect(c!.ny).toBe(0);
  });
});

describe("Collision.separateCircles", () => {
  it("gives the minimum translation to separate", () => {
    expect(separateCircles(0, 0, 5, 100, 0, 5)).toBeNull();
    const c = separateCircles(0, 0, 5, 8, 0, 5); // dist 8, radii sum 10 → overlap 2
    expect(c!.nx).toBe(-1); // a is left of b → push a further left
    expect(c!.depth).toBeCloseTo(2);
  });
});

describe("Collision.bounceInBounds", () => {
  it("clamps inside and reflects only inward-moving velocity", () => {
    const rect = { x: -2, y: 5, w: 4, h: 4 };
    const vel = { x: -3, y: 1 };
    const faces = bounceInBounds(rect, vel, { x: 0, y: 0, w: 100, h: 100 });
    expect(rect.x).toBe(0); // clamped
    expect(vel.x).toBe(3); // was moving left into the wall → flipped
    expect(faces.left).toBe(true);
    expect(faces.hit).toBe(true);
    // A body already resting on the edge moving away must NOT re-flip.
    const r2 = { x: 0, y: 0, w: 4, h: 4 };
    const v2 = { x: 2, y: 0 };
    bounceInBounds(r2, v2, { x: 0, y: 0, w: 100, h: 100 });
    expect(v2.x).toBe(2); // unchanged
  });
});

describe("Game.letterboxView", () => {
  it("maps logical↔screen and hit-tests the pointer", () => {
    const v = letterboxView(100, 100, 300, 200); // scale 2, ox 50, oy 0
    expect(v.scale).toBe(2);
    expect(v.point(10, 10)).toEqual({ x: 70, y: 20 });
    expect(v.toLogical(70, 20)).toEqual({ x: 10, y: 10 });
    expect(v.contains(70, 20, { x: 0, y: 0, w: 20, h: 20 })).toBe(true);
    expect(v.contains(0, 0, { x: 0, y: 0, w: 20, h: 20 })).toBe(false); // outside the fit
  });
});

describe("Game.createScoreTracker.reset", () => {
  it("resets the score but keeps best", () => {
    const t = createScoreTracker(`test_best_${Math.floor(seedRng(3)() * 1e6)}`);
    t.add(50);
    expect(t.score).toBe(50);
    expect(t.best).toBe(50);
    t.reset();
    expect(t.score).toBe(0);
    expect(t.best).toBe(50); // best survives a restart
  });
});

describe("Game.formatClock", () => {
  it("pads seconds and adds hours past an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(-100)).toBe("0:00");
  });
});

describe("Goodies.randFreeCell", () => {
  it("picks a free cell and returns null when the grid is full", () => {
    const taken = new Set(["0,0", "1,0"]);
    const p = randFreeCell(2, 1, (x, y) => taken.has(`${x},${y}`), seedRng(1));
    expect(p).toBeNull();
    const q = randFreeCell(2, 2, (x, y) => !(x === 1 && y === 1), seedRng(1));
    expect(q).toEqual({ x: 1, y: 1 }); // only free cell
  });
});

describe("Goodies.shuffle", () => {
  it("returns a permutation, deterministic under a seed", () => {
    const a = shuffle([1, 2, 3, 4, 5], seedRng(7));
    const b = shuffle([1, 2, 3, 4, 5], seedRng(7));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]); // same multiset
  });
});

describe("Goodies.addToInventory", () => {
  it("merges into same-item stacks, then fills empties, returning leftover", () => {
    const slots = [{ item: "gem", count: 8, max: 10 }, null, { item: "key", count: 1, max: 10 }];
    const left = addToInventory(slots, "gem", { max: 10, amount: 5 });
    expect(slots[0]!.count).toBe(10); // topped up (+2)
    expect(slots[1]).toEqual({ item: "gem", count: 3, max: 10 }); // overflow to empty
    expect(left).toBe(0);
    const over = addToInventory([{ item: "gem", count: 10, max: 10 }], "gem", {
      max: 10,
      amount: 4,
    });
    expect(over).toBe(4); // nowhere to go
  });
});

describe("Goodies.beatClock", () => {
  it("reports beat, phase and signed nearest-beat offset", () => {
    const b = beatClock(500, 400); // 1.25 beats in
    expect(b.beat).toBe(1);
    expect(b.phase).toBeCloseTo(0.25);
    expect(b.offset).toBeCloseTo(0.25 * 400); // just past beat 1
    const late = beatClock(700, 400); // phase 0.75 → nearest is the NEXT beat
    expect(late.offset).toBeCloseTo(-0.25 * 400);
  });
});

describe("Goodies.nearest", () => {
  it("finds the closest within range, else null", () => {
    const items = [
      { x: 10, y: 0 },
      { x: 3, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(nearest(0, 0, items, (i) => i)).toBe(items[1]);
    expect(nearest(0, 0, items, (i) => i, 2)).toBeNull(); // all beyond maxDist
  });
});

describe("Gizmos.patrol", () => {
  it("bounces between bounds and flips facing", () => {
    const p = patrol(0, 10, { start: 8, dir: 1 });
    expect(p.tick(4)).toBe(10); // clamps at max
    expect(p.dir).toBe(-1); // reversed
    expect(p.tick(4)).toBe(6);
  });
});

describe("Gizmos.trail", () => {
  it("keeps the newest points up to maxLen", () => {
    const t = trail(2);
    t.push(1, 1);
    t.push(2, 2);
    t.push(3, 3);
    expect(t.points).toEqual([
      { x: 3, y: 3 },
      { x: 2, y: 2 },
    ]); // newest first, capped
  });
});

describe("UI.grid", () => {
  it("splits an area into even cells, minus the gap", () => {
    const cells: Array<{ x: number; y: number; w: number; h: number }> = [];
    grid({ x: 0, y: 0, w: 100, h: 100, cols: 2, count: 4, gap: 10 }, (r) => cells.push(r));
    expect(cells.length).toBe(4);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 45, h: 45 }); // (100-10)/2
    expect(cells[3]).toEqual({ x: 55, y: 55, w: 45, h: 45 }); // bottom-right
  });
});

describe("Net.createRoster", () => {
  it("tracks peers: join flag, prune stale, sample live", () => {
    let clock = 0;
    const r = createRoster<{ x: number }>({ delayMs: 0, timeoutMs: 1000, now: () => clock });
    expect(r.update("a", { x: 1 }).isNew).toBe(true);
    expect(r.update("a", { x: 2 }).isNew).toBe(false); // seen before
    expect(r.size).toBe(1);
    clock = 1000;
    r.update("b", { x: 9 });
    expect(r.ids.sort()).toEqual(["a", "b"]);
    clock = 1600; // a last seen at 0 (stale), b at 1000 (fresh)
    expect(r.prune()).toEqual(["a"]);
    expect(r.size).toBe(1);
    const live = r.sample();
    expect(live.length).toBe(1);
    expect(live[0][0]).toBe("b");
    expect(live[0][1]).toEqual({ x: 9 });
  });
});

describe("Gizmos.undoStack", () => {
  it("restores prior snapshots and respects the cap", () => {
    const u = undoStack<{ n: number }>({ limit: 2 });
    u.push({ n: 1 });
    u.push({ n: 2 });
    u.push({ n: 3 }); // drops {n:1}
    expect(u.size).toBe(2);
    expect(u.undo()).toEqual({ n: 3 });
    expect(u.undo()).toEqual({ n: 2 });
    expect(u.undo()).toBeNull();
    expect(u.canUndo).toBe(false);
  });
});
