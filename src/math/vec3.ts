// ---------- Structural 3D vector math ----------
// The same bargain `vec2.ts` makes, one axis further: anything with `x`/`y`/`z`
// IS a Vec3 — a mesh node's position, a light direction, a camera target. Plain
// data (JSON-safe), functions over it, no classes.
//
// Convention, identical to Vec2: producers write into `out` when given,
// otherwise mutate their FIRST vector argument and return it, so hot paths stay
// allocation-free. Scalar functions (`len`, `dot`, `dist`) are pure.
//
// A Vec3 is deliberately NOT a Vec2 with a spare field. `Vec2` is used by the
// 2D renderer, the physics bodies and the pointer, all of which would silently
// accept a Vec3 and ignore its `z` — the structural typing that makes Vec2
// pleasant is exactly what makes that mistake invisible. Keep the two apart and
// convert explicitly.
//
// Handedness: RIGHT-handed, +Y up, camera looks down -Z. This is the glTF and
// OpenGL convention, and it is what `Mat4.perspective`/`lookAt` assume. It is
// the opposite of the 2D renderer's +Y down, which is why `Camera3D` never
// shares a matrix with the 2D camera.

export interface Vec3 {
  /** Right. */
  x: number;
  /** Up. */
  y: number;
  /** Toward the viewer (the camera looks down -Z). */
  z: number;
}

function target(a: Vec3, out?: Vec3): Vec3 {
  return out ?? a;
}

/** Structural 3D vector math over anything with `x`/`y`/`z`. Producers write
 *  into `out` when given, else mutate the first argument — hot paths stay
 *  allocation-free. Right-handed, +Y up. */
export const Vec3 = {
  /** Write components into `v` — the in-place counterpart of an `{x, y, z}`
   *  literal. As in Vec2 there is no `Vec3.of`: the literal already IS one. */
  set(v: Vec3, x: number, y: number, z: number): Vec3 {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  },
  /** a ← b. Mutates the FIRST argument, as in an assignment. */
  copy(a: Vec3, b: Vec3): Vec3 {
    a.x = b.x;
    a.y = b.y;
    a.z = b.z;
    return a;
  },
  /** A fresh `{x, y, z}` — for the cold paths where a literal would be noise. */
  clone(a: Vec3): Vec3 {
    return { x: a.x, y: a.y, z: a.z };
  },
  /** a + b. */
  add(a: Vec3, b: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = a.x + b.x;
    o.y = a.y + b.y;
    o.z = a.z + b.z;
    return o;
  },
  /** a − b. */
  sub(a: Vec3, b: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = a.x - b.x;
    o.y = a.y - b.y;
    o.z = a.z - b.z;
    return o;
  },
  /** a × s (uniform), or component-wise when `s` is a Vec3. */
  scale(a: Vec3, s: number | Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    if (typeof s === "number") {
      o.x = a.x * s;
      o.y = a.y * s;
      o.z = a.z * s;
    } else {
      o.x = a.x * s.x;
      o.y = a.y * s.y;
      o.z = a.z * s.z;
    }
    return o;
  },
  /** a + b × s — the integrate step, without a temporary. */
  addScaled(a: Vec3, b: Vec3, s: number, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = a.x + b.x * s;
    o.y = a.y + b.y * s;
    o.z = a.z + b.z * s;
    return o;
  },
  /** −a. */
  negate(a: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = -a.x;
    o.y = -a.y;
    o.z = -a.z;
    return o;
  },
  /** Squared length — compare distances without the square root. */
  len2(a: Vec3): number {
    return a.x * a.x + a.y * a.y + a.z * a.z;
  },
  /** Length. */
  len(a: Vec3): number {
    return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  },
  /** Unit vector. A zero vector is left at zero rather than producing NaN —
   *  the caller almost never wants a NaN propagating into a matrix. */
  normalize(a: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    if (l === 0) {
      o.x = 0;
      o.y = 0;
      o.z = 0;
      return o;
    }
    o.x = a.x / l;
    o.y = a.y / l;
    o.z = a.z / l;
    return o;
  },
  /** Dot product. */
  dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },
  /** Cross product, right-handed: `cross(X, Y) === Z`. Safe to alias `out`
   *  with either input — the components are read before any are written. */
  cross(a: Vec3, b: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    const ax = a.x,
      ay = a.y,
      az = a.z;
    const bx = b.x,
      by = b.y,
      bz = b.z;
    o.x = ay * bz - az * by;
    o.y = az * bx - ax * bz;
    o.z = ax * by - ay * bx;
    return o;
  },
  /** Distance between two points. */
  dist(a: Vec3, b: Vec3): number {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  },
  /** Squared distance. */
  dist2(a: Vec3, b: Vec3): number {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    return dx * dx + dy * dy + dz * dz;
  },
  /** Linear interpolation, `t` unclamped. */
  lerp(a: Vec3, b: Vec3, t: number, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = a.x + (b.x - a.x) * t;
    o.y = a.y + (b.y - a.y) * t;
    o.z = a.z + (b.z - a.z) * t;
    return o;
  },
  /** Component-wise minimum. */
  min(a: Vec3, b: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = Math.min(a.x, b.x);
    o.y = Math.min(a.y, b.y);
    o.z = Math.min(a.z, b.z);
    return o;
  },
  /** Component-wise maximum. */
  max(a: Vec3, b: Vec3, out?: Vec3): Vec3 {
    const o = target(a, out);
    o.x = Math.max(a.x, b.x);
    o.y = Math.max(a.y, b.y);
    o.z = Math.max(a.z, b.z);
    return o;
  },
  /** Exact equality within `epsilon` (default 1e-6) — for tests and for
   *  change detection, not for physics. */
  equals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
    return (
      Math.abs(a.x - b.x) <= epsilon &&
      Math.abs(a.y - b.y) <= epsilon &&
      Math.abs(a.z - b.z) <= epsilon
    );
  },
};
