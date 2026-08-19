/** The six views that fill a cube probe, and the atlas they fill.
 *
 * **Why this is a module and not six lines in a caller.** A cube probe is ONE
 * convention split across two places: the cameras that write the faces and the
 * shader that reads them (`glazeEnvUv`, in both backends). Get either half wrong
 * on its own and the reflection is scrambled in a way that looks like a bug in
 * the other half. Keeping the writing side here puts the convention next to its
 * own documentation, and `e2e/glaze-probe.spec.ts` measures the two halves
 * agreeing by reflecting six differently coloured walls.
 *
 * **The layout is a 3x2 atlas, `+X -X +Y` over `-Y +Z -Z`.** Six square faces in
 * one texture rather than six targets, because a material binds one sampler:
 * `Glaze.environment` is a single `RenderTarget3D`.
 *
 * **The eye is placed by moving the TARGET, not by zeroing the distance.**
 * `Camera3D` is an orbit camera — `cameraPosition` derives the eye from the
 * target, the yaw, the pitch and the distance — so a probe at `at` looking along
 * `d` is `target: at + d`, `distance: 1`, and the yaw and pitch that put the eye
 * back at `at`. The type's own comment suggests `distance: 0` for a free-fly
 * camera and that is a trap here: at zero the eye IS the target and `lookAt` has
 * no forward vector to build a basis from.
 */

import { createCamera } from "./camera.js";
import type { Camera3D } from "./camera.js";
import type { RenderTarget3D } from "./renderer.js";
import type { Vec3 } from "@src/math/vec3.js";

/** Cells across and down the atlas. */
export const CUBE_PROBE_COLUMNS = 3;
export const CUBE_PROBE_ROWS = 2;

/** One face: where it looks, and which way is up while it looks there.
 *
 * The four side faces take the world's own up. The two vertical faces cannot —
 * their forward IS the up vector, and `lookAt` needs two directions that are not
 * parallel — so they borrow Z, which is the ordinary cube-map choice and the
 * reason those two faces are the ones a hand-written probe usually gets wrong. */
const FACES: readonly { forward: Vec3; up: Vec3 }[] = [
  { forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { forward: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  { forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  { forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
];

/** One face of a probe: hand both straight to `render`. */
export interface CubeProbeView {
  camera: Camera3D;
  viewport: { x: number; y: number; width: number; height: number };
}

/** The six renders that fill `target` with a cube probe seen from `at`.
 *
 * ```ts
 * const views = cubeProbeViews(probe, { x: 0, y: 2, z: 0 });
 * views.forEach(({ camera, viewport }, face) =>
 *   renderer.render(scene, camera, { target: probe, viewport, clear: face === 0 }),
 * );
 * ```
 *
 * **`clear` on the first face only**, as above: a clear covers the whole
 * destination rather than the rectangle — see `RenderOptions.viewport` — so
 * clearing on every face would leave nothing but the last one.
 *
 * The faces are square when the target is `3n x 2n`. Any other shape still fills
 * the atlas, and `glazeEnvUv` still reads it, but the faces are then stretched
 * against a 90-degree field of view and the reflection is subtly wrong at the
 * seams. The caller owns the size, so this does not police it. */
export function cubeProbeViews(
  target: RenderTarget3D,
  at: Vec3,
  options: { near?: number; far?: number } = {},
): CubeProbeView[] {
  const width = Math.max(1, Math.floor(target.width / CUBE_PROBE_COLUMNS));
  const height = Math.max(1, Math.floor(target.height / CUBE_PROBE_ROWS));
  return FACES.map((face, index) => ({
    camera: createCamera({
      // A quarter turn, which is what makes six faces meet without a gap.
      fov: Math.PI / 2,
      // The eye lands on `at`: see the header.
      target: { x: at.x + face.forward.x, y: at.y + face.forward.y, z: at.z + face.forward.z },
      distance: 1,
      yaw: Math.atan2(-face.forward.x, -face.forward.z),
      pitch: Math.asin(Math.max(-1, Math.min(1, -face.forward.y))),
      up: face.up,
      near: options.near ?? 0.05,
      far: options.far ?? 500,
    }),
    viewport: {
      x: (index % CUBE_PROBE_COLUMNS) * width,
      y: Math.floor(index / CUBE_PROBE_COLUMNS) * height,
      width,
      height,
    },
  }));
}
