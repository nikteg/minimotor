export interface Vec3 {
    /** Right. */
    x: number;
    /** Up. */
    y: number;
    /** Toward the viewer (the camera looks down -Z). */
    z: number;
}
/** Structural 3D vector math over anything with `x`/`y`/`z`. Producers write
 *  into `out` when given, else mutate the first argument — hot paths stay
 *  allocation-free. Right-handed, +Y up. */
export declare const Vec3: {
    /** Write components into `v` — the in-place counterpart of an `{x, y, z}`
     *  literal. As in Vec2 there is no `Vec3.of`: the literal already IS one. */
    set(v: Vec3, x: number, y: number, z: number): Vec3;
    /** a ← b. Mutates the FIRST argument, as in an assignment. */
    copy(a: Vec3, b: Vec3): Vec3;
    /** A fresh `{x, y, z}` — for the cold paths where a literal would be noise. */
    clone(a: Vec3): Vec3;
    /** a + b. */
    add(a: Vec3, b: Vec3, out?: Vec3): Vec3;
    /** a − b. */
    sub(a: Vec3, b: Vec3, out?: Vec3): Vec3;
    /** a × s (uniform), or component-wise when `s` is a Vec3. */
    scale(a: Vec3, s: number | Vec3, out?: Vec3): Vec3;
    /** a + b × s — the integrate step, without a temporary. */
    addScaled(a: Vec3, b: Vec3, s: number, out?: Vec3): Vec3;
    /** −a. */
    negate(a: Vec3, out?: Vec3): Vec3;
    /** Squared length — compare distances without the square root. */
    len2(a: Vec3): number;
    /** Length. */
    len(a: Vec3): number;
    /** Unit vector. A zero vector is left at zero rather than producing NaN —
     *  the caller almost never wants a NaN propagating into a matrix. */
    normalize(a: Vec3, out?: Vec3): Vec3;
    /** Dot product. */
    dot(a: Vec3, b: Vec3): number;
    /** Cross product, right-handed: `cross(X, Y) === Z`. Safe to alias `out`
     *  with either input — the components are read before any are written. */
    cross(a: Vec3, b: Vec3, out?: Vec3): Vec3;
    /** Distance between two points. */
    dist(a: Vec3, b: Vec3): number;
    /** Squared distance. */
    dist2(a: Vec3, b: Vec3): number;
    /** Linear interpolation, `t` unclamped. */
    lerp(a: Vec3, b: Vec3, t: number, out?: Vec3): Vec3;
    /** Component-wise minimum. */
    min(a: Vec3, b: Vec3, out?: Vec3): Vec3;
    /** Component-wise maximum. */
    max(a: Vec3, b: Vec3, out?: Vec3): Vec3;
    /** Exact equality within `epsilon` (default 1e-6) — for tests and for
     *  change detection, not for physics. */
    equals(a: Vec3, b: Vec3, epsilon?: number): boolean;
};
