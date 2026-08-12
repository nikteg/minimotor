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
 * far corner, so a body crossing it meets a shared edge every unit at a shallow
 * angle. The opt-out case is asserted too, and not out of symmetry — without it
 * a version of Rapier that silently dropped the flag would leave the first
 * assertion passing on nothing.
 *
 * The third test is the flag's other, less obvious half: it makes a trimesh
 * ONE-SIDED. Rapier's plain trimesh collides from either side, so a floor whose
 * triangles are wound facing down still holds a ball up and nobody ever finds
 * out. With the pseudo-normals computed, the same floor is a hole. Winding is
 * therefore load-bearing, and this pins it so that fact is discovered here
 * rather than in a level.
 */

import { describe, expect, it } from "vitest";
import * as rapier from "@dimforge/rapier3d-compat";
import { createPhysics3D } from "@src/physics3d/index.js";

/** A 40×40 floor at y = 0, fanned from the corner at (-20, 0, -20).
 *
 * `up` picks the winding: counter-clockwise seen from above is a floor, the
 * other way round is a ceiling that happens to be underfoot. */
function fannedFloor(up: boolean): { vertices: Float32Array; indices: Uint32Array } {
  const vertices: number[] = [-20, 0, -20];
  const indices: number[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    vertices.push(-20 + i, 0, 20);
    if (i > 0) indices.push(...(up ? [0, i, i + 1] : [0, i + 1, i]));
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

interface Roll {
  /** How far above its resting height the ball ever got. */
  apex: number;
  /** How far below it ever got — a floor that is not there shows up here. */
  sank: number;
}

async function rollAcross(fixInternalEdges: boolean, up = true): Promise<Roll> {
  const world = await createPhysics3D({
    rapier,
    gravity: { x: 0, y: -50, z: 0 },
    timestep: 1 / 120,
  });
  const floor = world.createBody({ type: "fixed" });
  const { vertices, indices } = fannedFloor(up);
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
  ball.setVelocity({ x: 30, y: 0, z: 0 });

  let apex = 0;
  let sank = 0;
  // 100 steps at 30 units a second covers 25 of the 36 units of floor ahead of
  // the ball, so it never reaches the far edge and falls off it.
  for (let step = 0; step < 100; step += 1) {
    world.step();
    apex = Math.max(apex, ball.position.y - 0.5);
    sank = Math.max(sank, 0.5 - ball.position.y);
  }
  world.dispose();
  return { apex, sank };
}

describe("trimesh internal edges", () => {
  it("keeps a ball on a flat fanned floor", async () => {
    const { apex, sank } = await rollAcross(true);
    // Resting height is 0.5; Rapier lets a body settle a hair into its contact,
    // so the bar is "did not leave", not "never moved".
    expect(apex).toBeLessThan(0.02);
    expect(sank).toBeLessThan(0.02);
  });

  it("pops the same ball when the fix is opted out of", async () => {
    const { apex, sank } = await rollAcross(false);
    expect(apex).toBeGreaterThan(0.05);
    expect(sank).toBeLessThan(0.02);
  });

  it("stops holding up a ball once the floor is wound upside down", async () => {
    // The plain trimesh does not care; the fixed one does, and the ball falls
    // straight through. This is the cost of the flag and the reason a mesh
    // handed to it has to be wound correctly.
    expect((await rollAcross(false, false)).sank).toBeLessThan(0.02);
    expect((await rollAcross(true, false)).sank).toBeGreaterThan(1);
  });
});
