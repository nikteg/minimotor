/** A unit quaternion: `(x, y, z)` is the rotation axis scaled by `sin(θ/2)`,
 *  `w` is `cos(θ/2)`. Identity is `(0, 0, 0, 1)`. */
export interface Quat {
    /** Axis x × sin(θ/2). */
    x: number;
    /** Axis y × sin(θ/2). */
    y: number;
    /** Axis z × sin(θ/2). */
    z: number;
    /** cos(θ/2). */
    w: number;
}
/** Rotation quaternions over anything with `x`/`y`/`z`/`w`. Right-handed, and
 *  composition reads like matrices: `mul(a, b)` applies `b` first, then `a`. */
export declare const Quat: {
    /** The no-rotation quaternion `(0, 0, 0, 1)`. */
    identity(q: Quat): Quat;
    /** A fresh identity quaternion. */
    create(): Quat;
    /** Write all four components. */
    set(q: Quat, x: number, y: number, z: number, w: number): Quat;
    /** a ← b. */
    copy(a: Quat, b: Quat): Quat;
    /** A rotation of `angle` radians about `axis`. The axis is normalized here,
     *  so callers may pass an unnormalized direction. */
    fromAxisAngle(q: Quat, ax: number, ay: number, az: number, angle: number): Quat;
    /** Euler angles in radians, applied YXZ (yaw, then pitch, then roll) — the
     *  order a camera or a turret wants, and the one that keeps `yaw` horizontal
     *  regardless of pitch. */
    fromEuler(q: Quat, pitch: number, yaw: number, roll: number): Quat;
    /** a ∘ b — apply `b` first, then `a`, matching matrix multiplication order.
     *  Safe to alias `out` with either input. */
    mul(a: Quat, b: Quat, out?: Quat): Quat;
    /** The inverse rotation. Assumes a unit quaternion (the conjugate), which
     *  every quaternion produced by this module is. */
    invert(a: Quat, out?: Quat): Quat;
    /** Renormalize. Repeated `mul` drifts off the unit sphere; call this after a
     *  long chain of incremental rotations. */
    normalize(a: Quat, out?: Quat): Quat;
    /** Dot product — the cosine of half the angle between two orientations. */
    dot(a: Quat, b: Quat): number;
    /** Spherical interpolation along the SHORTEST arc, at a constant angular
     *  rate. `t` is unclamped. Falls back to a normalized lerp when the two
     *  orientations are nearly identical, where the trigonometric form loses
     *  precision. */
    slerp(a: Quat, b: Quat, t: number, out?: Quat): Quat;
    /** Rotate a point/direction by this quaternion, in place or into `out`. */
    rotateVec3<V extends {
        x: number;
        y: number;
        z: number;
    }>(q: Quat, v: V, out?: V): V;
    /** Equality within `epsilon`, treating `q` and `−q` as equal — they are the
     *  same rotation, and a slerp or a keyframe may hand you either. */
    equals(a: Quat, b: Quat, epsilon?: number): boolean;
};
