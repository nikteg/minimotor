// ---------- Clocks ----------
// Time as a first-class value. `Clock.world` is world time — the app's
// content clock, held by modal scene pushes, scalable for slow-motion. `Clock.ui` is
// interface time and never stops by convention (pause-menu pulses).
// `Clock.create()` makes custom timelines (cutscenes, a boss with its own
// holdable clock).
//
// A clock DERIVES its `now` from the engine's fixed-step counter — pull,
// don't push — so holding or scaling it bends every value derived from it
// (motions, sheet cursors, animated tiles) with zero cooperation from them:
//
//   Clock.world.hold();        // hit-stop: the world freezes mid-air
//   Clock.world.scale = 0.5;   // slow-mo: the world, not the HUD
//
// Timers (`after`/`every`) are the stated scheduling exception to the pull
// law: they must FIRE code, so clocks with pending timers are driven from the
// loop's fixed step. A clock with no pending timers is referenced by nothing
// and GCs away with its owner.

import type { Runtime } from "@src/engine/app.js";
import { animate as animateValue, type AnimateOptions, type Motion } from "@src/anim/value.js";

/** A running timer; call to cancel early. */
export type Cancel = () => void;

/** A timeline: `now` derives from the fixed-step counter, and it's holdable,
 *  scalable, and can schedule timers/motions in its own time. */
export interface ClockHandle {
  /** Milliseconds represented by one step of the clock's source. */
  readonly step: number;
  /** Milliseconds elapsed on THIS clock (frozen while held, bent by scale). */
  readonly now: number;
  /** True while the clock is frozen by `hold()`. */
  readonly held: boolean;
  /** Time multiplier: 0.5 = slow motion, 2 = fast forward. Rebases cleanly —
   *  changing it never jumps `now`. */
  scale: number;
  /** Freeze the clock (idempotent). Every derived value freezes with it. */
  hold(): void;
  /** Resume from a hold (idempotent). */
  release(): void;
  /** Run `fn` once after `ms` (in this clock's time). Returns a canceler. */
  after(ms: number, fn: () => void): Cancel;
  /** Run `fn` every `ms` (in this clock's time). Returns a canceler. */
  every(ms: number, fn: () => void): Cancel;
  /** A Motion in this clock's time — see `Anim.animate`. */
  animate(opts: Omit<AnimateOptions, "clock">): Motion;
}

interface TimerJob {
  due: number;
  interval: number; // 0 = one-shot
  fn: () => void;
  dead: boolean;
}

// Clocks with pending timers register a fire closure here; the loop's step
// drives them. Fire returns false when the clock has no timers left, which
// drops it from the set (nothing references an idle clock).
const driven = new Set<() => boolean>();

// A snapshot is needed (a callback may schedule on another clock mid-pass, and
// a clock that runs dry is dropped from the set), but this runs on EVERY fixed
// step — so reuse one array instead of allocating a copy per step. Not
// reentrant; nothing drives the clocks from inside a timer callback.
const drivenScratch: (() => boolean)[] = [];

function fireAll(): void {
  drivenScratch.length = 0;
  for (const fire of driven) drivenScratch.push(fire);
  for (const fire of drivenScratch) {
    if (!fire()) driven.delete(fire);
  }
  drivenScratch.length = 0;
}

function registerStandalone(fire: () => boolean): void {
  driven.add(fire);
}

/** Drive timer firing manually — for tests without a running loop. */
export function _driveClocks(): void {
  fireAll();
}

/** Build a clock over a fixed-step source (injectable for tests). */
export function createClockHandle(
  stepMs: number,
  steps: () => number = () => 0,
  register: (fire: () => boolean) => void = registerStandalone,
): ClockHandle {
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new RangeError("createClockHandle: stepMs must be a positive finite number");
  }
  let anchorSteps = steps();
  let anchorMs = 0;
  let scaleV = 1;
  let held = false;
  const timers = new Set<TimerJob>();

  const nowMs = (): number =>
    held ? anchorMs : anchorMs + (steps() - anchorSteps) * stepMs * scaleV;
  const rebase = (): void => {
    anchorMs = nowMs();
    anchorSteps = steps();
  };

  // Per-clock scratch for the same reason as `drivenScratch`: a firing
  // callback may cancel or schedule timers on this clock, so the pass runs off
  // a snapshot — but it runs every fixed step, so the snapshot is reused. The
  // `dead` re-check below is what makes a mid-pass cancel take effect.
  const fireScratch: TimerJob[] = [];

  const fire = (): boolean => {
    const now = nowMs();
    fireScratch.length = 0;
    for (const t of timers) fireScratch.push(t);
    for (const t of fireScratch) {
      while (!t.dead && t.due <= now) {
        t.fn();
        if (t.interval > 0) t.due += t.interval;
        else {
          t.dead = true;
          timers.delete(t);
        }
      }
    }
    fireScratch.length = 0;
    return timers.size > 0;
  };

  const schedule = (t: TimerJob): Cancel => {
    timers.add(t);
    register(fire);
    return () => {
      t.dead = true;
      timers.delete(t);
    };
  };

  const handle: ClockHandle = {
    step: stepMs,
    get now() {
      return nowMs();
    },
    get held() {
      return held;
    },
    get scale() {
      return scaleV;
    },
    set scale(v: number) {
      if (!Number.isFinite(v) || v < 0) {
        throw new RangeError("Minimotor: clock scale must be a finite number >= 0");
      }
      rebase();
      scaleV = v;
    },
    hold() {
      if (!held) {
        rebase();
        held = true;
      }
    },
    release() {
      if (held) {
        anchorSteps = steps();
        held = false;
      }
    },
    after(ms, fn) {
      return schedule({ due: nowMs() + ms, interval: 0, fn, dead: false });
    },
    every(ms, fn) {
      return schedule({
        due: nowMs() + ms,
        interval: Math.max(ms, 0),
        fn,
        dead: false,
      });
    },
    animate(opts) {
      return animateValue({ ...opts, clock: handle });
    },
  };
  return handle;
}

export interface ClockApi {
  readonly world: ClockHandle;
  readonly ui: ClockHandle;
  create(): ClockHandle;
}

/** Create world/UI/custom clocks permanently driven by one app. */
export function createClockApi(app: Pick<Runtime, "steps" | "onStep" | "step">): ClockApi {
  const active = new Set<() => boolean>();
  const register = (fire: () => boolean) => active.add(fire);
  app.onStep(() => {
    for (const fire of active) if (!fire()) active.delete(fire);
  });
  const steps = () => app.steps;
  const world = createClockHandle(app.step, steps, register);
  const ui = createClockHandle(app.step, steps, register);
  return {
    world,
    ui,
    create: () => createClockHandle(app.step, steps, register),
  };
}
