import { describe, expect, it } from "vitest";
import {
  approachAngle,
  chance,
  damageRoll,
  dayCycle,
  floodFill,
  gridFormation,
  gridLine,
  gridNeighbors,
  leadTarget,
  lineOfSight,
  ringFormation,
  rollDice,
  scoreRank,
  timingGrade,
  transferStack,
  waveScale,
  weightedPick,
  wrap,
  wrappedDelta,
  wrappedDistance,
} from "../index.js";

describe("Goodies.wrap", () => {
  it("wraps positive, negative and multi-span values into zero-based bounds", () => {
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(12, 10)).toBe(2);
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(-31, 10)).toBe(9);
  });

  it("supports an explicit minimum", () => {
    expect(wrap(180, -180, 180)).toBe(-180);
    expect(wrap(-181, -180, 180)).toBe(179);
    expect(wrap(540, -180, 180)).toBe(-180);
  });

  it("rejects empty, reversed and non-finite ranges", () => {
    expect(() => wrap(1, 0)).toThrow(RangeError);
    expect(() => wrap(1, 4, 4)).toThrow(RangeError);
    expect(() => wrap(1, 5, 4)).toThrow(RangeError);
    expect(() => wrap(1, Infinity)).toThrow(RangeError);
  });
});

describe("Goodies toroidal geometry", () => {
  it("returns the shortest signed displacement across either edge", () => {
    expect(wrappedDelta(98, 2, 100)).toBe(4);
    expect(wrappedDelta(2, 98, 100)).toBe(-4);
    expect(wrappedDelta(10, 40, 100)).toBe(30);
  });

  it("measures the shortest 2D wrapped distance", () => {
    expect(wrappedDistance(98, 49, 2, 1, 100, 50)).toBeCloseTo(Math.hypot(4, 2));
  });
});

describe("Goodies loot and cards", () => {
  it("picks weighted entries and ignores disabled weights", () => {
    const loot = [
      { value: "none", weight: 0 },
      { value: "common", weight: 3 },
      { value: "rare", weight: 1 },
    ];
    expect(weightedPick(loot, () => 0)).toBe("common");
    expect(weightedPick(loot, () => 0.99)).toBe("rare");
    expect(weightedPick([{ value: "x", weight: 0 }], () => 0)).toBeUndefined();
  });

});

describe("Goodies grids", () => {
  it("returns bounded cardinal or diagonal neighbors", () => {
    expect(gridNeighbors(0, 0, { cols: 3, rows: 3 })).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect(gridNeighbors(1, 1, { diagonal: true })).toHaveLength(8);
  });

  it("flood fills connected passable cells without crossing walls", () => {
    const open = new Set(["0,0", "1,0", "0,1", "2,1"]);
    expect(floodFill({ x: 0, y: 0 }, (x, y) => open.has(`${x},${y}`))).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  });
});

describe("Goodies steering", () => {
  it("approaches angles across the wrap seam", () => {
    const next = approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(next).toBeCloseTo(Math.PI - 0.05);
    expect(approachAngle(0, 1, 2)).toBe(1);
  });

  it("leads reachable targets and rejects impossible intercepts", () => {
    const aim = leadTarget(0, 0, 10, 0, 0, 1, 5);
    expect(aim).not.toBeNull();
    expect(aim!.x).toBeCloseTo(10);
    expect(aim!.y).toBeGreaterThan(0);
    expect(leadTarget(0, 0, 10, 0, 10, 0, 5)).toBeNull();
  });
});

describe("Goodies rhythm and racing", () => {
  it("grades timing windows symmetrically", () => {
    expect(timingGrade(-20)).toBe("perfect");
    expect(timingGrade(60)).toBe("great");
    expect(timingGrade(-100)).toBe("good");
    expect(timingGrade(200)).toBe("miss");
  });

});

describe("Goodies RPG and inventory", () => {
  it("supports chance, dice and critical damage with injected randomness", () => {
    expect(chance(0.5, () => 0.4)).toBe(true);
    expect(chance(0.5, () => 0.6)).toBe(false);
    expect(rollDice(2, 6, () => 0)).toBe(2);
    expect(rollDice(2, 6, () => 0.999)).toBe(12);
    expect(damageRoll(10, { variance: 0, critChance: 1 }, () => 0)).toEqual({
      amount: 20,
      critical: true,
    });
  });

  it("moves, merges and swaps inventory stacks", () => {
    const slots = [
      { item: "potion", count: 3, max: 5 },
      { item: "potion", count: 4, max: 5 },
      { item: "sword", count: 1, max: 1 },
      null,
    ];
    expect(transferStack(slots, 0, 1)).toBe(true);
    expect(slots[0]?.count).toBe(2);
    expect(slots[1]?.count).toBe(5);
    expect(transferStack(slots, 0, 3, 1)).toBe(true);
    expect(slots[3]?.count).toBe(1);
    expect(transferStack(slots, 2, 3)).toBe(true);
    expect(slots[2]?.item).toBe("potion");
  });
});

describe("Goodies tactics and formations", () => {
  it("traces grid lines and tests line of sight", () => {
    expect(gridLine(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(lineOfSight(0, 0, 3, 0, (x) => x === 2)).toBe(false);
    expect(lineOfSight(0, 0, 3, 0, (x) => x === 3, false)).toBe(true);
  });

  it("creates radial and centered grid formations", () => {
    expect(ringFormation(4, 0, 0, 10)[0]).toMatchObject({ x: 10, y: 0, angle: 0 });
    expect(gridFormation(3, 3, 10, 10)).toEqual([
      { x: -10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });
});

describe("Goodies progression and simulation", () => {
  it("computes ranks and wave scaling", () => {
    expect(scoreRank(1200, [0, 1000, 5000], ["C", "B", "A"])).toBe("B");
    const wave = waveScale(3, { count: 4, countPerWave: 2, healthGrowth: 2 });
    expect(wave).toMatchObject({ count: 8, health: 4 });
    expect(wave.speed).toBeCloseTo(1.0816);
  });

  it("wraps simulation time into day phases", () => {
    expect(dayCycle(0, 100).phase).toBe("dawn");
    expect(dayCycle(30, 100).phase).toBe("day");
    expect(dayCycle(60, 100).phase).toBe("dusk");
    expect(dayCycle(90, 100).phase).toBe("night");
    expect(dayCycle(130, 100).t).toBeCloseTo(0.3);
  });
});
