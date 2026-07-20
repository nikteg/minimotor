// ---------- Clock & Tween ----------
// Deterministic time: both advance on the fixed update step (via Loop.onStep),
// so timers and tweens pause with the loop, survive multi-step frames, and stay
// replay-safe. Times are in milliseconds; each step is Loop.step (1000/60).
//
//   Minimotor.Clock.after(600, unlock);            // one-shot
//   Minimotor.Clock.every(1000, spawnWave);        // repeating; returns a canceler
//   Minimotor.Tween.to(text, { y: text.y - 30, alpha: 0 }, 450, Mathf.easeOut);

import { Loop } from "./engine.js";
import { linear } from "./mathf.js";

type Ease = (t: number) => number;

interface Timer {
  remaining: number;
  interval: number; // 0 = one-shot
  fn: () => void;
  dead: boolean;
}

interface TweenJob {
  target: Record<string, number>;
  from: Record<string, number>;
  delta: Record<string, number>;
  keys: string[];
  elapsed: number;
  duration: number;
  ease: Ease;
  onDone?: () => void;
  dead: boolean;
}

/** A running timer/tween; call to cancel early. */
export type Cancel = () => void;

/** Manages timers and tweens over a supplied millisecond clock. Pure — no Loop
 *  dependency — so it's testable by driving `advance(dt)` directly. */
export interface ClockManager {
  after(ms: number, fn: () => void): Cancel;
  every(ms: number, fn: () => void): Cancel;
  tween(
    target: Record<string, number>,
    to: Record<string, number>,
    ms: number,
    ease?: Ease,
    onDone?: () => void,
  ): Cancel;
  /** Advance every timer and tween by `dt` milliseconds. */
  advance(dt: number): void;
  /** Cancel everything. */
  clear(): void;
  /** Count of live timers + tweens (for tests/introspection). */
  readonly size: number;
}

export function createClock(): ClockManager {
  const timers = new Set<Timer>();
  const tweens = new Set<TweenJob>();

  return {
    after(ms, fn) {
      const t: Timer = { remaining: ms, interval: 0, fn, dead: false };
      timers.add(t);
      return () => {
        t.dead = true;
        timers.delete(t);
      };
    },

    every(ms, fn) {
      const t: Timer = { remaining: ms, interval: ms, fn, dead: false };
      timers.add(t);
      return () => {
        t.dead = true;
        timers.delete(t);
      };
    },

    tween(target, to, ms, ease = linear, onDone) {
      const keys = Object.keys(to);
      const from: Record<string, number> = {};
      const delta: Record<string, number> = {};
      for (const k of keys) {
        from[k] = target[k];
        delta[k] = to[k] - target[k];
      }
      const job: TweenJob = {
        target,
        from,
        delta,
        keys,
        elapsed: 0,
        duration: ms,
        ease,
        onDone,
        dead: false,
      };
      tweens.add(job);
      return () => {
        job.dead = true;
        tweens.delete(job);
      };
    },

    advance(dt) {
      // Timers. A repeating timer can fire multiple times in a big step; guard
      // against a zero interval turning into an infinite loop.
      for (const t of timers) {
        if (t.dead) continue;
        t.remaining -= dt;
        while (t.remaining <= 0 && !t.dead) {
          t.fn();
          if (t.interval > 0) t.remaining += t.interval;
          else {
            t.dead = true;
            timers.delete(t);
          }
        }
      }

      // Tweens.
      for (const job of tweens) {
        if (job.dead) continue;
        job.elapsed += dt;
        const raw = job.duration <= 0 ? 1 : Math.min(1, job.elapsed / job.duration);
        const e = job.ease(raw);
        for (const k of job.keys) job.target[k] = job.from[k] + job.delta[k] * e;
        if (raw >= 1) {
          job.dead = true;
          tweens.delete(job);
          job.onDone?.();
        }
      }
    },

    clear() {
      timers.clear();
      tweens.clear();
    },

    get size() {
      return timers.size + tweens.size;
    },
  };
}

// ---------- Default facades (driven by the default Loop's fixed step) ----------

let clock = createClock();
let wired = false;

function ensureWired(): void {
  if (wired) return;
  wired = true;
  Loop.onStep(() => clock.advance(Loop.step));
}

export const Clock = {
  /** Run `fn` once after `ms`. Returns a canceler. */
  after(ms: number, fn: () => void): Cancel {
    ensureWired();
    return clock.after(ms, fn);
  },
  /** Run `fn` every `ms`. Returns a canceler. */
  every(ms: number, fn: () => void): Cancel {
    ensureWired();
    return clock.every(ms, fn);
  },
  /** Reset all timers and Loop wiring — for tests. */
  _reset(): void {
    clock = createClock();
    wired = false;
  },
};

export const Tween = {
  /** Animate numeric fields of `target` toward `to` over `ms`, easing optional.
   *  Returns a canceler. */
  to(
    target: Record<string, number>,
    to: Record<string, number>,
    ms: number,
    ease?: Ease,
    onDone?: () => void,
  ): Cancel {
    ensureWired();
    return clock.tween(target, to, ms, ease, onDone);
  },
  /** Reset — for tests. Shares the clock with `Clock`, so this resets both. */
  _reset(): void {
    Clock._reset();
  },
};
