import { describe, expect, it } from "vitest";
import { charges, combo, distanceField, flash, seedRng, shuffleBag } from "../index.js";

describe("Goodies.seedRng", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = seedRng(1234);
    const b = seedRng(1234);
    const seq = Array.from({ length: 6 }, () => a());
    expect(Array.from({ length: 6 }, () => b())).toEqual(seq); // same seed → same stream
    for (const v of seq) (expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(1));
    expect(new Set(seq).size).toBeGreaterThan(1); // not a constant
  });

  it("different seeds produce different streams", () => {
    const one = seedRng(1)();
    const two = seedRng(2)();
    expect(one).not.toBe(two);
  });

  it("makes a shuffleBag replayable", () => {
    const draw = () => {
      const bag = shuffleBag([1, 2, 3, 4, 5], seedRng(99));
      return Array.from({ length: 5 }, () => bag.next());
    };
    expect(draw()).toEqual(draw());
  });
});

describe("Goodies.distanceField", () => {
  // A 5-wide corridor with a wall at x=2 (row 0 open, everything else wall).
  const open = (x: number, y: number) => y === 0 && x >= 0 && x < 5 && x !== 2;

  it("measures BFS steps from the source and marks unreachable as Infinity", () => {
    const field = distanceField({ x: 0, y: 0 }, open);
    expect(field.at(0, 0)).toBe(0);
    expect(field.at(1, 0)).toBe(1);
    expect(field.at(2, 0)).toBe(Infinity); // the wall
    expect(field.at(3, 0)).toBe(Infinity); // cut off behind the wall
    expect(field.at(0, 1)).toBe(Infinity); // off the corridor
  });

  it("takes multiple sources (nearest wins)", () => {
    const flat = (x: number, y: number) => y === 0 && x >= 0 && x < 5;
    const field = distanceField(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      flat,
    );
    expect(field.at(0, 0)).toBe(0);
    expect(field.at(4, 0)).toBe(0);
    expect(field.at(2, 0)).toBe(2); // two steps from either end
    expect(field.cells.length).toBe(5);
  });
});

describe("Goodies.combo", () => {
  it("counts hits and scales the multiplier, resetting when the window lapses", () => {
    const c = combo({ windowMs: 100, step: 1 });
    expect(c.count).toBe(0);
    expect(c.multiplier).toBe(1);
    c.hit();
    expect(c.count).toBe(1);
    expect(c.multiplier).toBe(1); // 1 + (1-1)*1
    c.hit();
    expect(c.count).toBe(2);
    expect(c.multiplier).toBe(2); // 1 + (2-1)*1
    c.tick(60); // still inside the window
    expect(c.count).toBe(2);
    c.tick(60); // window lapsed → streak drops
    expect(c.count).toBe(0);
    expect(c.active).toBe(false);
  });

  it("caps the multiplier and reset() clears the streak", () => {
    const c = combo({ windowMs: 100, step: 0.5, max: 2 });
    for (let i = 0; i < 10; i++) c.hit();
    expect(c.multiplier).toBe(2); // capped
    c.reset();
    expect(c.count).toBe(0);
  });
});

describe("Goodies.charges", () => {
  it("spends and refills one charge per interval", () => {
    const ch = charges({ max: 2, refillMs: 100, start: 0 });
    expect(ch.count).toBe(0);
    expect(ch.use()).toBe(false); // empty
    ch.tick(100);
    expect(ch.count).toBe(1);
    expect(ch.use()).toBe(true);
    expect(ch.count).toBe(0);
    ch.tick(250); // fills 2 (capped at max), leftover progress discarded
    expect(ch.count).toBe(2);
    expect(ch.fraction).toBe(1);
  });

  it("refill() tops up instantly and fraction tracks progress", () => {
    const ch = charges({ max: 1, refillMs: 200, start: 0 });
    ch.tick(100);
    expect(ch.fraction).toBeCloseTo(0.5);
    ch.refill();
    expect(ch.count).toBe(1);
    expect(ch.fraction).toBe(1);
  });
});

describe("Goodies.flash", () => {
  it("jumps to 1 on hit and fades linearly to 0", () => {
    const f = flash(100);
    expect(f.value).toBe(0);
    expect(f.active).toBe(false);
    f.hit();
    expect(f.value).toBe(1);
    expect(f.active).toBe(true);
    f.tick(50);
    expect(f.value).toBeCloseTo(0.5);
    f.tick(50);
    expect(f.value).toBe(0);
    expect(f.active).toBe(false);
  });
});
