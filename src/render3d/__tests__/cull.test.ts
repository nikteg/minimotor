/** `inFrustum`, and what its margin is for.
 *
 * The function is six plane tests against a box, and the box is the mesh's own
 * vertices through the node's world matrix. Two things about it are worth
 * pinning: that it drops what is genuinely outside, and that the margin does
 * what its documentation says — because a consumer reaching for the margin is
 * usually reaching for it in the dark, and the doc's whole purpose is to tell
 * them which of three faults they have.
 */

import { describe, expect, it } from "vitest";
import { frustumPlanes, inFrustum, meshBounds } from "../cull.js";
import { createCamera, viewProjection } from "../camera.js";
import type { MeshData } from "../mesh.js";

/** A unit cube centred on the origin, as a mesh. */
function cube(): MeshData {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  return { positions, indices: new Uint16Array([0, 1, 2]) };
}

/** A world matrix that is a translation, column-major as the renderer keeps it. */
function at(x: number, y: number, z: number): Float32Array {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

/** A camera looking down -Z from the origin, and its planes. */
function planes() {
  const camera = createCamera({
    target: { x: 0, y: 0, z: -10 },
    distance: 10,
    yaw: 0,
    pitch: 0,
    fov: 0.8,
    near: 0.1,
    far: 100,
  });
  return frustumPlanes(viewProjection(camera, 16 / 9));
}

describe("what the frustum keeps", () => {
  it("keeps a box in front of the camera", () => {
    expect(inFrustum(planes(), meshBounds(cube()), at(0, 0, -10))).toBe(true);
  });

  it("drops one well behind it", () => {
    expect(inFrustum(planes(), meshBounds(cube()), at(0, 0, 40))).toBe(false);
  });

  it("keeps anything it cannot measure", () => {
    // A mesh with no vertices cannot be culled meaningfully and cannot be drawn
    // either; a node with no world matrix has not been solved yet. Both answer
    // "keep", because dropping what you cannot measure is how geometry goes
    // missing.
    expect(inFrustum(planes(), null, at(0, 0, 40))).toBe(true);
    expect(inFrustum(planes(), meshBounds(cube()), undefined)).toBe(true);
  });
});

describe("the margin", () => {
  /** A box far enough off to the side to be dropped, and by how much. */
  const OFF_SCREEN = { x: 40, y: 0, z: -10 };

  it("changes nothing for a box that is already in", () => {
    const kept = inFrustum(planes(), meshBounds(cube()), at(0, 0, -10));
    expect(kept).toBe(true);
    expect(inFrustum(planes(), meshBounds(cube()), at(0, 0, -10), 5)).toBe(true);
  });

  it("rescues a box that is outside by less than the margin", () => {
    // The property the documentation promises: a margin is world units added to
    // the box on every axis, so the amount by which a box may be outside and
    // still kept is the margin itself.
    const outside = at(OFF_SCREEN.x, OFF_SCREEN.y, OFF_SCREEN.z);
    expect(inFrustum(planes(), meshBounds(cube()), outside)).toBe(false);
    expect(inFrustum(planes(), meshBounds(cube()), outside, 100)).toBe(true);
  });

  it("is not a way to keep everything", () => {
    // A margin that does not fix a picture means the box is in the wrong PLACE,
    // and that is the case this pins: something far outside stays outside under
    // a margin sized for an ordinary overhang.
    const outside = at(OFF_SCREEN.x, OFF_SCREEN.y, OFF_SCREEN.z);
    expect(inFrustum(planes(), meshBounds(cube()), outside, 2)).toBe(false);
  });

  it("treats a negative margin as none, rather than shrinking the box", () => {
    // `Math.max(0, margin)`: culling more aggressively than the geometry says is
    // not something a caller should be able to ask for by accident.
    const outside = at(OFF_SCREEN.x, OFF_SCREEN.y, OFF_SCREEN.z);
    expect(inFrustum(planes(), meshBounds(cube()), outside, -100)).toBe(false);
    expect(inFrustum(planes(), meshBounds(cube()), at(0, 0, -10), -100)).toBe(true);
  });
});
