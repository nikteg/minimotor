// Module-local clock tests.
import { describe, expect, it, vi } from "vitest";
import { createClockHandle, _driveClocks } from "@src/clock/index.js";
import { animate, sequence, parallel } from "@src/anim/value.js";

// Hand-cranked step source: 1 step = 1000/60 ms of derived clock time.
function stepper(): { steps: () => number; advanceMs: (ms: number) => void } {
  let now = 0;
  return {
    steps: () => now,
    advanceMs(ms) {
      now += ms / (1000 / 60);
    },
  };
}

describe("ClockHandle (pull-derived time)", () => {
  it("now derives from the step counter", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    expect(clock.now).toBe(0);
    t.advanceMs(500);
    expect(clock.now).toBeCloseTo(500);
  });

  it("hold freezes now; release resumes without jumping", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    t.advanceMs(100);
    clock.hold();
    t.advanceMs(400);
    expect(clock.now).toBeCloseTo(100); // frozen
    clock.release();
    t.advanceMs(50);
    expect(clock.now).toBeCloseTo(150); // the held 400ms never happened
  });

  it("scale bends time and rebases cleanly", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    t.advanceMs(100);
    clock.scale = 0.5;
    expect(clock.now).toBeCloseTo(100); // no jump on change
    t.advanceMs(100);
    expect(clock.now).toBeCloseTo(150); // half speed
    clock.scale = 2;
    t.advanceMs(100);
    expect(clock.now).toBeCloseTo(350); // double speed
  });

  it("after fires once when due, via the driver", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const fn = vi.fn();
    clock.after(100, fn);
    t.advanceMs(60);
    _driveClocks();
    expect(fn).not.toHaveBeenCalled();
    t.advanceMs(60);
    _driveClocks();
    expect(fn).toHaveBeenCalledTimes(1);
    t.advanceMs(1000);
    _driveClocks();
    expect(fn).toHaveBeenCalledTimes(1); // one-shot
  });

  it("every repeats and catches up over a large gap", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const fn = vi.fn();
    clock.every(100, fn);
    t.advanceMs(350);
    _driveClocks();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("cancel prevents firing", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const fn = vi.fn();
    const cancel = clock.after(100, fn);
    cancel();
    t.advanceMs(500);
    _driveClocks();
    expect(fn).not.toHaveBeenCalled();
  });

  // The fire pass runs off a REUSED snapshot array (no per-step allocation),
  // so these pin the mutation guarantees that snapshot has to preserve.
  it("a timer cancelled by an earlier callback in the same pass does not fire", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const victim = vi.fn();
    let cancelVictim: (() => void) | null = null;
    clock.after(50, () => cancelVictim?.());
    cancelVictim = clock.after(60, victim);
    t.advanceMs(500);
    _driveClocks();
    expect(victim).not.toHaveBeenCalled();
  });

  it("a timer scheduled from inside a callback still fires later", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const late = vi.fn();
    clock.after(50, () => clock.after(50, late));
    t.advanceMs(60);
    _driveClocks();
    expect(late).not.toHaveBeenCalled(); // not due yet
    t.advanceMs(100);
    _driveClocks();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("cancelling every timer mid-pass leaves the clock idle", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const other = vi.fn();
    const cancelOther = clock.every(10, other);
    clock.after(50, () => cancelOther());
    t.advanceMs(500);
    _driveClocks();
    const callsAfterFirstPass = other.mock.calls.length;
    t.advanceMs(500);
    _driveClocks();
    expect(other).toHaveBeenCalledTimes(callsAfterFirstPass);
  });

  it("timers on a held clock never come due", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const fn = vi.fn();
    clock.after(100, fn);
    clock.hold();
    t.advanceMs(5000);
    _driveClocks();
    expect(fn).not.toHaveBeenCalled();
    clock.release();
    t.advanceMs(120);
    _driveClocks();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Motion (clock-derived value animation)", () => {
  it("derives value from elapsed clock time — no ticking", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const m = animate({ from: 0, to: 10, ms: 100, clock });
    expect(m.value).toBe(0);
    t.advanceMs(50);
    expect(m.value).toBeCloseTo(5);
    t.advanceMs(100);
    expect(m.value).toBe(10); // finished motions hold their end value
    expect(m.done).toBe(true);
  });

  it("freezes with a held clock — pause needs no cooperation", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const m = animate({ from: 0, to: 10, ms: 100, clock });
    t.advanceMs(30);
    clock.hold();
    const frozen = m.value;
    t.advanceMs(500);
    expect(m.value).toBeCloseTo(frozen);
    clock.release();
    t.advanceMs(70);
    expect(m.value).toBeCloseTo(10);
  });

  it("clock.animate is sugar for animate({ clock })", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const m = clock.animate({ from: 0, to: 4, ms: 100 });
    t.advanceMs(50);
    expect(m.value).toBeCloseTo(2);
  });

  it("delay holds the start value, then plays", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const m = animate({ from: 1, to: 2, ms: 100, delay: 100, clock });
    t.advanceMs(50);
    expect(m.value).toBe(1); // still in delay
    t.advanceMs(100); // 50ms into the ramp
    expect(m.value).toBeCloseTo(1.5);
  });

  it("yoyo ping-pongs and never reports done", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const yo = animate({ from: 0, to: 10, ms: 100, yoyo: true, clock });
    t.advanceMs(50);
    expect(yo.value).toBeCloseTo(5); // halfway up
    t.advanceMs(100); // 150ms: halfway back down
    expect(yo.value).toBeCloseTo(5);
    t.advanceMs(50); // 200ms: back at the start
    expect(yo.value).toBeCloseTo(0);
    expect(yo.done).toBe(false);
  });

  it("sequence plays steps on one timeline", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const m = sequence(
      [
        { from: 0, to: 1, ms: 100 },
        { from: 1, to: 0, ms: 100 },
      ],
      { clock },
    );
    t.advanceMs(50);
    expect(m.value).toBeCloseTo(0.5);
    t.advanceMs(100); // 50ms into step 2
    expect(m.value).toBeCloseTo(0.5);
    t.advanceMs(100);
    expect(m.done).toBe(true);
    expect(m.value).toBe(0); // holds the last step's end
  });

  it("parallel starts tracks together and finishes when all do", () => {
    const t = stepper();
    const clock = createClockHandle(1000 / 60, t.steps);
    const p = parallel(
      [
        { from: 0, to: 1, ms: 100 },
        { from: 0, to: 2, ms: 200 },
      ],
      { clock },
    );
    t.advanceMs(100);
    expect(p.tracks[0].done).toBe(true);
    expect(p.done).toBe(false);
    t.advanceMs(100);
    expect(p.done).toBe(true);
    expect(p.tracks[1].value).toBe(2);
  });
});
