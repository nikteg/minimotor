import { describe, expect, it } from "vitest";
import { Mat4 } from "../mat4.js";
import { Quat } from "../quat.js";
import { Vec3 } from "../vec3.js";

/** A point transformed by a matrix, as a fresh object — the tests read better
 *  when the expectation sits next to the input. */
function apply(m: Mat4, x: number, y: number, z: number): Vec3 {
  return Mat4.transformPoint(m, { x, y, z });
}

describe("Mat4 layout", () => {
  it("is column-major: translation lives in m[12..14]", () => {
    const m = Mat4.fromTranslation(1, 2, 3);
    expect([m[12], m[13], m[14]]).toEqual([1, 2, 3]);
    // The row-major mistake would put it here instead.
    expect([m[3], m[7], m[11]]).toEqual([0, 0, 0]);
  });

  it("multiplies right-to-left: mul(a, b) applies b first", () => {
    const translate = Mat4.fromTranslation(10, 0, 0);
    const scale = Mat4.fromScale(2, 2, 2);

    // scale THEN translate → the translation is not scaled.
    const scaleThenTranslate = Mat4.mul(translate, scale, Mat4.create());
    expect(apply(scaleThenTranslate, 1, 0, 0)).toEqual({ x: 12, y: 0, z: 0 });

    // translate THEN scale → it is.
    const translateThenScale = Mat4.mul(scale, translate, Mat4.create());
    expect(apply(translateThenScale, 1, 0, 0)).toEqual({ x: 22, y: 0, z: 0 });
  });

  it("survives an aliased destination", () => {
    const a = Mat4.fromTranslation(1, 2, 3);
    const b = Mat4.fromScale(2, 2, 2);
    const expected = Mat4.mul(a, b, Mat4.create());
    Mat4.mul(a, b);
    expect(Mat4.equals(a, expected)).toBe(true);
  });

  it("transposes in place", () => {
    const m = Mat4.fromTranslation(1, 2, 3);
    Mat4.transpose(m, m);
    expect([m[3], m[7], m[11]]).toEqual([1, 2, 3]);
    expect([m[12], m[13], m[14]]).toEqual([0, 0, 0]);
  });
});

describe("Mat4.invert", () => {
  it("round-trips a composed transform", () => {
    const m = Mat4.compose({ x: 3, y: -4, z: 5 }, Quat.fromEuler(Quat.create(), 0.3, 1.1, -0.7), {
      x: 2,
      y: 0.5,
      z: 1.5,
    });
    const inv = Mat4.invert(m, Mat4.create());
    expect(inv).not.toBeNull();
    const round = Mat4.mul(m, inv!, Mat4.create());
    expect(Mat4.equals(round, Mat4.create())).toBe(true);
  });

  it("returns null for a singular matrix rather than NaN", () => {
    // A zero scale collapses a dimension — no inverse exists.
    const flat = Mat4.fromScale(1, 0, 1);
    expect(Mat4.invert(flat, Mat4.create())).toBeNull();
  });
});

describe("Mat4.compose", () => {
  it("applies scale, then rotation, then translation (glTF order)", () => {
    // A quarter turn about Z takes +X to +Y.
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    const m = Mat4.compose({ x: 100, y: 0, z: 0 }, q, { x: 3, y: 3, z: 3 });
    // (1,0,0) → scaled to (3,0,0) → rotated to (0,3,0) → moved to (100,3,0).
    // If the translation were scaled or rotated it would not land on 100.
    const p = apply(m, 1, 0, 0);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(0);
  });

  it("agrees with multiplying the three matrices by hand", () => {
    const pos = { x: 1, y: 2, z: 3 };
    const rot = Quat.fromEuler(Quat.create(), 0.2, -0.9, 0.4);
    const scl = { x: 1.5, y: 2, z: 0.25 };
    const composed = Mat4.compose(pos, rot, scl);

    const byHand = Mat4.mul(
      Mat4.fromTranslation(pos.x, pos.y, pos.z),
      Mat4.mul(Mat4.fromQuat(rot), Mat4.fromScale(scl.x, scl.y, scl.z)),
    );
    expect(Mat4.equals(composed, byHand)).toBe(true);
  });
});

describe("Mat4.lookAt", () => {
  it("puts the camera at the origin looking down −Z", () => {
    // Standing at +Z looking at the origin is the identity orientation, so a
    // point 5 in front of the camera must land at z = −5 in view space.
    const view = Mat4.lookAt({ x: 0, y: 0, z: 10 }, Vec3.set({} as Vec3, 0, 0, 0), {
      x: 0,
      y: 1,
      z: 0,
    });
    const p = apply(view, 0, 0, 5);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-5);
  });

  it("keeps +Y up and +X right when looking along −Z", () => {
    const view = Mat4.lookAt({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(apply(view, 1, 0, 0).x).toBeCloseTo(1);
    expect(apply(view, 0, 1, 0).y).toBeCloseTo(1);
  });

  it("falls back to identity instead of NaN when eye sits on the target", () => {
    const view = Mat4.lookAt({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 0 });
    expect(Mat4.equals(view, Mat4.create())).toBe(true);
  });

  it("falls back to identity when up is parallel to the view direction", () => {
    const view = Mat4.lookAt({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(Mat4.equals(view, Mat4.create())).toBe(true);
  });
});

describe("Mat4.perspective", () => {
  it("maps the near plane to −1 and the far plane to +1 in WebGL depth", () => {
    const p = Mat4.perspective(Math.PI / 3, 1, 1, 100);
    expect(apply(p, 0, 0, -1).z).toBeCloseTo(-1);
    expect(apply(p, 0, 0, -100).z).toBeCloseTo(1);
  });

  it("maps the near plane to 0 and the far plane to 1 in WebGPU depth", () => {
    const p = Mat4.perspective(Math.PI / 3, 1, 1, 100, true);
    expect(apply(p, 0, 0, -1).z).toBeCloseTo(0);
    expect(apply(p, 0, 0, -100).z).toBeCloseTo(1);
  });

  it("keeps an infinite far plane finite and correctly ordered", () => {
    const p = Mat4.perspective(Math.PI / 3, 1, 1, Infinity, true);
    expect(apply(p, 0, 0, -1).z).toBeCloseTo(0);
    const far = apply(p, 0, 0, -1e6).z;
    expect(Number.isFinite(far)).toBe(true);
    expect(far).toBeLessThan(1);
    expect(far).toBeGreaterThan(0.99);
  });

  it("squeezes x by the aspect ratio, not y", () => {
    const p = Mat4.perspective(Math.PI / 2, 2, 1, 100);
    // At 90° vertical fov and z = −1, y = 1 sits exactly on the top edge.
    expect(apply(p, 0, 1, -1).y).toBeCloseTo(1);
    // With aspect 2 the horizontal edge is twice as far out.
    expect(apply(p, 2, 0, -1).x).toBeCloseTo(1);
  });

  it("puts a point behind the camera outside the clip volume", () => {
    const p = Mat4.perspective(Math.PI / 3, 1, 1, 100);
    // +Z is BEHIND a right-handed camera; the w divide flips it out of range.
    expect(Math.abs(apply(p, 0, 0, 1).z)).toBeGreaterThan(1);
  });
});

describe("Mat4.ortho", () => {
  it("maps its box corners onto the clip cube (WebGL depth)", () => {
    const m = Mat4.ortho(-2, 2, -1, 1, 1, 11);
    const nearCorner = apply(m, -2, -1, -1);
    expect(nearCorner.x).toBeCloseTo(-1);
    expect(nearCorner.y).toBeCloseTo(-1);
    expect(nearCorner.z).toBeCloseTo(-1);
    const farCorner = apply(m, 2, 1, -11);
    expect(farCorner.x).toBeCloseTo(1);
    expect(farCorner.y).toBeCloseTo(1);
    expect(farCorner.z).toBeCloseTo(1);
  });

  it("maps near to 0 in WebGPU depth", () => {
    const m = Mat4.ortho(-1, 1, -1, 1, 1, 11, true);
    expect(apply(m, 0, 0, -1).z).toBeCloseTo(0);
    expect(apply(m, 0, 0, -11).z).toBeCloseTo(1);
  });
});

describe("Mat4.transformDirection", () => {
  it("ignores translation", () => {
    const m = Mat4.fromTranslation(100, 100, 100);
    expect(Mat4.transformDirection(m, { x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe("Mat4.normalMatrix", () => {
  it("keeps a normal perpendicular under non-uniform scale", () => {
    // A plane sheared by a non-uniform scale: the surface tangent and its
    // normal do NOT transform the same way, which is the whole reason this
    // function exists.
    const model = Mat4.fromScale(1, 4, 1);
    const nm = Mat4.normalMatrix(model);
    expect(nm).not.toBeNull();

    const tangent = { x: 1, y: 1, z: 0 }; // 45° in the XY plane
    const normal = { x: -1, y: 1, z: 0 }; // perpendicular to it
    Mat4.transformDirection(model, tangent);

    const n = {
      x: nm![0] * normal.x + nm![3] * normal.y + nm![6] * normal.z,
      y: nm![1] * normal.x + nm![4] * normal.y + nm![7] * normal.z,
      z: nm![2] * normal.x + nm![5] * normal.y + nm![8] * normal.z,
    };
    expect(Vec3.dot(n, tangent)).toBeCloseTo(0);

    // And the naive approach — using the model matrix — does not.
    const naive = Mat4.transformDirection(model, normal, { x: 0, y: 0, z: 0 });
    expect(Math.abs(Vec3.dot(naive, tangent))).toBeGreaterThan(0.5);
  });

  it("returns null for a singular model matrix", () => {
    expect(Mat4.normalMatrix(Mat4.fromScale(0, 1, 1))).toBeNull();
  });
});
