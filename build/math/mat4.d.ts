import type { Quat } from "./quat.js";
import type { Vec3 } from "./vec3.js";
/** A 4×4 matrix in column-major order — 16 floats, `(row, col)` at
 *  `m[col * 4 + row]`. */
export type Mat4 = Float32Array;
/** Column-major 4×4 matrix math, right-handed. `out` is the last parameter and
 *  optional throughout: `Mat4.mul(a, b)` writes into `a`, `Mat4.mul(a, b, out)`
 *  leaves both alone. Aliasing `out` with an input is safe. */
export declare const Mat4: {
    /** A fresh identity matrix. */
    create(): Mat4;
    /** Reset to identity, in place. */
    identity(m: Mat4): Mat4;
    /** a ← b. Mutates the FIRST argument, as in an assignment — the same shape
     *  as `Vec3.copy`. */
    copy(a: Mat4, b: Mat4): Mat4;
    /** a · b. Reads as "apply `b`, then `a`": with `a` a view matrix and `b` a
     *  model matrix, the product takes model space to view space. */
    mul(a: Mat4, b: Mat4, out?: Mat4): Mat4;
    /** Transpose. */
    transpose(a: Mat4, out?: Mat4): Mat4;
    /** Inverse, or `null` when the matrix is singular — returning null rather
     *  than silently producing NaNs, which are impossible to trace once they
     *  reach a vertex buffer. On failure `out` is left untouched. */
    invert(a: Mat4, out?: Mat4): Mat4 | null;
    /** A translation matrix. */
    fromTranslation(x: number, y: number, z: number, out?: Mat4): Mat4;
    /** A scale matrix. */
    fromScale(x: number, y: number, z: number, out?: Mat4): Mat4;
    /** A rotation matrix from a unit quaternion. */
    fromQuat(q: Quat, out?: Mat4): Mat4;
    /** Translation ∘ rotation ∘ scale, built directly rather than by multiplying
     *  three matrices — this runs once per node per frame, so the shortcut is
     *  worth it. This is glTF's TRS order: scale first, then rotate, then move. */
    compose(position: Vec3, rotation: Quat, scale: Vec3, out?: Mat4): Mat4;
    /** A right-handed perspective projection. `fovY` is the VERTICAL field of
     *  view in radians; `far` may be `Infinity` for an infinite far plane, which
     *  is well-conditioned and removes a clipping decision.
     *
     *  `zeroToOne` selects the clip-space depth range: `false` (default) is
     *  WebGL's −1…1, `true` is WebGPU's 0…1. Pass the value the device reports;
     *  getting it wrong renders either nothing or everything z-fighting. */
    perspective(fovY: number, aspect: number, near: number, far: number, zeroToOne?: boolean, out?: Mat4): Mat4;
    /** A right-handed orthographic projection. See `perspective` for
     *  `zeroToOne`. */
    ortho(left: number, right: number, bottom: number, top: number, near: number, far: number, zeroToOne?: boolean, out?: Mat4): Mat4;
    /** A view matrix: the world seen from `eye`, looking at `at`, with `up`
     *  roughly upward. Degenerate input (eye at the target, or `up` parallel to
     *  the view direction) yields identity rather than NaN. */
    lookAt(eye: Vec3, at: Vec3, up: Vec3, out?: Mat4): Mat4;
    /** Transform a POINT (w = 1) and divide by the resulting w, so this works
     *  for a projection matrix as well as an affine one. Writes into `out`, or
     *  mutates `v`. */
    transformPoint<V extends Vec3>(m: Mat4, v: V, out?: V): V;
    /** Transform a DIRECTION (w = 0) — the translation column is ignored, so a
     *  normal or a velocity keeps its meaning. Note that a non-uniform scale
     *  needs the inverse-transpose for normals; this is the plain form. */
    transformDirection<V extends Vec3>(m: Mat4, v: V, out?: V): V;
    /** The 3×3 inverse-transpose of the upper-left block, written into a
     *  `Float32Array(9)` for a `mat3` uniform. This is what a normal must be
     *  transformed by when the model matrix has a non-uniform scale; with a
     *  uniform one it reduces to the rotation, and passing the model matrix
     *  directly would also work. Returns `null` if the matrix is singular. */
    normalMatrix(model: Mat4, out?: Float32Array): Float32Array | null;
    /** Component-wise equality within `epsilon` — for tests. */
    equals(a: Mat4, b: Mat4, epsilon?: number): boolean;
};
