/** A ball rolling across a flat triangle mesh must stay on it.
 *
 * A trimesh is a bag of independent triangles. Nothing in the shape says that
 * two triangles meeting along an edge are one flat floor, so a contact found on
 * that shared edge can be given a normal pointing out of the *edge* rather than
 * out of the surface. The solver then does what it is told and launches the
 * body — a ball rolling fast over a perfectly flat but triangulated floor pops
 * into the air with no bump to hit. Rapier's `FIX_INTERNAL_EDGES` consults the
 * neighbouring triangles' normals to suppress that, and `createColliderDescriptor`
 * asks for it unless the caller opts out.
 *
 * The floor below is triangulated the way an exported one is: a fan from one
 * far corner, so a body crossing it meets a shared edge every few units at a
 * shallow angle. The opt-out case is asserted too, and not out of symmetry —
 * without it a version of Rapier that silently dropped the flag would leave
 * the first assertion passing on nothing.
 */

import { describe, expect, it } from "vitest";
import { createPhysics3D } from "@src/physics3d/index.js";

/** A 40×40 floor at y = 0, fanned from the corner at (-20, 0, -20). */
function fannedFloor(): { vertices: Float32Array; indices: Uint32Array } {
  const vertices: number[] = [-20, 0, -20];
  const indices: number[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    vertices.push(-20 + i, 0, 20);
    if (i > 0) indices.push(0, i, i + 1);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

async function rollAcross(fixInternalEdges: boolean): Promise<number> {
  const world = await createPhysics3D({ gravity: { x: 0, y: -50, z: 0 }, timestep: 1 / 120 });
  const floor = world.createBody({ type: "fixed" });
  const { vertices, indices } = fannedFloor();
  world.createCollider(
    floor,
    { type: "trimesh", vertices, indices, fixInternalEdges },
    { friction: 0.8, restitution: 0.3 },
  );

  const ball = world.createBody({
    type: "dynamic",
    position: { x: -18, y: 0.5, z: 0 },
    lockRotation: true,
    linearDamping: 0.2,
  });
  world.createCollider(ball, { type: "ball", radius: 0.5 }, { friction: 0.1, restitution: 0.7 });
  ball.setVelocity({ x: 40, y: 0, z: 0 });

  let apex = 0;
  for (let step = 0; step < 240; step += 1) {
    world.step();
    apex = Math.max(apex, ball.position.y - 0.5);
  }
  world.dispose();
  return apex;
}

describe("trimesh internal edges", () => {
  it("keeps a ball on a flat fanned floor", async () => {
    // Resting height is 0.5; Rapier lets a body settle a hair into its contact,
    // so the bar is "did not leave", not "never moved".
    expect(await rollAcross(true)).toBeLessThan(0.02);
  });

  it("pops the same ball when the fix is opted out of", async () => {
    expect(await rollAcross(false)).toBeGreaterThan(0.05);
  });
});
