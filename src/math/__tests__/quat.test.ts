import { describe, expect, it } from "vitest";
import { Quat } from "../quat.js";
import { Vec3 } from "../vec3.js";

const X = () => ({ x: 1, y: 0, z: 0 });
const Y = () => ({ x: 0, y: 1, z: 0 });
const Z = () => ({ x: 0, y: 0, z: 1 });

describe("Quat.fromAxisAngle", () => {
  it("rotates +X to +Y about Z (right-handed)", () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    expect(Vec3.equals(Quat.rotateVec3(q, X()), Y())).toBe(true);
  });

  it("normalizes the axis, so an unnormalized one still gives a unit rotation", () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 7, Math.PI / 2);
    expect(Vec3.equals(Quat.rotateVec3(q, X()), Y())).toBe(true);
  });

  it("returns identity for a zero axis rather than NaN", () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 0, 1);
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("preserves length", () => {
    const q = Quat.fromAxisAngle(Quat.create(), 1, 2, 3, 0.9);
    const v = { x: 4, y: -5, z: 6 };
    expect(Vec3.len(Quat.rotateVec3(q, v, { x: 0, y: 0, z: 0 }))).toBeCloseTo(Vec3.len(v));
  });
});

describe("Quat.mul", () => {
  it("applies the RIGHT operand first, like a matrix product", () => {
    const aboutZ = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2); // X → Y
    const aboutX = Quat.fromAxisAngle(Quat.create(), 1, 0, 0, Math.PI / 2); // Y → Z

    // aboutX ∘ aboutZ: X → Y → Z.
    const both = Quat.mul(aboutX, aboutZ, Quat.create());
    expect(Vec3.equals(Quat.rotateVec3(both, X()), Z())).toBe(true);

    // The other order does something else entirely — order matters, and this
    // pins down which convention this module uses.
    const swapped = Quat.mul(aboutZ, aboutX, Quat.create());
    expect(Vec3.equals(Quat.rotateVec3(swapped, X()), Z())).toBe(false);
  });

  it("is safe with an aliased destination", () => {
    const a = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 0.4);
    const b = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, 0.7);
    const expected = Quat.mul(a, b, Quat.create());
    Quat.mul(a, b);
    expect(Quat.equals(a, expected)).toBe(true);
  });

  it("composes with its inverse to identity", () => {
    const q = Quat.fromEuler(Quat.create(), 0.3, -1.2, 0.8);
    const back = Quat.mul(q, Quat.invert(q, Quat.create()), Quat.create());
    expect(Quat.equals(back, Quat.create())).toBe(true);
  });
});

describe("Quat.fromEuler", () => {
  it("yaw alone rotates about Y", () => {
    const q = Quat.fromEuler(Quat.create(), 0, Math.PI / 2, 0);
    // A right-handed quarter turn about +Y takes +Z to +X.
    expect(Vec3.equals(Quat.rotateVec3(q, Z()), X())).toBe(true);
  });

  it("pitch alone rotates about X", () => {
    const q = Quat.fromEuler(Quat.create(), Math.PI / 2, 0, 0);
    expect(Vec3.equals(Quat.rotateVec3(q, Y()), Z())).toBe(true);
  });

  it("keeps yaw horizontal when pitched — the reason for YXZ order", () => {
    const q = Quat.fromEuler(Quat.create(), 0.6, Math.PI / 2, 0);
    // Whatever the pitch, yawing must not roll the horizon: the camera's own
    // right axis stays in the XZ plane.
    const right = Quat.rotateVec3(q, X());
    expect(right.y).toBeCloseTo(0);
  });
});

describe("Quat.slerp", () => {
  it("hits both endpoints", () => {
    const a = Quat.create();
    const b = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, 1.2);
    expect(Quat.equals(Quat.slerp(a, b, 0, Quat.create()), a)).toBe(true);
    expect(Quat.equals(Quat.slerp(a, b, 1, Quat.create()), b)).toBe(true);
  });

  it("moves at a constant angular rate", () => {
    const a = Quat.create();
    const b = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    const half = Quat.slerp(a, b, 0.5, Quat.create());
    const quarter = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 4);
    expect(Quat.equals(half, quarter)).toBe(true);
  });

  it("takes the short way round when the inputs are on opposite hemispheres", () => {
    const a = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 0.2);
    // Negating every component is the SAME rotation; a naive lerp would then
    // travel almost all the way around instead of barely moving.
    const negated = { x: -a.x, y: -a.y, z: -a.z, w: -a.w };
    const mid = Quat.slerp(a, negated, 0.5, Quat.create());
    expect(Quat.equals(mid, a)).toBe(true);
  });

  it("stays stable when the two orientations are nearly identical", () => {
    const a = Quat.create();
    const b = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, 1e-7);
    const mid = Quat.slerp(a, b, 0.5, Quat.create());
    expect(Number.isNaN(mid.x)).toBe(false);
    expect(Quat.equals(mid, a)).toBe(true);
  });

  it("returns a unit quaternion", () => {
    const a = Quat.fromEuler(Quat.create(), 0.2, 1.4, -0.3);
    const b = Quat.fromEuler(Quat.create(), -1.1, 0.4, 2.2);
    const mid = Quat.slerp(a, b, 0.37, Quat.create());
    expect(Math.hypot(mid.x, mid.y, mid.z, mid.w)).toBeCloseTo(1);
  });
});

describe("Quat.equals", () => {
  it("treats q and −q as the same rotation", () => {
    const q = Quat.fromEuler(Quat.create(), 0.5, 0.5, 0.5);
    expect(Quat.equals(q, { x: -q.x, y: -q.y, z: -q.z, w: -q.w })).toBe(true);
  });
});
