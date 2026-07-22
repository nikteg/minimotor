// ---------- Timers ----------
// Polled timing latches: small pure state machines you tick each fixed step
// and read as booleans. Not platformer-specific — grace windows, buffered
// inputs and cooldowns recur in top-down, shmup and action games too. They
// hold only a countdown; the game owns what to do when they fire.
//
//   const coyote = Minimotor.Timers.window(100);   // grace after leaving ground
//   const jumpBuf = Minimotor.Timers.buffer(120);  // a press honored early
//   const dashCd = Minimotor.Timers.cooldown(500); // reusable-after-delay
//
//   // each fixed step (stepMs = Loop.step):
//   if (grounded) coyote.charge();
//   coyote.tick(stepMs); jumpBuf.tick(stepMs); dashCd.tick(stepMs);
//   if (Keys.pressed("Space")) jumpBuf.trigger();
//   if (coyote.active && jumpBuf.consume()) jump();
//   if (dashCd.ready() && dashInput) { dash(); dashCd.use(); }

/** A grace window: `active` for `ms` after the last `charge()`. Coyote time,
 *  "recently damaged" invulnerability, any "still counts for a moment" gate. */
export interface Window {
  /** Refill the window (call while the condition holds — e.g. grounded). */
  charge(): void;
  /** Count down by `dtMs`. */
  tick(dtMs: number): void;
  /** End the window now (e.g. after consuming the grace to act). */
  expire(): void;
  /** True while the window is open. */
  readonly active: boolean;
  /** Milliseconds left (0 when closed). */
  readonly remaining: number;
}

export function window(ms: number): Window {
  let remaining = 0;
  return {
    charge() {
      remaining = ms;
    },
    tick(dtMs) {
      if (remaining > 0) remaining = Math.max(0, remaining - dtMs);
    },
    expire() {
      remaining = 0;
    },
    get active() {
      return remaining > 0;
    },
    get remaining() {
      return remaining;
    },
  };
}

/** A buffered trigger: `trigger()` arms it for `ms`; the next `consume()`
 *  within the window returns true once and clears it. Jump/attack buffering —
 *  an input pressed slightly too early still fires when it becomes possible. */
export interface Buffer {
  /** Arm the buffer (call on the input edge). */
  trigger(): void;
  /** Count down by `dtMs`. */
  tick(dtMs: number): void;
  /** True + clears if armed within the window; false otherwise. */
  consume(): boolean;
  /** Armed right now (peek without consuming). */
  readonly armed: boolean;
}

export function buffer(ms: number): Buffer {
  let remaining = 0;
  return {
    trigger() {
      remaining = ms;
    },
    tick(dtMs) {
      if (remaining > 0) remaining = Math.max(0, remaining - dtMs);
    },
    consume() {
      if (remaining > 0) {
        remaining = 0;
        return true;
      }
      return false;
    },
    get armed() {
      return remaining > 0;
    },
  };
}

/** A cooldown gate: `ready()` once `ms` have elapsed since the last `use()`. */
export interface Cooldown {
  /** Start the cooldown (call when the action fires). */
  use(): void;
  /** Count down by `dtMs`. */
  tick(dtMs: number): void;
  /** True when the action may fire again. */
  ready(): boolean;
  /** Milliseconds until ready (0 when ready). */
  readonly remaining: number;
}

export function cooldown(ms: number): Cooldown {
  let remaining = 0;
  return {
    use() {
      remaining = ms;
    },
    tick(dtMs) {
      if (remaining > 0) remaining = Math.max(0, remaining - dtMs);
    },
    ready() {
      return remaining <= 0;
    },
    get remaining() {
      return remaining;
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
 *    if (gate.update(player.onGround, Keys.pressed("Space"), Loop.step)) {
 *      player.vy = JUMP_FORCE;
 *    } */
export function jumpGate(opts: JumpGateOptions = {}): JumpGate {
  const coyote = window(opts.coyoteMs ?? 100);
  const buf = buffer(opts.bufferMs ?? 120);
  const STEP = 1000 / 60; // one try() per fixed step — the step is the unit
  return {
    try(pressed, grounded) {
      if (grounded) coyote.charge();
      coyote.tick(STEP);
      buf.tick(STEP);
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
