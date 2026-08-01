// ---------- Rotation quaternions ----------
// Structural, like Vec2/Vec3: a Quat is anything with `x`/`y`/`z`/`w`, plain
// data, JSON-safe. Same producer convention — write into `out` when given,
// otherwise mutate the first argument.
//
// Why a quaternion and not Euler angles: animation interpolates rotations, and
// Euler angles interpolate badly (gimbal lock, and the path between two
// orientations depends on the axis order). `slerp` takes the shortest arc
// between two orientations at a constant rate, which is what a keyframed
// rotation track needs and what glTF stores.
//
// Identity is `(0, 0, 0, 1)` — NOT all-zero. A zeroed object is not a rotation,
// so `Quat.identity(q)` rather than `{}` when you need a starting value.

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

function target(a: Quat, out?: Quat): Quat {
  return out ?? a;
}

/** Rotation quaternions over anything with `x`/`y`/`z`/`w`. Right-handed, and
 *  composition reads like matrices: `mul(a, b)` applies `b` first, then `a`. */
export const Quat = {
  /** The no-rotation quaternion `(0, 0, 0, 1)`. */
  identity(q: Quat): Quat {
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
    return q;
  },
  /** A fresh identity quaternion. */
  create(): Quat {
    return { x: 0, y: 0, z: 0, w: 1 };
  },
  /** Write all four components. */
  set(q: Quat, x: number, y: number, z: number, w: number): Quat {
    q.x = x;
    q.y = y;
    q.z = z;
    q.w = w;
    return q;
  },
  /** a ← b. */
  copy(a: Quat, b: Quat): Quat {
    a.x = b.x;
    a.y = b.y;
    a.z = b.z;
    a.w = b.w;
    return a;
  },
  /** A rotation of `angle` radians about `axis`. The axis is normalized here,
   *  so callers may pass an unnormalized direction. */
  fromAxisAngle(q: Quat, ax: number, ay: number, az: number, angle: number): Quat {
    const l = Math.hypot(ax, ay, az);
    if (l === 0) return Quat.identity(q);
    const s = Math.sin(angle / 2) / l;
    q.x = ax * s;
    q.y = ay * s;
    q.z = az * s;
    q.w = Math.cos(angle / 2);
    return q;
  },
  /** Euler angles in radians, applied YXZ (yaw, then pitch, then roll) — the
   *  order a camera or a turret wants, and the one that keeps `yaw` horizontal
   *  regardless of pitch. */
  fromEuler(q: Quat, pitch: number, yaw: number, roll: number): Quat {
    const cx = Math.cos(pitch / 2),
      sx = Math.sin(pitch / 2);
    const cy = Math.cos(yaw / 2),
      sy = Math.sin(yaw / 2);
    const cz = Math.cos(roll / 2),
      sz = Math.sin(roll / 2);
    q.x = sx * cy * cz + cx * sy * sz;
    q.y = cx * sy * cz - sx * cy * sz;
    q.z = cx * cy * sz - sx * sy * cz;
    q.w = cx * cy * cz + sx * sy * sz;
    return q;
  },
  /** a ∘ b — apply `b` first, then `a`, matching matrix multiplication order.
   *  Safe to alias `out` with either input. */
  mul(a: Quat, b: Quat, out?: Quat): Quat {
    const o = target(a, out);
    const ax = a.x,
      ay = a.y,
      az = a.z,
      aw = a.w;
    const bx = b.x,
      by = b.y,
      bz = b.z,
      bw = b.w;
    o.x = aw * bx + ax * bw + ay * bz - az * by;
    o.y = aw * by - ax * bz + ay * bw + az * bx;
    o.z = aw * bz + ax * by - ay * bx + az * bw;
    o.w = aw * bw - ax * bx - ay * by - az * bz;
    return o;
  },
  /** The inverse rotation. Assumes a unit quaternion (the conjugate), which
   *  every quaternion produced by this module is. */
  invert(a: Quat, out?: Quat): Quat {
    const o = target(a, out);
    o.x = -a.x;
    o.y = -a.y;
    o.z = -a.z;
    o.w = a.w;
    return o;
  },
  /** Renormalize. Repeated `mul` drifts off the unit sphere; call this after a
   *  long chain of incremental rotations. */
  normalize(a: Quat, out?: Quat): Quat {
    const o = target(a, out);
    const l = Math.hypot(a.x, a.y, a.z, a.w);
    if (l === 0) return Quat.identity(o);
    o.x = a.x / l;
    o.y = a.y / l;
    o.z = a.z / l;
    o.w = a.w / l;
    return o;
  },
  /** Dot product — the cosine of half the angle between two orientations. */
  dot(a: Quat, b: Quat): number {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  },
  /** Spherical interpolation along the SHORTEST arc, at a constant angular
   *  rate. `t` is unclamped. Falls back to a normalized lerp when the two
   *  orientations are nearly identical, where the trigonometric form loses
   *  precision. */
  slerp(a: Quat, b: Quat, t: number, out?: Quat): Quat {
    const o = target(a, out);
    let cos = Quat.dot(a, b);
    // A quaternion and its negation are the same rotation; flipping makes the
    // interpolation take the short way round rather than the long one.
    let bx = b.x,
      by = b.y,
      bz = b.z,
      bw = b.w;
    if (cos < 0) {
      cos = -cos;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    let sa: number, sb: number;
    if (cos > 0.9995) {
      sa = 1 - t;
      sb = t;
    } else {
      const theta = Math.acos(cos);
      const sin = Math.sin(theta);
      sa = Math.sin((1 - t) * theta) / sin;
      sb = Math.sin(t * theta) / sin;
    }
    o.x = a.x * sa + bx * sb;
    o.y = a.y * sa + by * sb;
    o.z = a.z * sa + bz * sb;
    o.w = a.w * sa + bw * sb;
    return Quat.normalize(o);
  },
  /** Rotate a point/direction by this quaternion, in place or into `out`. */
  rotateVec3<V extends { x: number; y: number; z: number }>(q: Quat, v: V, out?: V): V {
    const o = out ?? v;
    const { x, y, z } = v;
    // t = 2 · (q.xyz × v); v' = v + q.w · t + q.xyz × t
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    o.x = x + q.w * tx + q.y * tz - q.z * ty;
    o.y = y + q.w * ty + q.z * tx - q.x * tz;
    o.z = z + q.w * tz + q.x * ty - q.y * tx;
    return o;
  },
  /** Equality within `epsilon`, treating `q` and `−q` as equal — they are the
   *  same rotation, and a slerp or a keyframe may hand you either. */
  equals(a: Quat, b: Quat, epsilon = 1e-6): boolean {
    const same =
      Math.abs(a.x - b.x) <= epsilon &&
      Math.abs(a.y - b.y) <= epsilon &&
      Math.abs(a.z - b.z) <= epsilon &&
      Math.abs(a.w - b.w) <= epsilon;
    const flipped =
      Math.abs(a.x + b.x) <= epsilon &&
      Math.abs(a.y + b.y) <= epsilon &&
      Math.abs(a.z + b.z) <= epsilon &&
      Math.abs(a.w + b.w) <= epsilon;
    return same || flipped;
  },
};
