// ---------- Timers ----------
// Polled timing latches read as booleans. They DERIVE from a clock
// (`Clock.game` by default) — nothing to tick, nothing to register: you call
// the event method (`charge`/`trigger`/`use`) and read the state. A held clock
// (pause) freezes them; slow-mo stretches them. Not platformer-specific —
// grace windows, buffered inputs and cooldowns recur across genres.
//
//   const coyote = Minimotor.Timers.window(100);   // grace after leaving ground
//   const jumpBuf = Minimotor.Timers.buffer(120);  // a press honored early
//   const dashCd = Minimotor.Timers.cooldown(500); // reusable-after-delay
//
//   // per step — no tick():
//   if (grounded) coyote.charge();
//   if (input.jump.pressed) jumpBuf.trigger();
//   if (coyote.active && jumpBuf.consume()) jump();
//   if (dashCd.ready() && dashInput) { dash(); dashCd.use(); }

import { Clock, type ClockHandle } from "./clock.js";

/** A grace window: `active` for `ms` after the last `charge()`. Coyote time,
 *  "recently damaged" invulnerability, any "still counts for a moment" gate. */
export interface Window {
  /** Refill the window (call while the condition holds — e.g. grounded). */
  charge(): void;
  /** End the window now (e.g. after consuming the grace to act). */
  expire(): void;
  /** True while the window is open. */
  readonly active: boolean;
  /** Milliseconds left (0 when closed). */
  readonly remaining: number;
}

export function window(ms: number, clock: ClockHandle = Clock.game): Window {
  let until = -Infinity;
  return {
    charge() {
      until = clock.now + ms;
    },
    expire() {
      until = -Infinity;
    },
    get active() {
      return clock.now < until;
    },
    get remaining() {
      return Math.max(0, until - clock.now);
    },
  };
}

/** A buffered trigger: `trigger()` arms it for `ms`; the next `consume()`
 *  within the window returns true once and clears it. Jump/attack buffering —
 *  an input pressed slightly too early still fires when it becomes possible. */
export interface Buffer {
  /** Arm the buffer (call on the input edge). */
  trigger(): void;
  /** True + clears if armed within the window; false otherwise. */
  consume(): boolean;
  /** Armed right now (peek without consuming). */
  readonly armed: boolean;
}

export function buffer(ms: number, clock: ClockHandle = Clock.game): Buffer {
  let until = -Infinity;
  return {
    trigger() {
      until = clock.now + ms;
    },
    consume() {
      if (clock.now < until) {
        until = -Infinity;
        return true;
      }
      return false;
    },
    get armed() {
      return clock.now < until;
    },
  };
}

/** A cooldown gate: `ready()` once `ms` have elapsed since the last `use()`. */
export interface Cooldown {
  /** Start the cooldown (call when the action fires). */
  use(): void;
  /** True when the action may fire again. */
  ready(): boolean;
  /** Milliseconds until ready (0 when ready). */
  readonly remaining: number;
}

export function cooldown(ms: number, clock: ClockHandle = Clock.game): Cooldown {
  let readyAt = -Infinity;
  return {
    use() {
      readyAt = clock.now + ms;
    },
    ready() {
      return clock.now >= readyAt;
    },
    get remaining() {
      return Math.max(0, readyAt - clock.now);
    },
  };
}

// ---------- Composed: forgiving jump gate ----------

/** Options for `jumpGate`. */
export interface JumpGateOptions {
  /** Coyote grace after leaving the ground, in ms. Default 100. */
  coyoteMs?: number;
  /** Input buffer before landing, in ms. Default 120. */
  bufferMs?: number;
  /** Clock the grace/buffer derive from. Default `Clock.game`. */
  clock?: ClockHandle;
}

/** One `try` per step deciding when a jump fires. */
export interface JumpGate {
  /** Call once per step with this step's jump-press edge and grounded fact.
   *  True on the step the jump should fire (press buffering + coyote grace
   *  folded in) — the jump velocity stays game policy. */
  try(pressed: boolean, grounded: boolean): boolean;
  /** The underlying latches, exposed for HUD/debug or extra rules. */
  readonly coyote: Window;
  readonly buffer: Buffer;
}

/** The canonical forgiving-jump timing, composed from `window` (coyote time)
 *  and `buffer` (jump buffering): a jump still fires just after you run off a
 *  ledge, and a press landed just before touchdown isn't dropped. It decides
 *  *when* to jump; the jump velocity stays game policy.
 *
 *    const gate = Minimotor.Timers.jumpGate({ coyoteMs: 100, bufferMs: 130 });
 *    if (gate.try(input.jump.pressed, player.grounded)) player.vel.y = JUMP; */
export function jumpGate(opts: JumpGateOptions = {}): JumpGate {
  const clock = opts.clock ?? Clock.game;
  const coyote = window(opts.coyoteMs ?? 100, clock);
  const buf = buffer(opts.bufferMs ?? 120, clock);
  return {
    try(pressed, grounded) {
      if (grounded) coyote.charge();
      if (pressed) buf.trigger();
      if (coyote.active && buf.consume()) {
        coyote.expire(); // one jump per takeoff — no lingering-coyote double
        return true;
      }
      return false;
    },
    coyote,
    buffer: buf,
  };
}
