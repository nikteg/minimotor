// ---------- Checkpoints & charge pools ----------
// The stateful members of the pacing family: an ordered checkpoint/lap tracker
// and a regenerating charge meter. (The pure curves — waveScale, dayCycle —
// stay in Goodies.pacing.)
import { clamp } from "../math/mathf.js";
/** Ordered checkpoint/lap tracker for racing, tours and multi-step objectives. */
export function checkpointRoute(checkpoints) {
    if (!Number.isInteger(checkpoints) || checkpoints < 1) {
        throw new RangeError("Gizmos.checkpointRoute: checkpoints must be a positive integer");
    }
    let next = 0;
    let lap = 0;
    return {
        get next() {
            return next;
        },
        get lap() {
            return lap;
        },
        visit(index) {
            if (index !== next)
                return false;
            next++;
            if (next === checkpoints) {
                next = 0;
                lap++;
            }
            return true;
        },
        reset() {
            next = 0;
            lap = 0;
        },
    };
}
/** A pool of charges that regenerates over time — dashes, an ability meter,
 *  regenerating ammo, hyperspace jumps. `use()` spends, regen adds one charge
 *  every `refillMs` (derived from the clock — no tick), and `refill()` tops it
 *  off instantly (e.g. on landing). `fraction` drives a recharge bar. Regen
 *  freezes when its clock is held.
 *
 *    const dash = Gizmos.charges({ max: 1, refillMs: 0 }); // ground-only
 *    if (onGround) dash.refill();
 *    if (pressDash && dash.use()) doDash(); */
export function charges(options) {
    const max = Math.max(0, Math.floor(options.max));
    const refillMs = Math.max(1, options.refillMs);
    const clock = options.clock;
    let count = clamp(Math.floor(options.start ?? max), 0, max);
    let accrueSince = clock.now; // when the current partial charge began
    // Lazy fold: bank whole charges accrued since `accrueSince`, on every read
    // or mutation. At full, the accrual clock parks at "now".
    const settle = () => {
        if (count >= max) {
            accrueSince = clock.now;
            return;
        }
        const gained = Math.floor((clock.now - accrueSince) / refillMs);
        if (gained > 0) {
            count = Math.min(max, count + gained);
            accrueSince += gained * refillMs;
            if (count >= max)
                accrueSince = clock.now;
        }
    };
    return {
        get count() {
            settle();
            return count;
        },
        get max() {
            return max;
        },
        get fraction() {
            settle();
            return count >= max ? 1 : (clock.now - accrueSince) / refillMs;
        },
        use(n = 1) {
            settle();
            if (n <= 0)
                return true;
            if (count >= n) {
                const wasFull = count >= max;
                count -= n;
                if (wasFull)
                    accrueSince = clock.now; // spend restarts the regen timer
                return true;
            }
            return false;
        },
        refill() {
            count = max;
            accrueSince = clock.now;
        },
        add(n = 1) {
            settle();
            count = clamp(count + Math.floor(n), 0, max);
            if (count >= max)
                accrueSince = clock.now;
        },
    };
}
