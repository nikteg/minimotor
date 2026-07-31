import { describe, expect, it } from "vitest";
import { fromGrid } from "@src/anim/sheet.js";
import { fromImages } from "@src/anim/states.js";
import { createClockHandle } from "@src/clock/index.js";

// A 4×3-state sheet over a 128×96 image of 32×32 cells.
const img = { width: 128, height: 96 } as HTMLImageElement;

function stepper(): { steps: () => number; advanceMs: (ms: number) => void } {
  let now = 0;
  return {
    steps: () => now,
    advanceMs(ms) {
      now += ms / (1000 / 60);
    },
  };
}

const OPTS = {
  frame: { w: 32, h: 32 },
  states: {
    idle: { row: 0, frames: 4, fps: 10 }, // 100ms per frame
    run: { row: 1, frames: 2, fps: 10 },
    hit: { row: 2, frames: 3, fps: 10 },
  },
} as const;

describe("Anim.fromGrid", () => {
  it("maps states/frames to source rects", () => {
    const s = fromGrid(img, OPTS);
    expect(s.rect("idle", 0)).toEqual({ sx: 0, sy: 0, sw: 32, sh: 32 });
    expect(s.rect("run", 1)).toEqual({ sx: 32, sy: 32, sw: 32, sh: 32 });
    expect(s.rect("hit", 99)).toEqual({ sx: 64, sy: 64, sw: 32, sh: 32 }); // clamped
  });

  it("cursors derive the frame from the clock — no ticking", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromGrid(img, OPTS).play("idle", { clock });
    expect(cur.frame).toBe(0);
    t.advanceMs(150);
    expect(cur.frame).toBe(1);
    t.advanceMs(300); // 450ms → frame 4 → wraps to 0 (4-frame loop)
    expect(cur.frame).toBe(0);
    expect(cur.done).toBe(false);
  });

  it("set() to the SAME state is a no-op — calling it every step never restarts", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromGrid(img, OPTS).play("idle", { clock });
    t.advanceMs(150);
    cur.set("idle"); // the classic bug: this must NOT reset to frame 0
    expect(cur.frame).toBe(1);
  });

  it("switching states restarts the new state's timeline", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromGrid(img, OPTS).play("idle", { clock });
    t.advanceMs(250);
    cur.set("run");
    expect(cur.state).toBe("run");
    expect(cur.frame).toBe(0);
    t.advanceMs(150);
    expect(cur.frame).toBe(1);
    expect(cur.rect.sy).toBe(32); // row 1
  });

  it("non-looping states hold the last frame and report done", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromGrid(img, OPTS).once("hit", { clock });
    t.advanceMs(1000);
    expect(cur.frame).toBe(2); // held at the last of 3 frames
    expect(cur.done).toBe(true);
  });

  it("cursors freeze with a held clock (pause for free)", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromGrid(img, OPTS).play("idle", { clock });
    t.advanceMs(150);
    clock.hold();
    t.advanceMs(500);
    expect(cur.frame).toBe(1); // frozen mid-cycle
  });

  it("pauses one cursor without holding its shared clock", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromGrid(img, OPTS).play("idle", { clock });
    t.advanceMs(150);
    cur.pause();
    t.advanceMs(500);
    expect(cur.paused).toBe(true);
    expect(cur.frame).toBe(1);
    cur.resume();
    t.advanceMs(50);
    expect(cur.paused).toBe(false);
    expect(cur.frame).toBe(2);
  });

  it("unknown states throw at play and set", () => {
    const s = fromGrid(img, OPTS);
    // @ts-expect-error — unknown state name
    expect(() => s.play("rnu")).toThrow(/unknown state/);
    const cur = s.play("idle", { clock: createClockHandle(1000 / 60) });
    // @ts-expect-error — unknown state name
    expect(() => cur.set("rnu")).toThrow(/unknown state/);
  });
});

// One image PER state — each a horizontal strip. Idle 4×(24w), run 2×(16w),
// jump a single 20×20 static frame.
const idleImg = { width: 96, height: 24 } as HTMLImageElement; // 4 × 24
const runImg = { width: 32, height: 16 } as HTMLImageElement; // 2 × 16
const jumpImg = { width: 20, height: 20 } as HTMLImageElement; // 1 frame

const KIT = {
  idle: { image: idleImg, frames: 4, fps: 10 }, // 100ms per frame
  run: { image: runImg, frames: 2, fps: 10 },
  jump: { image: jumpImg },
  hit: { image: runImg, frames: 2, fps: 10 },
} as const;

describe("Anim.fromImages (multi-image)", () => {
  it("derives per-state cell size from each image and frame count", () => {
    const kit = fromImages(KIT);
    expect(kit.rect("idle", 0)).toEqual({ sx: 0, sy: 0, sw: 24, sh: 24 });
    expect(kit.rect("idle", 2)).toEqual({ sx: 48, sy: 0, sw: 24, sh: 24 });
    expect(kit.rect("run", 1)).toEqual({ sx: 16, sy: 0, sw: 16, sh: 16 });
    expect(kit.rect("jump", 0)).toEqual({ sx: 0, sy: 0, sw: 20, sh: 20 }); // whole image
    expect(kit.rect("idle", 99)).toEqual({ sx: 72, sy: 0, sw: 24, sh: 24 }); // clamped
  });

  it("exposes the ACTIVE state's image as SpriteLike (switches with set)", () => {
    const cur = fromImages(KIT).play("idle", { clock: createClockHandle(1000 / 60) });
    expect(cur.sheet.image).toBe(idleImg);
    cur.set("run");
    expect(cur.sheet.image).toBe(runImg);
    expect(cur.rect).toEqual({ sx: 0, sy: 0, sw: 16, sh: 16 });
  });

  it("cursors derive the frame from the clock — no ticking", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromImages(KIT).play("idle", { clock });
    expect(cur.frame).toBe(0);
    t.advanceMs(150);
    expect(cur.frame).toBe(1);
    t.advanceMs(300); // 450ms → frame 4 → wraps to 0 (4-frame loop)
    expect(cur.frame).toBe(0);
    expect(cur.done).toBe(false);
  });

  it("set() to the SAME state is a no-op", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromImages(KIT).play("idle", { clock });
    t.advanceMs(150);
    cur.set("idle");
    expect(cur.frame).toBe(1);
  });

  it("switching states restarts the new state's timeline", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromImages(KIT).play("idle", { clock });
    t.advanceMs(250);
    cur.set("run");
    expect(cur.state).toBe("run");
    expect(cur.frame).toBe(0);
    t.advanceMs(150);
    expect(cur.frame).toBe(1);
  });

  it("non-looping states hold the last frame and report done", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromImages(KIT).once("hit", { clock });
    t.advanceMs(1000);
    expect(cur.frame).toBe(1); // held at the last of 2 frames
    expect(cur.done).toBe(true);
  });

  it("a single-frame state never advances", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromImages(KIT).play("jump", { clock });
    t.advanceMs(1000);
    expect(cur.frame).toBe(0);
  });

  it("can pause and resume one cursor", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const cur = fromImages(KIT).play("idle", { clock });
    t.advanceMs(150);
    cur.pause();
    t.advanceMs(500);
    expect(cur.frame).toBe(1);
    cur.resume();
    t.advanceMs(50);
    expect(cur.frame).toBe(2);
  });

  it("unknown states throw at play and set", () => {
    const kit = fromImages(KIT);
    // @ts-expect-error — unknown state name
    expect(() => kit.play("nope")).toThrow(/unknown state/);
    const cur = kit.play("idle", { clock: createClockHandle(1000 / 60) });
    // @ts-expect-error — unknown state name
    expect(() => cur.set("nope")).toThrow(/unknown state/);
  });
});
