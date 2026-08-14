import { lerp } from "../math/mathf.js";
/** Create a network throughput meter. Rates are exponentially smoothed so the
 *  HUD reads steadily rather than flickering frame-to-frame. */
export function createNetMeter() {
    let mUp = 0;
    let bUp = 0;
    let mDown = 0;
    let bDown = 0;
    // Snapshot at the previous sample, to diff against.
    let lastT = 0;
    let lmUp = 0;
    let lbUp = 0;
    let lmDown = 0;
    let lbDown = 0;
    let stats = { upMsgs: 0, downMsgs: 0, upBps: 0, downBps: 0 };
    return {
        sent(bytes = 0) {
            mUp++;
            bUp += bytes;
        },
        recv(bytes = 0) {
            mDown++;
            bDown += bytes;
        },
        sample(nowMs) {
            if (lastT === 0) {
                lastT = nowMs;
                return stats;
            }
            const dt = nowMs - lastT;
            if (dt <= 0)
                return stats;
            const perSec = (d) => (d / dt) * 1000;
            const k = 0.2; // smoothing toward the latest instantaneous rate
            // Exponential smoothing never reaches zero on its own — snap the tail so
            // idle links read (and graph) as exactly 0 instead of a noise floor.
            const smooth = (prev, next, eps) => {
                const v = lerp(prev, next, k);
                return v < eps ? 0 : v;
            };
            stats = {
                upMsgs: smooth(stats.upMsgs, perSec(mUp - lmUp), 0.01),
                downMsgs: smooth(stats.downMsgs, perSec(mDown - lmDown), 0.01),
                upBps: smooth(stats.upBps, perSec(bUp - lbUp), 1),
                downBps: smooth(stats.downBps, perSec(bDown - lbDown), 1),
            };
            lastT = nowMs;
            lmUp = mUp;
            lbUp = bUp;
            lmDown = mDown;
            lbDown = bDown;
            return stats;
        },
    };
}
