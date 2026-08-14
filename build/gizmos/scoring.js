// ---------- Scoring: the stateful members ----------
// `combo` is a decaying hit streak, clock-derived: it decays as `Clock.world`
// advances — no tick(), just `hit()` and read. `scoreTracker` carries a
// score/best pair and persists `best`. (The pure raters — timingGrade,
// scoreRank, beatClock — and `formatClock` stay in Goodies.scoring.)
import * as Storage from "../storage/local.js";
/** A decaying hit-streak multiplier — the arcade staple where landing hits in
 *  quick succession builds a bonus that fades if you stall. `hit()` on each
 *  success; read `count`/`multiplier`. Decays on its clock (default
 *  `Clock.world`, so it freezes on pause).
 *
 *    const combo = Gizmos.combo({ windowMs: 2000 });
 *    // on hit: combo.hit(); score += points * combo.multiplier; */
export function combo(options) {
    const windowMs = Math.max(1, options.windowMs ?? 2000);
    const step = options.step ?? 1;
    const cap = options.max ?? Infinity;
    const clock = options.clock;
    let count = 0;
    let lastHit = -Infinity;
    const lapsed = () => clock.now - lastHit >= windowMs;
    const live = () => (lapsed() ? 0 : count);
    return {
        hit() {
            count = live() + 1; // a hit after the window lapsed restarts at 1
            lastHit = clock.now;
        },
        reset() {
            count = 0;
            lastHit = -Infinity;
        },
        get count() {
            return live();
        },
        get multiplier() {
            return Math.min(cap, 1 + Math.max(0, live() - 1) * step);
        },
        get fraction() {
            return lapsed() ? 0 : Math.max(0, 1 - (clock.now - lastHit) / windowMs);
        },
        get active() {
            return live() > 0;
        },
    };
}
/** A score paired with a persistent best: `best` is loaded under `storageKey`
 *  now and re-saved whenever the score passes it. The default store is
 *  crash-safe, so private browsing or a full quota degrades to an in-memory
 *  best rather than throwing. Like every Gizmo it takes its collaborators
 *  directly, not the app — pass `store` to scope the key to a game or slot.
 *
 *    const scores = Gizmos.scoreTracker("snake_best");
 *    scores.add(10);   // score 10, best follows if exceeded */
export function scoreTracker(storageKey, store = Storage) {
    let _score = 0;
    let _best = store.load(storageKey, 0);
    return {
        get score() {
            return _score;
        },
        get best() {
            return _best;
        },
        add(points) {
            _score += points;
            if (_score > _best) {
                _best = _score;
                store.save(storageKey, _best);
            }
        },
        reset() {
            _score = 0;
        },
        save() {
            store.save(storageKey, _best);
        },
    };
}
