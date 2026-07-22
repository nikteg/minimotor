import { describe, expect, it } from "vitest";
import {
  car,
  charges,
  checkpointRoute,
  combo,
  flash,
  seedRng,
  shuffleBag,
  skidmarks,
} from "../index.js";
import { createClockHandle } from "../../clock.js";

describe("Gizmos.seedRng", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = seedRng(1234);
    const b = seedRng(1234);
    const seq = Array.from({ length: 6 }, () => a());
    expect(Array.from({ length: 6 }, () => b())).toEqual(seq); // same seed → same stream
    for (const v of seq) (expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(1));
    expect(new Set(seq).size).toBeGreaterThan(1); // not a constant
  });

  it("different seeds produce different streams", () => {
    expect(seedRng(1)()).not.toBe(seedRng(2)());
  });
});

describe("Gizmos.shuffleBag", () => {
  it("draws every item before refilling", () => {
    const bag = shuffleBag(["a", "b", "c"], () => 0);
    expect(new Set([bag.next(), bag.next(), bag.next()])).toEqual(new Set(["a", "b", "c"]));
    expect(bag.remaining).toBe(0);
    expect(bag.next()).toBeDefined();
    expect(bag.remaining).toBe(2);
  });

  it("is replayable under a seeded rng", () => {
    const draw = () => {
      const bag = shuffleBag([1, 2, 3, 4, 5], seedRng(99));
      return Array.from({ length: 5 }, () => bag.next());
    };
    expect(draw()).toEqual(draw());
  });
});

// Shared hand-cranked clock (1 unit = 1 ms of derived time).
function clockMs() {
  let now = 0;
  const clock = createClockHandle(() => now);
  return { clock, advance: (ms) => (now += ms / (1000 / 60)) };
}

describe("Gizmos.combo", () => {
  it("counts hits and scales the multiplier, resetting when the window lapses", () => {
    const t = clockMs();
    const c = combo({ windowMs: 100, step: 1, clock: t.clock });
    expect(c.multiplier).toBe(1);
    c.hit();
    c.hit();
    expect(c.count).toBe(2);
    expect(c.multiplier).toBe(2);
    t.advance(60);
    expect(c.count).toBe(2);
    t.advance(60); // window lapsed
    expect(c.count).toBe(0);
    expect(c.active).toBe(false);
  });

  it("caps the multiplier and reset() clears the streak", () => {
    const t = clockMs();
    const c = combo({ windowMs: 100, step: 0.5, max: 2, clock: t.clock });
    for (let i = 0; i < 10; i++) c.hit();
    expect(c.multiplier).toBe(2);
    c.reset();
    expect(c.count).toBe(0);
  });
});

describe("Gizmos.charges", () => {
  it("spends and refills one charge per interval", () => {
    const t = clockMs();
    const ch = charges({ max: 2, refillMs: 100, start: 0, clock: t.clock });
    expect(ch.use()).toBe(false); // empty
    t.advance(100);
    expect(ch.count).toBe(1);
    expect(ch.use()).toBe(true);
    t.advance(250); // fills 2 (capped), leftover discarded
    expect(ch.count).toBe(2);
    expect(ch.fraction).toBe(1);
  });

  it("refill() tops up instantly and fraction tracks progress", () => {
    const t = clockMs();
    const ch = charges({ max: 1, refillMs: 200, start: 0, clock: t.clock });
    t.advance(100);
    expect(ch.fraction).toBeCloseTo(0.5);
    ch.refill();
    expect(ch.count).toBe(1);
  });
});

describe("Gizmos.flash", () => {
  it("jumps to 1 on hit and fades to 0 on its clock", () => {
    let steps = 0;
    const clock = createClockHandle(() => steps);
    const f = flash(100, undefined, clock);
    expect(f.active).toBe(false);
    f.hit();
    expect(f.value).toBe(1);
    steps += 50 / (1000 / 60);
    expect(f.value).toBeCloseTo(0.5);
    steps += 50 / (1000 / 60);
    expect(f.value).toBe(0);
    expect(f.active).toBe(false);
  });
});

describe("Gizmos.checkpointRoute", () => {
  it("tracks ordered checkpoints and completed laps", () => {
    const route = checkpointRoute(3);
    expect(route.visit(1)).toBe(false); // out of order
    expect(route.visit(0)).toBe(true);
    expect(route.visit(1)).toBe(true);
    expect(route.visit(2)).toBe(true);
    expect(route.lap).toBe(1);
    expect(route.next).toBe(0);
    route.reset();
    expect(route.lap).toBe(0);
    expect(() => checkpointRoute(0)).toThrow(RangeError);
  });
});

describe("Gizmos.car", () => {
  it("accelerates forward along the body heading", () => {
    const body = { rot: 0, vx: 0, vy: 0, spin: 0 }; // facing +x
    const c = car(body, { acceleration: 1000, drag: 0 });
    c.drive({ throttle: 1 }, 0.1);
    expect(c.speed).toBeGreaterThan(0);
    expect(body.vx).toBeGreaterThan(0);
    expect(Math.abs(body.vy)).toBeLessThan(1e-6);
  });

  it("reports engine load and raises tyre slip under a handbrake turn", () => {
    const body = { rot: 0, vx: 120, vy: 40, spin: 0 };
    const c = car(body);
    c.drive({ throttle: 1, steer: 1, handbrake: true }, 0.1);
    expect(c.engineLoad).toBe(1);
    expect(c.tireSlip).toBeGreaterThan(0);
  });
});

describe("Gizmos.skidmarks", () => {
  it("lays segments only while marking, and needs a previous frame to connect", () => {
    const s = skidmarks({ emitEvery: 0 });
    // First marking step has no previous wheel position → nothing yet.
    s.trace(0, 0, 0, { marking: true }, 0.016);
    expect(s.count).toBe(0);
    // Second marking step connects from the first → two segments (one per wheel).
    s.trace(10, 0, 0, { marking: true }, 0.016);
    expect(s.count).toBe(2);
    // Not marking lays nothing more.
    s.trace(20, 0, 0, { marking: false }, 0.016);
    expect(s.count).toBe(2);
  });

  it("ages marks out after their life and clears on demand", () => {
    const s = skidmarks({ emitEvery: 0, life: 1 });
    s.trace(0, 0, 0, { marking: true }, 0.016);
    s.trace(10, 0, 0, { marking: true }, 0.016);
    expect(s.count).toBe(2);
    s.trace(20, 0, 0, { marking: false }, 2); // dt past life → marks expire
    expect(s.count).toBe(0);
    // Pen-up (not marking) ends the streak, so a new drift starts fresh: the
    // first step re-anchors (no segment), the second connects it → 2.
    s.trace(30, 0, 0, { marking: true }, 0.016);
    s.trace(40, 0, 0, { marking: true }, 0.016);
    expect(s.count).toBe(2);
    s.clear();
    expect(s.count).toBe(0);
  });

  it("caps stored marks at `max`, dropping the oldest", () => {
    const s = skidmarks({ emitEvery: 0, max: 4 });
    for (let i = 0; i < 10; i++) s.trace(i * 5, 0, 0, { marking: true }, 0.016);
    expect(s.count).toBe(4);
  });

  it("lays one segment per configured tyre", () => {
    const s = skidmarks({
      emitEvery: 0,
      wheels: [
        { along: -10, across: -8 },
        { along: -10, across: 8 },
        { along: 12, across: -8 },
        { along: 12, across: 8 },
      ],
    });
    s.trace(0, 0, 0, { marking: true }, 0.016); // no previous frame yet
    s.trace(10, 0, 0, { marking: true }, 0.016); // one segment per wheel
    expect(s.count).toBe(4);
  });

  it("connects consecutive segments into an unbroken streak while marking", () => {
    // A single tyre at the car centre, sliding straight along +x each step.
    const s = skidmarks({ emitEvery: 0, wheels: [{ along: 0, across: 0 }] });
    for (let i = 0; i < 4; i++) s.trace(i * 10, 0, 0, { marking: true }, 0.016);

    // Capture the drawn segments' endpoints.
    const segs: Array<[number, number, number, number]> = [];
    let cur: [number, number] = [0, 0];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      stroke() {},
      moveTo(x: number, y: number) {
        cur = [x, y];
      },
      lineTo(x: number, y: number) {
        segs.push([cur[0], cur[1], x, y]);
      },
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set lineCap(_v: string) {},
      set globalAlpha(_v: number) {},
    } as unknown as CanvasRenderingContext2D;
    s.draw(ctx);

    expect(segs.length).toBeGreaterThan(1);
    // Each segment's end is the next segment's start → no gaps.
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i][0]).toBeCloseTo(segs[i - 1][2]);
      expect(segs[i][1]).toBeCloseTo(segs[i - 1][3]);
    }
  });

  it("keeps marks forever when life is Infinity (continuous)", () => {
    const s = skidmarks({ emitEvery: 0, life: Infinity });
    s.trace(0, 0, 0, { marking: true }, 0.016);
    s.trace(10, 0, 0, { marking: true }, 0.016);
    expect(s.count).toBe(2);
    s.trace(20, 0, 0, { marking: false }, 1e6); // huge dt would expire timed marks
    expect(s.count).toBe(2); // permanent → still there
  });
});
