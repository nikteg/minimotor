// ---------- Structural 2D vector math ----------
// Anything with `x`/`y` IS a Vec2 — sprites, bodies, the pointer, input
// vectors, tile-map spawn points. Plain data (JSON-safe), functions over it,
// no classes.
//
// Convention: functions that produce a vector write into `out` when given,
// otherwise mutate their FIRST vector argument and return it — hot paths stay
// allocation-free (`Vec2.add(player, player.vel)` integrates in place).
// Scalar functions (`len`, `dot`, `dist`, `angle`) are pure.
function target(a, out) {
    return out ?? a;
}
function clampRect(v, xOrRect, y, w, h) {
    let rx, ry, rw, rh;
    if (typeof xOrRect === "number") {
        rx = xOrRect;
        ry = y;
        rw = w;
        rh = h;
    }
    else {
        rx = xOrRect.x;
        ry = xOrRect.y;
        rw = xOrRect.w;
        rh = xOrRect.h;
    }
    v.x = Math.min(Math.max(v.x, rx), rx + rw);
    v.y = Math.min(Math.max(v.y, ry), ry + rh);
    return v;
}
/** Structural 2D vector math over anything with `x`/`y` (`add`, `sub`, `scale`,
 *  `len`, `dot`, `dist`, `angle`, `lerp`, …). Producers write into `out` when
 *  given, else mutate the first argument — hot paths stay allocation-free. */
export const Vec2 = {
    /** Write components into `v` — the in-place counterpart of an `{x, y}`
     *  literal, for hot paths and for resetting a vector you already own
     *  (`Vec2.set(body.vel, 0, 0)`). There is deliberately no `Vec2.of`: an object
     *  literal already IS a Vec2, and is shorter than a call. */
    set(v, x, y) {
        v.x = x;
        v.y = y;
        return v;
    },
    /** a ← b. Mutates the FIRST argument, like `add`/`sub`: the destination reads
     *  on the left, as in an assignment. */
    copy(a, b) {
        a.x = b.x;
        a.y = b.y;
        return a;
    },
    /** a + b, into `out` (default: mutates `a`). */
    add(a, b, out) {
        const o = target(a, out);
        o.x = a.x + b.x;
        o.y = a.y + b.y;
        return o;
    },
    /** a - b, into `out` (default: mutates `a`). */
    sub(a, b, out) {
        const o = target(a, out);
        o.x = a.x - b.x;
        o.y = a.y - b.y;
        return o;
    },
    /** v * s, into `out` (default: mutates `v`). */
    scale(v, s, out) {
        const o = target(v, out);
        o.x = v.x * s;
        o.y = v.y * s;
        return o;
    },
    /** a + b * s, into `out` (default: mutates `a`) — the integrate step:
     *  `Vec2.addScaled(pos, vel, 1)` or `Vec2.addScaled(pos, dir, SPEED)`. */
    addScaled(a, b, s, out) {
        const o = target(a, out);
        o.x = a.x + b.x * s;
        o.y = a.y + b.y * s;
        return o;
    },
    /** Length (magnitude). */
    len(v) {
        return Math.hypot(v.x, v.y);
    },
    /** Normalize to length 1, into `out` (default: mutates `v`). The zero
     *  vector stays zero. */
    norm(v, out) {
        const o = target(v, out);
        const l = Math.hypot(v.x, v.y);
        const s = l > 0 ? 1 / l : 0;
        o.x = v.x * s;
        o.y = v.y * s;
        return o;
    },
    /** Dot product. */
    dot(a, b) {
        return a.x * b.x + a.y * b.y;
    },
    /** Distance between two points. */
    dist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    },
    /** Interpolate a → b by t, into `out` (default: mutates `a`). */
    lerp(a, b, t, out) {
        const o = target(a, out);
        o.x = a.x + (b.x - a.x) * t;
        o.y = a.y + (b.y - a.y) * t;
        return o;
    },
    /** Angle of the vector in radians (atan2(y, x)). */
    angle(v) {
        return Math.atan2(v.y, v.x);
    },
    /** Rotate by `radians`, into `out` (default: mutates `v`). */
    rotate(v, radians, out) {
        const o = target(v, out);
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        const x = v.x;
        o.x = x * c - v.y * s;
        o.y = x * s + v.y * c;
        return o;
    },
    /** Component-wise clamp between `min` and `max`, into `out`
     *  (default: mutates `v`). */
    clamp(v, min, max, out) {
        const o = target(v, out);
        o.x = Math.min(Math.max(v.x, min.x), max.x);
        o.y = Math.min(Math.max(v.y, min.y), max.y);
        return o;
    },
    clampRect,
    /** Clamp the magnitude to `maxLen` without changing direction, into `out`
     *  (default: mutates `v`) — velocity caps. */
    limit(v, maxLen, out) {
        const o = target(v, out);
        const l = Math.hypot(v.x, v.y);
        const s = l > maxLen && l > 0 ? maxLen / l : 1;
        o.x = v.x * s;
        o.y = v.y * s;
        return o;
    },
};
