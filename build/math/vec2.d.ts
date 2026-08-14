import type { Rect } from "../engine/index.js";
export interface Vec2 {
    /** Horizontal component. */
    x: number;
    /** Vertical component. */
    y: number;
}
/** Keep the point inside a region — positional or structural Rect.
 *  Mutates `v` (the region args never allocate on the hot path). */
declare function clampRect(v: Vec2, x: number, y: number, w: number, h: number): Vec2;
declare function clampRect(v: Vec2, rect: Rect): Vec2;
/** Structural 2D vector math over anything with `x`/`y` (`add`, `sub`, `scale`,
 *  `len`, `dot`, `dist`, `angle`, `lerp`, …). Producers write into `out` when
 *  given, else mutate the first argument — hot paths stay allocation-free. */
export declare const Vec2: {
    /** Write components into `v` — the in-place counterpart of an `{x, y}`
     *  literal, for hot paths and for resetting a vector you already own
     *  (`Vec2.set(body.vel, 0, 0)`). There is deliberately no `Vec2.of`: an object
     *  literal already IS a Vec2, and is shorter than a call. */
    set(v: Vec2, x: number, y: number): Vec2;
    /** a ← b. Mutates the FIRST argument, like `add`/`sub`: the destination reads
     *  on the left, as in an assignment. */
    copy(a: Vec2, b: Vec2): Vec2;
    /** a + b, into `out` (default: mutates `a`). */
    add(a: Vec2, b: Vec2, out?: Vec2): Vec2;
    /** a - b, into `out` (default: mutates `a`). */
    sub(a: Vec2, b: Vec2, out?: Vec2): Vec2;
    /** v * s, into `out` (default: mutates `v`). */
    scale(v: Vec2, s: number, out?: Vec2): Vec2;
    /** a + b * s, into `out` (default: mutates `a`) — the integrate step:
     *  `Vec2.addScaled(pos, vel, 1)` or `Vec2.addScaled(pos, dir, SPEED)`. */
    addScaled(a: Vec2, b: Vec2, s: number, out?: Vec2): Vec2;
    /** Length (magnitude). */
    len(v: Vec2): number;
    /** Normalize to length 1, into `out` (default: mutates `v`). The zero
     *  vector stays zero. */
    norm(v: Vec2, out?: Vec2): Vec2;
    /** Dot product. */
    dot(a: Vec2, b: Vec2): number;
    /** Distance between two points. */
    dist(a: Vec2, b: Vec2): number;
    /** Interpolate a → b by t, into `out` (default: mutates `a`). */
    lerp(a: Vec2, b: Vec2, t: number, out?: Vec2): Vec2;
    /** Angle of the vector in radians (atan2(y, x)). */
    angle(v: Vec2): number;
    /** Rotate by `radians`, into `out` (default: mutates `v`). */
    rotate(v: Vec2, radians: number, out?: Vec2): Vec2;
    /** Component-wise clamp between `min` and `max`, into `out`
     *  (default: mutates `v`). */
    clamp(v: Vec2, min: Vec2, max: Vec2, out?: Vec2): Vec2;
    clampRect: typeof clampRect;
    /** Clamp the magnitude to `maxLen` without changing direction, into `out`
     *  (default: mutates `v`) — velocity caps. */
    limit(v: Vec2, maxLen: number, out?: Vec2): Vec2;
};
export {};
