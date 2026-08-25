/** View-frustum culling: which nodes the camera can possibly see.
 *
 *  A renderer without this draws every mesh in the scene every frame, however
 *  far behind the camera it is. That is fine for a scene of a dozen meshes and
 *  it is the wrong shape for a level: cost is set by how much of the WORLD
 *  exists rather than by how much of it is on screen, so a bigger level is
 *  slower everywhere, including in the corner the player is looking at.
 *
 *  ## What it does and does not buy
 *
 *  It removes DRAW CALLS and the vertex work behind them. It does nothing about
 *  overdraw: geometry that is on screen still shades every pixel it covers, and
 *  a scene that is slow because one huge surface fills the view is not helped by
 *  any of this. So the win scales with how much of a level is off screen —
 *  which, for a game that looks at one part of a level at a time, is most of it.
 *
 *  ## Bounds, and why they are cheap
 *
 *  Every mesh gets a local axis-aligned box, computed once from its positions
 *  and cached against `MeshData.version` so a rewritten mesh — a particle batch,
 *  say — recomputes and a static one never does.
 *
 *  A node's world box is that local box through its world matrix, by the
 *  standard centre/extent transform: the centre goes through the matrix as a
 *  point, and the half-extent through the matrix's absolute value as a vector.
 *  It is the tightest box that is still axis-aligned in world space, and for a
 *  rotated mesh it is bigger than the mesh — which only ever means an object is
 *  kept that could have been dropped, never the reverse.
 *
 *  ## The test
 *
 *  Six planes off the view-projection (Gribb & Hartmann: each plane is a row of
 *  the matrix added to or subtracted from the w row), and a box is out when it
 *  lies entirely behind any one of them. That is conservative in the corners —
 *  a box can be outside the frustum while straddling every plane — and the
 *  false keep costs one draw, where a false drop would be a hole in the world.
 */
import { Mat4 } from "../math/mat4.js";
import type { MeshData } from "./mesh.js";
/** A mesh's own box, in the space its positions are written in. */
export interface Bounds3D {
    /** Centre of the box. */
    cx: number;
    cy: number;
    cz: number;
    /** Half the box's size along each axis. */
    ex: number;
    ey: number;
    ez: number;
}
/** Six planes as `[a, b, c, d]` each, where `a·x + b·y + c·z + d < 0` is
 *  outside. Order is left, right, bottom, top, near, far — which nothing
 *  depends on, since a box has to clear all six. */
export type Frustum = Float32Array;
/** One mesh's local box, computed once per version of the mesh.
 *
 *  Null for a mesh with no vertices, which cannot be culled meaningfully and
 *  cannot be drawn either. */
export declare function meshBounds(mesh: MeshData): Bounds3D | null;
/** The six planes of a view-projection matrix, normalized so the plane test is
 *  a real distance rather than an arbitrary scale.
 *
 *  `zeroToOne` picks the depth convention, and it is not cosmetic: the NEAR
 *  plane is the one row that differs. OpenGL-style clip space keeps `-w <= z`,
 *  so its near plane is `w + z`; WebGPU's keeps `0 <= z`, so its near plane is
 *  `z` alone. Passing the wrong one culls geometry just in front of the camera,
 *  or fails to cull anything behind it — pass the same flag the projection was
 *  built with.
 *
 *  `out` is filled and returned, so a renderer keeps one array for the life of
 *  the frame loop. */
export declare function frustumPlanes(viewProj: Mat4 | Float32Array, out?: Frustum, zeroToOne?: boolean): Frustum;
/** Whether a mesh's local box, placed by `world`, is anywhere the frustum can
 *  see it.
 *
 *  Answers true for anything it cannot rule out — no bounds, no matrix, a
 *  degenerate transform — because the cost of keeping something needlessly is
 *  one draw call and the cost of dropping something wrongly is a hole in the
 *  scene. */
export declare function inFrustum(planes: Frustum, bounds: Bounds3D | null, world: Mat4 | Float32Array | undefined, 
/** Extra world units added to the box on every axis before testing.
 *
 *  Mostly a DIAGNOSTIC. Culling once dropped geometry that was plainly on
 *  screen, and a margin separates the two families of cause: if a generous
 *  margin fixes the picture, the box or the plane arithmetic is slightly
 *  wrong; if it does not, the box is in the wrong PLACE — a stale world
 *  matrix on a node placed after the matrices were solved — and no margin can
 *  save it.
 *
 *  **It has one honest production use**, and it is the third family: geometry
 *  that legitimately reaches outside the bounds its mesh declares, so that no
 *  arithmetic here is wrong and the box is in the right place for something
 *  the consumer no longer draws exactly. A skinned mesh is the extreme case
 *  and is exempted outright by both backends; a consumer that displaces
 *  vertices in a shader, or draws a sprite larger than the quad it is built
 *  from, is the case a margin is for. Left at zero in normal use. */
margin?: number): boolean;
