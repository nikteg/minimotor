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
/** Resize behavior for a renderer serving several UI viewports. */
export interface ResizeOptions {
    /** Keep a larger backing store instead of reallocating it smaller. */
    retainBackingStore?: boolean;
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
    /** Physical width written by the most recent render. */
    readonly renderWidth: number;
    /** Physical height written by the most recent render. */
    readonly renderHeight: number;
    /** Resize the canvas. Cheap and idempotent when nothing changed, so it is
     *  safe to call every frame from a widget whose rect may move. */
    resize(width: number, height: number, dpr?: number, options?: ResizeOptions): void;
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
    /** Aggregate counters for all renders since the last `consumeFrameStats`.
     *  The performance monitor consumes these after the app draw completes. */
    consumeFrameStats(): RenderFrameStats;
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
/** Aggregate counters for one app frame. A shared renderer may render several
 *  UI viewports before the frame ends, so this is distinct from `RenderStats`. */
export interface RenderFrameStats extends RenderStats {
    /** Number of viewport/scene render calls. */
    viewports: number;
    /** CPU time spent encoding/submitting those renders, in milliseconds. */
    cpuMs: number;
    /** GPU execution time when timestamp queries are supported. */
    gpuMs?: number;
}
