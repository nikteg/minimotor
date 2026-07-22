import { describe, expect, it } from "vitest";
import { sheet } from "../sheet.js";
import { createClockHandle } from "../../clock.js";

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
    hit: { row: 2, frames: 3, fps: 10, loop: false },
  },
} as const;

describe("Anim.sheet", () => {
  it("maps states/frames to source rects", () => {
    const s = sheet(img, OPTS);
    expect(s.rect("idle", 0)).toEqual({ sx: 0, sy: 0, sw: 32, sh: 32 });
    expect(s.rect("run", 1)).toEqual({ sx: 32, sy: 32, sw: 32, sh: 32 });
    expect(s.rect("hit", 99)).toEqual({ sx: 64, sy: 64, sw: 32, sh: 32 }); // clamped
  });

  it("cursors derive the frame from the clock — no ticking", () => {
    const t = stepper();
    const clock = createClockHandle(t.steps);
    const cur = sheet(img, OPTS).play("idle", { clock });
    expect(cur.frame).toBe(0);
    t.advanceMs(150);
    expect(cur.frame).toBe(1);
    t.advanceMs(300); // 450ms → frame 4 → wraps to 0 (4-frame loop)
    expect(cur.frame).toBe(0);
    expect(cur.done).toBe(false);
  });

  it("set() to the SAME state is a no-op — calling it every step never restarts", () => {
    const t = stepper();
    const clock = createClockHandle(t.steps);
    const cur = sheet(img, OPTS).play("idle", { clock });
    t.advanceMs(150);
    cur.set("idle"); // the classic bug: this must NOT reset to frame 0
    expect(cur.frame).toBe(1);
  });

  it("switching states restarts the new state's timeline", () => {
    const t = stepper();
    const clock = createClockHandle(t.steps);
    const cur = sheet(img, OPTS).play("idle", { clock });
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
    const clock = createClockHandle(t.steps);
    const cur = sheet(img, OPTS).play("hit", { clock });
    t.advanceMs(1000);
    expect(cur.frame).toBe(2); // held at the last of 3 frames
    expect(cur.done).toBe(true);
  });

  it("cursors freeze with a held clock (pause for free)", () => {
    const t = stepper();
    const clock = createClockHandle(t.steps);
    const cur = sheet(img, OPTS).play("idle", { clock });
    t.advanceMs(150);
    clock.hold();
    t.advanceMs(500);
    expect(cur.frame).toBe(1); // frozen mid-cycle
  });

  it("unknown states throw at play and set", () => {
    const s = sheet(img, OPTS);
    // @ts-expect-error — unknown state name
    expect(() => s.play("rnu")).toThrow(/unknown state/);
    const cur = s.play("idle");
    // @ts-expect-error — unknown state name
    expect(() => cur.set("rnu")).toThrow(/unknown state/);
  });
});
