import { describe, expect, it } from "vitest";
import * as rapier from "@dimforge/rapier3d-compat";
import type { Vec3 } from "@src/math/vec3.js";
import { createPhysics3D, type Physics3DOptions } from "../world.js";

function physics(options: Omit<Physics3DOptions, "rapier"> = {}) {
  return createPhysics3D({ rapier, ...options });
}

describe("physics3d raycast", () => {
  it("reports the distance, point and normal of the nearest surface", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const ground = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    world.createCollider(ground, { type: "cuboid", halfExtents: { x: 50, y: 1, z: 50 } });
    world.step();

    const hit = world.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(5, 4);
    expect(hit?.point.y).toBeCloseTo(0, 4);
    expect(hit?.normal.y).toBeCloseTo(1, 4);
    world.dispose();
  });

  it("returns null past maxDistance and when nothing is in the way", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const ground = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    world.createCollider(ground, { type: "cuboid", halfExtents: { x: 1, y: 1, z: 1 } });
    world.step();

    expect(
      world.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, { maxDistance: 2 }),
    ).toBeNull();
    expect(world.raycast({ x: 40, y: 5, z: 0 }, { x: 0, y: -1, z: 0 })).toBeNull();
    world.dispose();
  });

  it("skips excluded colliders", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const near = world.createBody({ type: "fixed", position: { x: 0, y: 2, z: 0 } });
    const nearCollider = world.createCollider(near, {
      type: "cuboid",
      halfExtents: { x: 5, y: 0.5, z: 5 },
    });
    const far = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    world.createCollider(far, { type: "cuboid", halfExtents: { x: 5, y: 1, z: 5 } });
    world.step();

    const blocked = world.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(blocked?.distance).toBeCloseTo(2.5, 4);
    const through = world.raycast(
      { x: 0, y: 5, z: 0 },
      { x: 0, y: -1, z: 0 },
      {
        exclude: [nearCollider],
      },
    );
    expect(through?.distance).toBeCloseTo(5, 4);
    world.dispose();
  });

  it("casts against only the colliders a filter accepts", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const prop = world.createBody({ type: "fixed", position: { x: 0, y: 2, z: 0 } });
    world.createCollider(prop, { type: "cuboid", halfExtents: { x: 1, y: 0.5, z: 1 } });
    const ground = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    const groundCollider = world.createCollider(ground, {
      type: "cuboid",
      halfExtents: { x: 5, y: 1, z: 5 },
    });
    world.step();

    const wanted = world.raycast(
      { x: 0, y: 5, z: 0 },
      { x: 0, y: -1, z: 0 },
      {
        filter: (collider) => collider === groundCollider,
      },
    );
    expect(wanted?.distance).toBeCloseTo(5, 4);
    expect(
      world.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, { filter: () => false }),
    ).toBeNull();
    world.dispose();
  });
});

describe("physics3d kinematic bodies", () => {
  it("shoves a resting body along when the platform under it moves", async () => {
    const world = await physics({ gravity: { x: 0, y: -20, z: 0 }, timestep: 1 / 60 });
    const platform = world.createBody({ type: "kinematic-position" });
    world.createCollider(
      platform,
      { type: "cuboid", halfExtents: { x: 4, y: 0.5, z: 4 } },
      { friction: 1 },
    );
    const box = world.createBody({ type: "dynamic", position: { x: 0, y: 1.2, z: 0 } });
    world.createCollider(
      box,
      { type: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
      { friction: 1 },
    );
    for (let i = 0; i < 60; i++) world.step();
    const settled = box.position.x;

    for (let i = 1; i <= 60; i++) {
      platform.setNextPosition({ x: i * 0.05, y: 0, z: 0 });
      world.step();
    }
    expect(platform.position.x).toBeCloseTo(3, 4);
    // Carried, not left behind: `setNextPosition` gives the solver a velocity
    // to work with, which friction then passes on to whatever is standing on it.
    expect(box.position.x - settled).toBeGreaterThan(1);
    world.dispose();
  });
});

describe("physics3d math types", () => {
  it("accepts a math Vec3 and a plain {x,y,z} literal", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const origin: Vec3 = { x: 0, y: 5, z: 0 };
    const ground = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    world.createCollider(ground, { type: "cuboid", halfExtents: { x: 50, y: 1, z: 50 } });
    world.step();

    const hit = world.raycast(origin, { x: 0, y: -1, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(5, 4);
    world.dispose();
  });
});

describe("physics3d queries", () => {
  it("queryAabb finds a cuboid and respects filter", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const body = world.createBody({ type: "fixed", position: { x: 0, y: 0, z: 0 } });
    const cuboid = world.createCollider(body, {
      type: "cuboid",
      halfExtents: { x: 1, y: 1, z: 1 },
    });
    const other = world.createBody({ type: "fixed", position: { x: 10, y: 0, z: 0 } });
    world.createCollider(other, { type: "cuboid", halfExtents: { x: 1, y: 1, z: 1 } });
    world.step();

    const hits = world.queryAabb({ x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 });
    expect(hits).toContain(cuboid);
    expect(hits).toHaveLength(1);
    expect(
      world.queryAabb({ x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }, { filter: () => false }),
    ).toEqual([]);
    expect(
      world.queryAabb(
        { x: -2, y: -2, z: -2 },
        { x: 2, y: 2, z: 2 },
        { filter: (c) => c === cuboid },
      ),
    ).toEqual([cuboid]);
    world.dispose();
  });

  it("pointPick hits a containing cuboid and misses empty space", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const body = world.createBody({ type: "fixed", position: { x: 0, y: 0, z: 0 } });
    const cuboid = world.createCollider(body, {
      type: "cuboid",
      halfExtents: { x: 1, y: 1, z: 1 },
    });
    world.step();

    expect(world.pointPick({ x: 0, y: 0, z: 0 })).toBe(cuboid);
    expect(world.pointPick({ x: 0.5, y: 0.5, z: 0.5 })).toBe(cuboid);
    expect(world.pointPick({ x: 10, y: 0, z: 0 })).toBeNull();
    expect(world.pointPick({ x: 0, y: 0, z: 0 }, { filter: () => false })).toBeNull();
    world.dispose();
  });
});

describe("physics3d joints", () => {
  it("creates a revolute joint whose destroy() is idempotent", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const anchor = world.createBody({ type: "fixed", position: { x: 0, y: 0, z: 0 } });
    world.createCollider(anchor, { type: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    const arm = world.createBody({ type: "dynamic", position: { x: 2, y: 0, z: 0 } });
    world.createCollider(arm, { type: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    const joint = world.revolute(anchor, arm, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });

    expect(joint.raw.isValid()).toBe(true);
    joint.destroy();
    expect(joint.raw.isValid()).toBe(false);
    joint.destroy();
    world.dispose();
  });
});

describe("physics3d contacts", () => {
  it("fires onContact with the wrapped bodies and honors unsubscribe", async () => {
    const world = await physics({ gravity: { x: 0, y: -30, z: 0 } });
    const floor = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    world.createCollider(floor, { type: "cuboid", halfExtents: { x: 10, y: 1, z: 10 } });
    const box = world.createBody({ type: "dynamic", position: { x: 0, y: 4, z: 0 } });
    world.createCollider(box, { type: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    const seen: unknown[] = [];
    const off = world.onContact((left, right) => {
      seen.push(left, right);
    });
    for (let i = 0; i < 120; i++) world.step();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContain(floor);
    expect(seen).toContain(box);

    off();
    const before = seen.length;
    for (let i = 0; i < 30; i++) world.step();
    expect(seen.length).toBe(before);
    world.dispose();
  });

  it("hands onContact the colliders that met and a normal pointing a to b", async () => {
    const world = await physics({ gravity: { x: 0, y: -30, z: 0 } });
    const floor = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    const floorCollider = world.createCollider(floor, {
      type: "cuboid",
      halfExtents: { x: 10, y: 1, z: 10 },
    });
    const box = world.createBody({ type: "dynamic", position: { x: 0, y: 4, z: 0 } });
    const boxCollider = world.createCollider(box, {
      type: "cuboid",
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    });
    let hit: { floorFirst: boolean; normal: Vec3 } | null = null;
    world.onContact((a, b, contact) => {
      if (hit) return;
      const floorFirst = a === floor;
      expect(b).toBe(floorFirst ? box : floor);
      expect(contact.colliderA).toBe(floorFirst ? floorCollider : boxCollider);
      expect(contact.colliderB).toBe(floorFirst ? boxCollider : floorCollider);
      hit = { floorFirst, normal: { ...contact.normal } };
    });
    for (let i = 0; i < 120 && !hit; i++) world.step();

    expect(hit).not.toBeNull();
    const seen = hit as unknown as { floorFirst: boolean; normal: Vec3 };
    // Landing on a flat floor: straight up when the floor is `a`, straight down
    // when the box is.
    expect(seen.normal.y).toBeCloseTo(seen.floorFirst ? 1 : -1, 3);
    expect(seen.normal.x).toBeCloseTo(0, 3);
    expect(seen.normal.z).toBeCloseTo(0, 3);
    world.dispose();
  });

  it("fires onContactEnd when two bodies separate", async () => {
    const world = await physics({ gravity: { x: 0, y: 0, z: 0 } });
    const floor = world.createBody({ type: "fixed", position: { x: 0, y: -1, z: 0 } });
    world.createCollider(floor, { type: "cuboid", halfExtents: { x: 10, y: 1, z: 10 } });
    const box = world.createBody({
      type: "dynamic",
      position: { x: 0, y: 0.5, z: 0 },
    });
    world.createCollider(
      box,
      { type: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
      { restitution: 0.9 },
    );
    let begins = 0;
    let ends = 0;
    world.onContact(() => begins++);
    const off = world.onContactEnd(() => ends++);
    world.step();
    expect(begins).toBeGreaterThan(0);

    box.setPosition({ x: 0, y: 8, z: 0 });
    world.step();
    expect(ends).toBeGreaterThan(0);

    const wasEnds = ends;
    off();
    box.setPosition({ x: 0, y: 0.5, z: 0 });
    world.step();
    box.setPosition({ x: 0, y: 8, z: 0 });
    world.step();
    expect(ends).toBe(wasEnds);
    world.dispose();
  });
});
