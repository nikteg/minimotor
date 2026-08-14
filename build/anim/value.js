// ---------- Value animations (pull-derived) ----------
// A Motion derives its value from a clock AT READ TIME — nothing ticks,
// nothing registers, dropping the reference is the teardown. Holding or
// scaling the clock bends every motion on it for free: pause freeze,
// slow-mo, hit-stop. Finished motions hold their end value, so the
// replace-on-edge pattern needs no cleanup:
//
//   let squash = Anim.animate({ from: 1, to: 1, ms: 0 });
//   if (landed) squash = Anim.animate({ from: 0.6, to: 1, ms: 150, ease: easeOut });
//   Draw.sprite(anim, player, { scaleY: squash.value });
/** A one-shot (or looping) tween from `from` to `to` over `ms`. */
export function animate(opts) {
    const clock = opts.clock;
    const from = opts.from ?? 0;
    const to = opts.to ?? 1;
    const dur = Math.max(1, opts.ms);
    const ease = opts.ease ?? ((t) => t);
    const delay = Math.max(0, opts.delay ?? 0);
    const yoyo = opts.yoyo ?? false;
    const loop = opts.loop || yoyo;
    let start = clock.now;
    const at = () => {
        const e = clock.now - start - delay;
        if (e <= 0)
            return from;
        const t = e / dur;
        if (!loop)
            return from + (to - from) * ease(Math.min(1, t));
        const cycle = Math.floor(t);
        let p = t - cycle;
        if (yoyo && cycle % 2 === 1)
            p = 1 - p;
        return from + (to - from) * ease(p);
    };
    return {
        get value() {
            return at();
        },
        get done() {
            return !loop && clock.now - start - delay >= dur;
        },
        reset() {
            start = clock.now;
        },
    };
}
/** Play steps one after another on a single derived timeline. `value`
 *  follows the active step; `done` when the last finishes. */
export function sequence(steps, opts) {
    const clock = opts.clock;
    const segs = steps.map((s) => ({
        from: s.from ?? 0,
        to: s.to ?? 1,
        dur: Math.max(1, s.ms),
        delay: Math.max(0, s.delay ?? 0),
        ease: s.ease ?? ((t) => t),
    }));
    const total = segs.reduce((sum, s) => sum + s.delay + s.dur, 0);
    let start = clock.now;
    const at = () => {
        let e = clock.now - start;
        if (opts.loop && total > 0)
            e = ((e % total) + total) % total;
        for (const s of segs) {
            if (e < s.delay)
                return s.from;
            if (e < s.delay + s.dur)
                return s.from + (s.to - s.from) * s.ease((e - s.delay) / s.dur);
            e -= s.delay + s.dur;
        }
        return segs.length > 0 ? segs[segs.length - 1].to : 0;
    };
    return {
        get value() {
            return at();
        },
        get done() {
            return !opts.loop && clock.now - start >= total;
        },
        reset() {
            start = clock.now;
        },
    };
}
/** Start a group of `animate` motions together on one clock. `done` when every
 *  track finishes; `value` returns the first track's — read `tracks` for the
 *  rest. Per-spec clocks are ignored (the group owns the clock). */
export function parallel(specs, opts) {
    const clock = opts.clock;
    const tracks = specs.map((s) => animate({ ...s, clock }));
    return {
        get value() {
            return tracks.length > 0 ? tracks[0].value : 0;
        },
        get done() {
            // Plain loop — no per-read `.every()` closure.
            for (let i = 0; i < tracks.length; i++)
                if (!tracks[i].done)
                    return false;
            return true;
        },
        reset() {
            for (const t of tracks)
                t.reset();
        },
        get tracks() {
            return tracks;
        },
    };
}
