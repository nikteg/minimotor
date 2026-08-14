// ---------- Snapshot interpolation ----------
// Remote entities look best rendered a little in the past, blended between two
// *known* states, instead of teleporting to whatever the latest packet said.
// Buffer incoming snapshots with `push`, then `sample()` each frame to get the
// state as of (now − delayMs):
//
//   const remote = Net.createInterpolator<{ x: number; y: number }>();
//   transport.onMessage = (data) => remote.push(decode(data));
//   // in draw():
//   const s = remote.sample();
//   if (s) drawPlayer(s.x, s.y);
//
// Pass the SENDER's timestamp as `push(state, arrivedAt, sentAt)` whenever the
// protocol carries one (`Net.sync` always does). Arrival times measure the
// network; sender timestamps measure the simulation, and only the latter tells
// you how much motion a pair of snapshots actually represents. Placing
// snapshots on the local timeline by arrival makes two packets that left 16 ms
// apart but landed 1 ms apart look like 1 ms of motion, which the blend then
// scales back up — the classic "remote players jitter and rubber-band" bug.
import { lerp } from "../math/mathf.js";
/** How far past the newest snapshot pair the projection may reach, as a
 *  multiple of the pair's own span. Bounds the overshoot when a gap is much
 *  wider than the snapshot interval. */
const MAX_PROJECTION = 2.5;
/** Per-sample weight for following genuine sender/receiver clock drift, once
 *  the fastest observed packet has set the baseline offset. */
const DRIFT = 0.002;
function defaultLerp(a, b, t) {
    if (typeof a === "number" && typeof b === "number") {
        return lerp(a, b, t);
    }
    const out = { ...b };
    const from = a;
    for (const k in from) {
        const av = from[k];
        const bv = out[k];
        if (typeof av === "number" && typeof bv === "number")
            out[k] = lerp(av, bv, t);
    }
    return out;
}
/** Create a snapshot interpolator for a remote entity: `push` incoming states,
 *  `sample()` each frame to read the blended state as of (now − `delayMs`). The
 *  default `lerp` blends numeric fields and copies the rest; see
 *  `InterpolatorOptions` to tune `delayMs`/`maxSnapshots`/`lerp`. */
export function createInterpolator(opts = {}) {
    const fixedDelay = typeof opts.delayMs === "number" ? Math.max(0, opts.delayMs) : null;
    const adaptive = opts.delayMs === "auto";
    const initialInterval = Math.max(1, opts.expectedIntervalMs ?? 50);
    const maxExtrapolation = Math.max(0, opts.maxExtrapolationMs ?? 0);
    const projects = !!opts.extrapolate && maxExtrapolation > 0;
    const max = opts.maxSnapshots ?? 32;
    const now = opts.now ?? (() => performance.now());
    const blend = opts.lerp ?? (defaultLerp);
    let interval = initialInterval;
    let jitter = 0;
    // Local-clock → sender-clock mapping. The FASTEST packet observed carries the
    // least queueing delay, so it is the best estimate of the true offset; slower
    // ones only pull it back at `DRIFT` so real clock drift is still followed.
    // Snapshots are BUFFERED IN SENDER UNITS and the render target is converted
    // into them at sample time, so improving the estimate slides the whole
    // timeline at once instead of leaving old snapshots mapped by a stale offset.
    let clockOffset = 0;
    let stamped = false;
    const times = [];
    const states = [];
    const delay = () => fixedDelay ?? (adaptive ? Math.min(250, interval + jitter * 2) : 100);
    return {
        push(state, atMs = now(), sentAt) {
            if (sentAt !== undefined) {
                const offset = atMs - sentAt;
                if (!stamped || offset < clockOffset)
                    clockOffset = offset;
                else
                    clockOffset += (offset - clockOffset) * DRIFT;
                // Jitter is how far this packet ran behind the fastest path — the
                // depth the buffer has to cover.
                if (adaptive && stamped)
                    jitter += (Math.abs(offset - clockOffset) - jitter) * 0.1;
                stamped = true;
            }
            else if (stamped) {
                // Mixed sender: place it on the same timeline as its stamped siblings.
                sentAt = atMs - clockOffset;
            }
            // A monotonic sender stamp IS the sequence number: anything at or before
            // the newest one is a duplicate or a reordered straggler. Without stamps,
            // arrival order says the same thing about a late packet.
            const time = sentAt ?? atMs;
            if (times.length && time <= times[times.length - 1])
                return;
            // The interval is the sender's own cadence when stamps are available, and
            // only then; arrival gaps measure the network, not the simulation.
            if (adaptive && times.length) {
                const gap = time - times[times.length - 1];
                jitter = stamped ? jitter : jitter + (Math.abs(gap - interval) - jitter) * 0.1;
                interval += (gap - interval) * 0.1;
            }
            times.push(time);
            states.push(state);
            if (times.length > max) {
                times.shift();
                states.shift();
            }
        },
        sample(atMs = now()) {
            const last = times.length - 1;
            if (last < 0)
                return null;
            // Into the buffer's units: sender time when stamps are in play.
            const target = atMs - delay() - clockOffset;
            if (target <= times[0])
                return states[0];
            if (target >= times[last]) {
                if (!projects || last === 0)
                    return states[last];
                // Floor the span: a pair that arrived closer together than the sender
                // could have produced it would otherwise divide the projection into a
                // wild overshoot. Cap the result for the same reason.
                const span = Math.max(times[last] - times[last - 1], interval * 0.5, 1);
                const ahead = Math.min(target - times[last], maxExtrapolation);
                const t = Math.min(1 + ahead / span, MAX_PROJECTION);
                return opts.extrapolate(states[last - 1], states[last], t);
            }
            // The target sits near the tail — scan back from the end.
            let i = last;
            while (times[i - 1] > target)
                i--;
            const t = (target - times[i - 1]) / (times[i] - times[i - 1]);
            return blend(states[i - 1], states[i], t);
        },
        get size() {
            return times.length;
        },
        get delayMs() {
            return delay();
        },
        get jitterMs() {
            return jitter;
        },
        clear() {
            times.length = 0;
            states.length = 0;
            interval = initialInterval;
            jitter = 0;
            // The clock mapping is re-learned from the very next stamped snapshot,
            // so there is nothing worth carrying across a teleport.
            stamped = false;
            clockOffset = 0;
        },
    };
}
