// ---------- 4×4 matrices ----------
// Column-major `Float32Array(16)`, the layout both WebGL2 (`uniformMatrix4fv`
// with `transpose = false`) and WebGPU expect. Element `(row, col)` lives at
// `m[col * 4 + row]`, so the translation column is `m[12..14]` — if you are
// reading a matrix in the debugger and the translation is at 3/7/11, you are
// looking at a row-major one from somewhere else.
//
// Convention is the one Vec2/Vec3/Quat use, and it is worth stating as a
// single rule because gl-matrix — the obvious reference for this file — uses
// the opposite one and the two are easy to confuse:
//
//   `out` is always the LAST parameter and always optional. A function with a
//   natural first operand mutates it when `out` is omitted (`Mat4.mul(a, b)`
//   is `a ← a · b`); a CONSTRUCTOR, which has no operand to mutate, allocates.
//
// Aliasing `out` with an input is always safe; every function reads what it
// needs before writing.
//
// Handedness matches `vec3.ts`: right-handed, +Y up, camera looks down −Z.
//
// Clip-space depth is a parameter, not an assumption. WebGL2 maps the near
// plane to z = −1, WebGPU to z = 0. `perspective`/`ortho` take a `zeroToOne`
// flag so one camera can feed either backend; the GPU device reports which it
// needs (`device.clipDepth`) rather than each call site guessing.

import type { Quat } from "./quat.js";
import type { Vec3 } from "./vec3.js";

/** A 4×4 matrix in column-major order — 16 floats, `(row, col)` at
 *  `m[col * 4 + row]`. */
export type Mat4 = Float32Array;

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4×4 matrix math, right-handed. `out` is the last parameter and
 *  optional throughout: `Mat4.mul(a, b)` writes into `a`, `Mat4.mul(a, b, out)`
 *  leaves both alone. Aliasing `out` with an input is safe. */
export const Mat4 = {
  /** A fresh identity matrix. */
  create(): Mat4 {
    return new Float32Array(IDENTITY);
  },
  /** Reset to identity, in place. */
  identity(m: Mat4): Mat4 {
    m.set(IDENTITY);
    return m;
  },
  /** a ← b. Mutates the FIRST argument, as in an assignment — the same shape
   *  as `Vec3.copy`. */
  copy(a: Mat4, b: Mat4): Mat4 {
    a.set(b);
    return a;
  },
  /** a · b. Reads as "apply `b`, then `a`": with `a` a view matrix and `b` a
   *  model matrix, the product takes model space to view space. */
  mul(a: Mat4, b: Mat4, out?: Mat4): Mat4 {
    const dst = out ?? a;
    const a00 = a[0],
      a01 = a[1],
      a02 = a[2],
      a03 = a[3];
    const a10 = a[4],
      a11 = a[5],
      a12 = a[6],
      a13 = a[7];
    const a20 = a[8],
      a21 = a[9],
      a22 = a[10],
      a23 = a[11];
    const a30 = a[12],
      a31 = a[13],
      a32 = a[14],
      a33 = a[15];
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4],
        b1 = b[c * 4 + 1],
        b2 = b[c * 4 + 2],
        b3 = b[c * 4 + 3];
      dst[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
      dst[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
      dst[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
      dst[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
    }
    return dst;
  },
  /** Transpose. */
  transpose(a: Mat4, out?: Mat4): Mat4 {
    const dst = out ?? a;
    const m = a === dst ? Float32Array.from(a) : a;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) dst[c * 4 + r] = m[r * 4 + c];
    }
    return dst;
  },
  /** Inverse, or `null` when the matrix is singular — returning null rather
   *  than silently producing NaNs, which are impossible to trace once they
   *  reach a vertex buffer. On failure `out` is left untouched. */
  invert(a: Mat4, out?: Mat4): Mat4 | null {
    const dst = out ?? a;
    const m00 = a[0],
      m01 = a[1],
      m02 = a[2],
      m03 = a[3];
    const m10 = a[4],
      m11 = a[5],
      m12 = a[6],
      m13 = a[7];
    const m20 = a[8],
      m21 = a[9],
      m22 = a[10],
      m23 = a[11];
    const m30 = a[12],
      m31 = a[13],
      m32 = a[14],
      m33 = a[15];

    const b00 = m00 * m11 - m01 * m10;
    const b01 = m00 * m12 - m02 * m10;
    const b02 = m00 * m13 - m03 * m10;
    const b03 = m01 * m12 - m02 * m11;
    const b04 = m01 * m13 - m03 * m11;
    const b05 = m02 * m13 - m03 * m12;
    const b06 = m20 * m31 - m21 * m30;
    const b07 = m20 * m32 - m22 * m30;
    const b08 = m20 * m33 - m23 * m30;
    const b09 = m21 * m32 - m22 * m31;
    const b10 = m21 * m33 - m23 * m31;
    const b11 = m22 * m33 - m23 * m32;

    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det === 0) return null;
    const d = 1 / det;

    dst[0] = (m11 * b11 - m12 * b10 + m13 * b09) * d;
    dst[1] = (m02 * b10 - m01 * b11 - m03 * b09) * d;
    dst[2] = (m31 * b05 - m32 * b04 + m33 * b03) * d;
    dst[3] = (m22 * b04 - m21 * b05 - m23 * b03) * d;
    dst[4] = (m12 * b08 - m10 * b11 - m13 * b07) * d;
    dst[5] = (m00 * b11 - m02 * b08 + m03 * b07) * d;
    dst[6] = (m32 * b02 - m30 * b05 - m33 * b01) * d;
    dst[7] = (m20 * b05 - m22 * b02 + m23 * b01) * d;
    dst[8] = (m10 * b10 - m11 * b08 + m13 * b06) * d;
    dst[9] = (m01 * b08 - m00 * b10 - m03 * b06) * d;
    dst[10] = (m30 * b04 - m31 * b02 + m33 * b00) * d;
    dst[11] = (m21 * b02 - m20 * b04 - m23 * b00) * d;
    dst[12] = (m11 * b07 - m10 * b09 - m12 * b06) * d;
    dst[13] = (m00 * b09 - m01 * b07 + m02 * b06) * d;
    dst[14] = (m31 * b01 - m30 * b03 - m32 * b00) * d;
    dst[15] = (m20 * b03 - m21 * b01 + m22 * b00) * d;
    return dst;
  },

  // ---------- Construction ----------

  /** A translation matrix. */
  fromTranslation(x: number, y: number, z: number, out?: Mat4): Mat4 {
    const dst = Mat4.identity(out ?? Mat4.create());
    dst[12] = x;
    dst[13] = y;
    dst[14] = z;
    return dst;
  },
  /** A scale matrix. */
  fromScale(x: number, y: number, z: number, out?: Mat4): Mat4 {
    const dst = Mat4.identity(out ?? Mat4.create());
    dst[0] = x;
    dst[5] = y;
    dst[10] = z;
    return dst;
  },
  /** A rotation matrix from a unit quaternion. */
  fromQuat(q: Quat, out?: Mat4): Mat4 {
    const dst = out ?? Mat4.create();
    const { x, y, z, w } = q;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2;
    const yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2;
    dst[0] = 1 - (yy + zz);
    dst[1] = xy + wz;
    dst[2] = xz - wy;
    dst[3] = 0;
    dst[4] = xy - wz;
    dst[5] = 1 - (xx + zz);
    dst[6] = yz + wx;
    dst[7] = 0;
    dst[8] = xz + wy;
    dst[9] = yz - wx;
    dst[10] = 1 - (xx + yy);
    dst[11] = 0;
    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;
    dst[15] = 1;
    return dst;
  },
  /** Translation ∘ rotation ∘ scale, built directly rather than by multiplying
   *  three matrices — this runs once per node per frame, so the shortcut is
   *  worth it. This is glTF's TRS order: scale first, then rotate, then move. */
  compose(position: Vec3, rotation: Quat, scale: Vec3, out?: Mat4): Mat4 {
    const dst = Mat4.fromQuat(rotation, out ?? Mat4.create());
    dst[0] *= scale.x;
    dst[1] *= scale.x;
    dst[2] *= scale.x;
    dst[4] *= scale.y;
    dst[5] *= scale.y;
    dst[6] *= scale.y;
    dst[8] *= scale.z;
    dst[9] *= scale.z;
    dst[10] *= scale.z;
    dst[12] = position.x;
    dst[13] = position.y;
    dst[14] = position.z;
    return dst;
  },

  // ---------- Camera ----------

  /** A right-handed perspective projection. `fovY` is the VERTICAL field of
   *  view in radians; `far` may be `Infinity` for an infinite far plane, which
   *  is well-conditioned and removes a clipping decision.
   *
   *  `zeroToOne` selects the clip-space depth range: `false` (default) is
   *  WebGL's −1…1, `true` is WebGPU's 0…1. Pass the value the device reports;
   *  getting it wrong renders either nothing or everything z-fighting. */
  perspective(
    fovY: number,
    aspect: number,
    near: number,
    far: number,
    zeroToOne = false,
    out?: Mat4,
  ): Mat4 {
    const dst = out ?? Mat4.create();
    const f = 1 / Math.tan(fovY / 2);
    dst.fill(0);
    dst[0] = f / aspect;
    dst[5] = f;
    dst[11] = -1;
    if (far === Infinity) {
      dst[10] = -1;
      dst[14] = zeroToOne ? -near : -2 * near;
    } else {
      const nf = 1 / (near - far);
      dst[10] = zeroToOne ? far * nf : (far + near) * nf;
      dst[14] = zeroToOne ? far * near * nf : 2 * far * near * nf;
    }
    return dst;
  },
  /** A right-handed orthographic projection. See `perspective` for
   *  `zeroToOne`. */
  ortho(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
    zeroToOne = false,
    out?: Mat4,
  ): Mat4 {
    const dst = out ?? Mat4.create();
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    dst.fill(0);
    dst[0] = -2 * lr;
    dst[5] = -2 * bt;
    dst[10] = zeroToOne ? nf : 2 * nf;
    dst[12] = (left + right) * lr;
    dst[13] = (top + bottom) * bt;
    dst[14] = zeroToOne ? near * nf : (far + near) * nf;
    dst[15] = 1;
    return dst;
  },
  /** A view matrix: the world seen from `eye`, looking at `at`, with `up`
   *  roughly upward. Degenerate input (eye at the target, or `up` parallel to
   *  the view direction) yields identity rather than NaN. */
  lookAt(eye: Vec3, at: Vec3, up: Vec3, out?: Mat4): Mat4 {
    const dst = out ?? Mat4.create();
    // Right-handed: the camera looks down its own −Z, so the basis Z axis
    // points BACK from the target toward the eye.
    let zx = eye.x - at.x,
      zy = eye.y - at.y,
      zz = eye.z - at.z;
    let l = Math.hypot(zx, zy, zz);
    if (l === 0) return Mat4.identity(dst);
    zx /= l;
    zy /= l;
    zz /= l;

    let xx = up.y * zz - up.z * zy;
    let xy = up.z * zx - up.x * zz;
    let xz = up.x * zy - up.y * zx;
    l = Math.hypot(xx, xy, xz);
    if (l === 0) return Mat4.identity(dst);
    xx /= l;
    xy /= l;
    xz /= l;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    dst[0] = xx;
    dst[1] = yx;
    dst[2] = zx;
    dst[3] = 0;
    dst[4] = xy;
    dst[5] = yy;
    dst[6] = zy;
    dst[7] = 0;
    dst[8] = xz;
    dst[9] = yz;
    dst[10] = zz;
    dst[11] = 0;
    dst[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    dst[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    dst[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
    dst[15] = 1;
    return dst;
  },

  // ---------- Applying ----------

  /** Transform a POINT (w = 1) and divide by the resulting w, so this works
   *  for a projection matrix as well as an affine one. Writes into `out`, or
   *  mutates `v`. */
  transformPoint<V extends Vec3>(m: Mat4, v: V, out?: V): V {
    const o = out ?? v;
    const { x, y, z } = v;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const iw = w === 0 ? 1 : 1 / w;
    o.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
    o.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
    o.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
    return o;
  },
  /** Transform a DIRECTION (w = 0) — the translation column is ignored, so a
   *  normal or a velocity keeps its meaning. Note that a non-uniform scale
   *  needs the inverse-transpose for normals; this is the plain form. */
  transformDirection<V extends Vec3>(m: Mat4, v: V, out?: V): V {
    const o = out ?? v;
    const { x, y, z } = v;
    o.x = m[0] * x + m[4] * y + m[8] * z;
    o.y = m[1] * x + m[5] * y + m[9] * z;
    o.z = m[2] * x + m[6] * y + m[10] * z;
    return o;
  },
  /** The 3×3 inverse-transpose of the upper-left block, written into a
   *  `Float32Array(9)` for a `mat3` uniform. This is what a normal must be
   *  transformed by when the model matrix has a non-uniform scale; with a
   *  uniform one it reduces to the rotation, and passing the model matrix
   *  directly would also work. Returns `null` if the matrix is singular. */
  normalMatrix(model: Mat4, out?: Float32Array): Float32Array | null {
    const dst = out ?? new Float32Array(9);
    const inv = Mat4.invert(model, scratch);
    if (!inv) return null;
    // Transposed while copying: element (r, c) of the result is (c, r) of inv.
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) dst[c * 3 + r] = inv[r * 4 + c];
    }
    return dst;
  },
  /** Component-wise equality within `epsilon` — for tests. */
  equals(a: Mat4, b: Mat4, epsilon = 1e-5): boolean {
    for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > epsilon) return false;
    return true;
  },
};

const scratch = Mat4.create();
