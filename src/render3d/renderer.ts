// ---------- Renderer interface ----------
// The seam between "a scene" and "a GPU". Two backends implement it — WebGL2
// and WebGPU — and the rest of the engine never learns which one it has.
//
// A renderer OWNS ITS OWN CANVAS and draws the whole of it. That one decision
// is what lets the same object serve both uses:
//
//   - a full-screen scene layer, sized to the viewport and stacked UNDER the
//     app's 2D canvas, composited by the browser with no readback;
//   - a viewport inside the UI, sized to a widget's rect and blitted into the
//     UI's 2D context, so it clips, scrolls and z-orders like any other widget.
//
// The second costs one `drawImage` of a small canvas per frame. That is a real
// cost and the reason the plan rules it out for a FULL-SCREEN scene — but for
// a 200×200 panel it is far cheaper than the alternative (hole-punching the UI
// and fighting the compositor for z-order), and it is the only way a 3D view
// can sit correctly under a modal.

import type { Camera3D } from "./camera.js";
import type { Scene3D } from "./scene.js";

/** Which GPU API is behind a renderer. `createRenderer3D` picks one; nothing
 *  above this line should branch on it except to report it. */
export type Backend3D = "webgl2" | "webgpu";

/** Options for one `render` call. */
export interface RenderOptions {
  /** Clear before drawing. Default true. False composites onto whatever the
   *  canvas already holds — for drawing two scenes into one target. */
  clear?: boolean;
}

/** A GPU-backed 3D renderer over its own canvas. */
export interface Renderer3D {
  /** Which backend this is. */
  readonly backend: Backend3D;
  /** The canvas being rendered into — stack it, or blit from it. */
  readonly canvas: HTMLCanvasElement;
  /** Clip-space depth range of this backend: `false` for WebGL2's −1…1,
   *  `true` for WebGPU's 0…1. Pass it to `viewProjection`; do not guess. */
  readonly clipZeroToOne: boolean;
  /** Logical width in CSS pixels (the backing store is this × `dpr`). */
  readonly width: number;
  /** Logical height in CSS pixels. */
  readonly height: number;
  /** Resize the canvas. Cheap and idempotent when nothing changed, so it is
   *  safe to call every frame from a widget whose rect may move. */
  resize(width: number, height: number, dpr?: number): void;
  /** Draw a scene. Call `updateWorldMatrices` first — the renderer reads
   *  `node.world` and does not compute it, so that a caller animating a
   *  hierarchy pays for the walk once even when drawing it several times. */
  render(scene: Scene3D, camera: Camera3D, opts?: RenderOptions): void;
  /** Drop a mesh's GPU buffers. Optional housekeeping: meshes are cached
   *  weakly, so a mesh that becomes unreachable is collected on its own. Call
   *  it when a large mesh is replaced and the collection should not wait. */
  release(mesh: object): void;
  /** Release the context and every GPU resource. */
  dispose(): void;
  /** Counts from the LAST `render` call. The same object every frame — read
   *  it, don't retain it. */
  readonly stats: RenderStats;
}

/** Counts from the last frame — what to put on a debug HUD when a scene is
 *  slower than it looks like it should be. */
export interface RenderStats {
  /** Draw calls issued. */
  drawCalls: number;
  /** Triangles submitted (before any GPU-side culling). */
  triangles: number;
  /** Nodes skipped because they, or a parent, were hidden. */
  culled: number;
}
