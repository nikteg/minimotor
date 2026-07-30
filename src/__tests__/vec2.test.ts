import { describe, expect, it } from "vitest";
import { Vec2 } from "../vec2.js";

describe("Vec2", () => {
  it("add mutates the first argument and returns it", () => {
    const a = { x: 1, y: 2 };
    const r = Vec2.add(a, { x: 3, y: 4 });
    expect(r).toBe(a);
    expect(a).toEqual({ x: 4, y: 6 });
  });

  it("add writes into out when given, leaving inputs untouched", () => {
    const a = { x: 1, y: 2 };
    const out = { x: 0, y: 0 };
    const r = Vec2.add(a, { x: 3, y: 4 }, out);
    expect(r).toBe(out);
    expect(a).toEqual({ x: 1, y: 2 });
    expect(out).toEqual({ x: 4, y: 6 });
  });

  it("sub / scale / addScaled", () => {
    expect(Vec2.sub({ x: 5, y: 5 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 2 });
    expect(Vec2.scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
    const pos = { x: 10, y: 10 };
    Vec2.addScaled(pos, { x: 1, y: 0 }, 3);
    expect(pos).toEqual({ x: 13, y: 10 });
  });

  it("len / dot / dist are pure", () => {
    const v = { x: 3, y: 4 };
    expect(Vec2.len(v)).toBe(5);
    expect(v).toEqual({ x: 3, y: 4 });
    expect(Vec2.dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
    expect(Vec2.dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("norm produces a unit vector; zero stays zero", () => {
    const v = Vec2.norm({ x: 3, y: 4 });
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
    expect(Vec2.len(v)).toBeCloseTo(1);
    expect(Vec2.norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("lerp interpolates", () => {
    expect(Vec2.lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });

  it("angle and rotate agree", () => {
    expect(Vec2.angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
    const v = Vec2.rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it("rotate is alias-safe when out === v", () => {
    const v = { x: 1, y: 0 };
    Vec2.rotate(v, Math.PI, v);
    expect(v.x).toBeCloseTo(-1);
    expect(v.y).toBeCloseTo(0);
  });

  it("clamp is component-wise", () => {
    expect(Vec2.clamp({ x: -5, y: 15 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toEqual({ x: 0, y: 10 });
  });

  it("clampRect accepts positional and structural region", () => {
    expect(Vec2.clampRect({ x: -5, y: 50 }, 0, 0, 20, 20)).toEqual({ x: 0, y: 20 });
    expect(Vec2.clampRect({ x: 30, y: -1 }, { x: 0, y: 0, w: 20, h: 20 })).toEqual({ x: 20, y: 0 });
  });

  it("limit caps magnitude without changing direction", () => {
    const v = Vec2.limit({ x: 6, y: 8 }, 5);
    expect(v.x).toBeCloseTo(3);
    expect(v.y).toBeCloseTo(4);
    expect(Vec2.limit({ x: 1, y: 1 }, 5)).toEqual({ x: 1, y: 1 }); // under the cap: untouched
  });

  it("works structurally on richer objects (a player rect is a Vec2)", () => {
    const player = { x: 0, y: 0, w: 32, h: 32, vel: { x: 2, y: -1 } };
    Vec2.add(player, player.vel);
    expect(player.x).toBe(2);
    expect(player.y).toBe(-1);
    expect(player.w).toBe(32); // untouched fields survive
  });
});

describe("set / copy", () => {
  it("set writes components in place and returns the same object", () => {
    const v = { x: 1, y: 2 };
    expect(Vec2.set(v, -3, 4)).toBe(v);
    expect(v).toEqual({ x: -3, y: 4 });
  });

  it("copy writes b into a, leaving b alone", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 9, y: 8 };
    expect(Vec2.copy(a, b)).toBe(a);
    expect(a).toEqual({ x: 9, y: 8 });
    expect(b).toEqual({ x: 9, y: 8 });
  });

  it("copy takes a structural source, not just another Vec2", () => {
    const vel = { x: 0, y: 0 };
    Vec2.copy(vel, { x: 1.5, y: -2.5, w: 10, h: 10 });
    expect(vel).toEqual({ x: 1.5, y: -2.5 });
  });
});
