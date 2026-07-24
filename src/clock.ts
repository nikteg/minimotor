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

import { Loop, STEP_MS, stepNow } from "./engine/index.js";
import { animate as animateValue, type AnimateOptions, type Motion } from "./anim/value.js";

/** A running timer; call to cancel early. */
export type Cancel = () => void;

/** A timeline: `now` derives from the fixed-step counter, and it's holdable,
 *  scalable, and can schedule timers/motions in its own time. */
export interface ClockHandle {
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
let driverWired = false;

function fireAll(): void {
  for (const fire of [...driven]) {
    if (!fire()) driven.delete(fire);
  }
}

function ensureDriver(): void {
  if (driverWired) return;
  try {
    Loop.onStep(fireAll);
    driverWired = true;
  } catch {
    // No default game yet: steps aren't advancing, so nothing can come due.
    // Wiring retries on the next timer registration.
  }
}

/** Drive timer firing manually — for tests without a running loop. */
export function _driveClocks(): void {
  fireAll();
}

/** Build a clock over a fixed-step source (injectable for tests). */
export function createClockHandle(steps: () => number = stepNow): ClockHandle {
  let anchorSteps = steps();
  let anchorMs = 0;
  let scaleV = 1;
  let held = false;
  const timers = new Set<TimerJob>();

  const nowMs = (): number =>
    held ? anchorMs : anchorMs + (steps() - anchorSteps) * STEP_MS * scaleV;
  const rebase = (): void => {
    anchorMs = nowMs();
    anchorSteps = steps();
  };

  const fire = (): boolean => {
    const now = nowMs();
    for (const t of [...timers]) {
      while (!t.dead && t.due <= now) {
        t.fn();
        if (t.interval > 0) t.due += t.interval;
        else {
          t.dead = true;
          timers.delete(t);
        }
      }
    }
    return timers.size > 0;
  };

  const schedule = (t: TimerJob): Cancel => {
    timers.add(t);
    driven.add(fire);
    ensureDriver();
    return () => {
      t.dead = true;
      timers.delete(t);
    };
  };

  const handle: ClockHandle = {
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
      return schedule({ due: nowMs() + ms, interval: Math.max(ms, 0), fn, dead: false });
    },
    animate(opts) {
      return animateValue({ ...opts, clock: handle });
    },
  };
  return handle;
}

let worldClock = createClockHandle();
let uiClock = createClockHandle();

/** The two ambient clocks + custom timelines. `Clock.world` drives the world
 *  (pausable, scalable), `Clock.ui` keeps menus and HUD ticking while the
 *  world is held; `Clock.create` makes an independent timeline. Slow-mo and
 *  hit-stop are one-liners:
 *
 *    Clock.world.scale = 0.25;   // slow motion
 *    Clock.world.hold();         // hit-stop: the world freezes, UI keeps ticking
 *    Clock.world.resume();
 */
export const Clock = {
  /** World time: the content clock — held by modal scene pushes, scalable for
   *  slow-mo. The default clock for all world content (motions, cursors,
   *  animated tiles). */
  get world(): ClockHandle {
    return worldClock;
  },
  /** Interface time: never held by convention — pause menus stay alive. */
  get ui(): ClockHandle {
    return uiClock;
  },
  /** A custom timeline with the full toolkit (cutscenes, boss clocks). */
  create(): ClockHandle {
    return createClockHandle();
  },
  /** Reset the ambient clocks and timer wiring — for tests. */
  _reset(): void {
    worldClock = createClockHandle();
    uiClock = createClockHandle();
    driven.clear();
    driverWired = false;
  },
};
