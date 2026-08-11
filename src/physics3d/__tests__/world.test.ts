import { describe, expect, it } from "vitest";
import { createPhysics3D } from "../world.js";

describe("physics3d raycast", () => {
  it("reports the distance, point and normal of the nearest surface", async () => {
    const world = await createPhysics3D({ gravity: { x: 0, y: 0, z: 0 } });
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
    const world = await createPhysics3D({ gravity: { x: 0, y: 0, z: 0 } });
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
    const world = await createPhysics3D({ gravity: { x: 0, y: 0, z: 0 } });
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
    const world = await createPhysics3D({ gravity: { x: 0, y: 0, z: 0 } });
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
    const world = await createPhysics3D({ gravity: { x: 0, y: -20, z: 0 }, timestep: 1 / 60 });
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
