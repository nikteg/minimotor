// ---------- Swept per-widget caches ----------
// Immediate-mode widgets persist small bits of state across frames (auto-size
// measurements, scroll offsets, open flags) in maps keyed by widget id — with
// position-derived fallback keys for widgets that have none. Those maps must
// not grow forever: a container animating its position mints a new key every
// frame. A SweptCache stamps each entry with the frame it was last touched and
// drops entries that go unseen for STALE_FRAMES (the kernel bumps the tick and
// sweeps from its per-app frame-end housekeeping — see lifecycle.ts).
// Storage is per app, so two apps' widgets can't collide on ids.
import { uiSlot } from "./state.js";
/** Entries untouched for this many frames are dropped (~10 s at 60 fps). */
const STALE_FRAMES = 600;
/** Sweep no more than once per this many frames — the sweep is O(entries). */
const SWEEP_EVERY = 120;
const state = uiSlot(() => ({ tick: 0, lastSweep: 0, maps: [] }));
/** The current app's frame counter, as the sweeper bumps it.
 *
 *  For widgets whose state is "was I drawn on the PREVIOUS frame" rather than
 *  "have I been drawn lately". A `sweptCache` entry survives `STALE_FRAMES`
 *  after its widget stops being drawn — that is what makes it a cache and not
 *  a leak — so a bare presence check answers "within the last ten seconds",
 *  which is the wrong question for anything that toggles. Store this alongside
 *  the value and compare. */
export function uiFrameTick() {
    return state().tick;
}
let nextCache = 0;
/** Create a swept cache. Module-scope only — the callsite's slot is permanent. */
export function sweptCache() {
    const idx = nextCache++;
    const mapOf = () => {
        var _a;
        const s = state();
        return ((_a = s.maps)[idx] ?? (_a[idx] = new Map()));
    };
    return {
        get(key) {
            const e = mapOf().get(key);
            if (!e)
                return undefined;
            e.seen = state().tick;
            return e.v;
        },
        set(key, value) {
            const map = mapOf();
            const e = map.get(key);
            if (e) {
                e.v = value;
                e.seen = state().tick;
            }
            else {
                map.set(key, { v: value, seen: state().tick });
            }
        },
        delete(key) {
            mapOf().delete(key);
        },
        clear() {
            mapOf().clear();
        },
    };
}
/** Advance the current app's frame tick and periodically drop its stale
 *  entries — called from the kernel's per-app frame-end housekeeping. */
export function sweepCaches() {
    const s = state();
    s.tick++;
    if (s.tick - s.lastSweep < SWEEP_EVERY)
        return;
    s.lastSweep = s.tick;
    for (const map of s.maps) {
        if (!map)
            continue;
        for (const [key, e] of map) {
            if (s.tick - e.seen > STALE_FRAMES)
                map.delete(key);
        }
    }
}
