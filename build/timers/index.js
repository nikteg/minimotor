// ---------- Timers ----------
// Polled timing latches read as booleans. They DERIVE from a clock
// (injected by `createTimers(app)`) — nothing to tick, nothing to register: you call
// the event method (`charge`/`trigger`/`use`) and read the state. A held clock
// (pause) freezes them; slow-mo stretches them. Not platformer-specific —
// grace windows, buffered inputs and cooldowns recur across genres.
//
//   const Timers = createTimers(app);
//   const coyote = Timers.window(100);   // grace after leaving ground
//   const jumpBuf = Timers.buffer(120);  // a press honored early
//   const dashCd = Timers.cooldown(500); // reusable-after-delay
//
//   // per step — no tick():
//   if (grounded) coyote.charge();
//   if (input.jump.pressed) jumpBuf.trigger();
//   if (coyote.active && jumpBuf.consume()) jump();
//   if (dashCd.ready() && dashInput) { dash(); dashCd.use(); }
/** Make a grace `Window` of `ms`, deriving from the explicit `clock`.
 *  Starts closed until the first `charge()`. */
export function window(ms, clock) {
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
/** Make a `Buffer` with a `ms` window, deriving from the explicit `clock`.
 * Starts disarmed until the first `trigger()`. */
export function buffer(ms, clock) {
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
/** Make a `Cooldown` of `ms`, deriving from the explicit `clock`.
 *  Starts `ready()` until the first `use()`. */
export function cooldown(ms, clock) {
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
/** The canonical forgiving-jump timing, composed from `window` (coyote time)
 *  and `buffer` (jump buffering): a jump still fires just after you run off a
 *  ledge, and a press landed just before touchdown isn't dropped. It decides
 *  *when* to jump; the jump velocity stays game policy.
 *
 *    const Timers = createTimers(app);
 *    const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 130 });
 *    if (gate.try(input.jump.pressed, player.grounded)) player.vel.y = JUMP; */
export function jumpGate(opts) {
    const clock = opts.clock;
    const coyote = window(opts.coyoteMs ?? 100, clock);
    const buf = buffer(opts.bufferMs ?? 120, clock);
    return {
        try(pressed, grounded) {
            if (grounded)
                coyote.charge();
            if (pressed)
                buf.trigger();
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
/** Timer helpers defaulting explicitly to one app's world clock. */
export function createTimers(app) {
    const clock = app.Clock.world;
    return {
        window: (ms, boundClock = clock) => window(ms, boundClock),
        buffer: (ms, boundClock = clock) => buffer(ms, boundClock),
        cooldown: (ms, boundClock = clock) => cooldown(ms, boundClock),
        jumpGate: ({ clock: boundClock = clock, ...options } = {}) => jumpGate({ ...options, clock: boundClock }),
    };
}
