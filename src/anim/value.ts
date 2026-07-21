// ---------- Composable value animations ----------
// A polled tween of a single number: build with `animate`, `tick(dtMs)` each
// step and read `value` — the same poll style as Timers/charges. Compose with
// `sequence` (one after another) and `parallel` (all at once). Unlike
// `Tween.to` this isn't tied to an object's fields or the Clock — it just
// produces a value you apply however you like (alpha, scale, a flash, a shake).

export interface Motion {
  /** Advance by `dtMs`. */
  tick(dtMs: number): void;
  /** Current animated value. */
  readonly value: number;
  /** True once finished (never while looping). */
  readonly done: boolean;
  /** Restart from the beginning. */
  reset(): void;
}

export interface AnimateOptions {
  /** Start value. Default 0. */
  from?: number;
  /** End value. Default 1. */
  to?: number;
  /** Duration in ms. */
  ms: number;
  /** Easing 0..1 → 0..1 (e.g. `Mathf.easeOut`). Default linear. */
  ease?: (t: number) => number;
  /** Wait this long (ms) before starting. Default 0. */
  delay?: number;
  /** Repeat forever. Default false. */
  loop?: boolean;
  /** Reverse each repeat (ping-pong); implies `loop`. Default false. */
  yoyo?: boolean;
}

/** A one-shot (or looping) tween from `from` to `to` over `ms`. */
export function animate(opts: AnimateOptions): Motion {
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;
  const dur = Math.max(1, opts.ms);
  const ease = opts.ease ?? ((t: number) => t);
  const delay = Math.max(0, opts.delay ?? 0);
  const yoyo = opts.yoyo ?? false;
  const loop = opts.loop || yoyo;
  let elapsed = 0;
  const at = (): number => {
    const e = elapsed - delay;
    if (e <= 0) return from;
    const t = e / dur;
    if (!loop) return from + (to - from) * ease(Math.min(1, t));
    const cycle = Math.floor(t);
    let p = t - cycle;
    if (yoyo && cycle % 2 === 1) p = 1 - p;
    return from + (to - from) * ease(p);
  };
  return {
    tick(dtMs) {
      elapsed += dtMs;
    },
    get value() {
      return at();
    },
    get done() {
      return !loop && elapsed - delay >= dur;
    },
    reset() {
      elapsed = 0;
    },
  };
}

/** Run motions one after another — `value` follows the active step, `done`
 *  when the last finishes. A stalled step's leftover time isn't carried into
 *  the next (one-step boundary error), which is imperceptible for UI/juice. */
export function sequence(steps: Motion[]): Motion {
  let i = 0;
  return {
    tick(dtMs) {
      if (i >= steps.length) return;
      steps[i].tick(dtMs);
      while (i < steps.length && steps[i].done) i++;
    },
    get value() {
      return steps.length ? steps[Math.min(i, steps.length - 1)].value : 0;
    },
    get done() {
      return i >= steps.length;
    },
    reset() {
      i = 0;
      for (const s of steps) s.reset();
    },
  };
}

/** A group of motions ticked together. `done` when all finish; read the
 *  individual `tracks` for their values (`value` returns the first track's). */
export interface Parallel extends Motion {
  readonly tracks: readonly Motion[];
}

export function parallel(tracks: Motion[]): Parallel {
  return {
    tick(dtMs) {
      for (const t of tracks) t.tick(dtMs);
    },
    get value() {
      return tracks.length ? tracks[0].value : 0;
    },
    get done() {
      return tracks.every((t) => t.done);
    },
    reset() {
      for (const t of tracks) t.reset();
    },
    get tracks() {
      return tracks;
    },
  };
}
