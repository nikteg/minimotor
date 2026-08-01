import { describe, expect, it } from "vitest";
import { Vec3 } from "../vec3.js";

describe("Vec3 producers", () => {
  it("mutate the first argument when no out is given", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 10, y: 20, z: 30 };
    expect(Vec3.add(a, b)).toBe(a);
    expect(a).toEqual({ x: 11, y: 22, z: 33 });
    expect(b).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("leave both inputs alone when out is given", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 1, y: 1, z: 1 };
    const out = { x: 0, y: 0, z: 0 };
    expect(Vec3.sub(a, b, out)).toBe(out);
    expect(out).toEqual({ x: 0, y: 1, z: 2 });
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("scale uniformly or component-wise", () => {
    expect(Vec3.scale({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(Vec3.scale({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 2 })).toEqual({ x: 0, y: 2, z: 6 });
  });

  it("addScaled integrates without a temporary", () => {
    const pos = { x: 0, y: 0, z: 0 };
    Vec3.addScaled(pos, { x: 1, y: 2, z: 3 }, 0.5);
    expect(pos).toEqual({ x: 0.5, y: 1, z: 1.5 });
  });
});

describe("Vec3.normalize", () => {
  it("produces a unit vector", () => {
    expect(Vec3.len(Vec3.normalize({ x: 3, y: 4, z: 12 }))).toBeCloseTo(1);
  });

  it("leaves a zero vector at zero rather than producing NaN", () => {
    expect(Vec3.normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("Vec3.cross", () => {
  it("is right-handed: X × Y = Z", () => {
    const x = { x: 1, y: 0, z: 0 };
    const y = { x: 0, y: 1, z: 0 };
    expect(Vec3.cross(x, y, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("is safe to alias with an input", () => {
    const a = { x: 1, y: 0, z: 0 };
    Vec3.cross(a, { x: 0, y: 1, z: 0 });
    expect(a).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("gives a vector perpendicular to both inputs", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: -4, y: 5, z: 6 };
    const n = Vec3.cross(a, b, { x: 0, y: 0, z: 0 });
    expect(Vec3.dot(n, a)).toBeCloseTo(0);
    expect(Vec3.dot(n, b)).toBeCloseTo(0);
  });
});

describe("Vec3 scalars", () => {
  it("len2 avoids the square root but agrees with len", () => {
    const v = { x: 1, y: 2, z: 2 };
    expect(Vec3.len(v)).toBe(3);
    expect(Vec3.len2(v)).toBe(9);
  });

  it("dist and dist2 agree", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 1, y: 2, z: 2 };
    expect(Vec3.dist(a, b)).toBe(3);
    expect(Vec3.dist2(a, b)).toBe(9);
  });

  it("equals uses a tolerance", () => {
    expect(Vec3.equals({ x: 1, y: 1, z: 1 }, { x: 1 + 1e-9, y: 1, z: 1 })).toBe(true);
    expect(Vec3.equals({ x: 1, y: 1, z: 1 }, { x: 1.1, y: 1, z: 1 })).toBe(false);
  });
});
