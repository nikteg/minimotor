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
    /** Draw into an offscreen target instead of the canvas. Default: the canvas.
     *
     *  The target owns its own size, so the projection is built from ITS aspect
     *  rather than the canvas's — a square reflection probe rendered by a wide
     *  renderer must not come out stretched. Everything else about the call is
     *  unchanged, `clear` included. */
    target?: RenderTarget3D;
    /** Draw into a RECTANGLE of the destination instead of all of it, in physical
     *  pixels from its TOP-LEFT — the same corner `RenderTarget3D.readPixels` reads
     *  from, so a rect and a readback agree without either backend's origin
     *  leaking out.
     *
     *  **What it is for: several views in one target.** An environment probe needs
     *  six faces from one point, and six targets means six samplers to bind. One
     *  target laid out as an atlas needs one. The projection is built from the
     *  RECT's aspect, so a square face in a wide atlas is square.
     *
     *  **`clear` still clears the whole destination, not the rect** — deliberately,
     *  and it is the one thing to know before laying out an atlas. WebGPU clears in
     *  the render pass's `loadOp`, which has no notion of a rectangle and cannot be
     *  confined by a scissor; matching that with a scissored clear on WebGL2 would
     *  give the same call two meanings on the two backends. So an atlas caller
     *  clears ONCE and renders every face after it with `clear: false`, which is
     *  the order it wants anyway. */
    viewport?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
/** An offscreen surface a scene can be drawn into.
 *
 *  **What this is for.** Every effect that needs the scene as an INPUT to
 *  itself — a mirror, a reflection probe, a security-camera monitor, a portal —
 *  needs somewhere to put a second render, and the canvas is already spoken for.
 *  Without one, the only reflections available are the faked kind `Material.glaze`
 *  computes from a reflected ray and a made-up sky, which is why that type's own
 *  note says a correct reflection "means rendering the scene again from the
 *  surface, and at that price the effect stops being worth having". This is the
 *  price. Whether it is worth paying is the caller's to decide per effect, and
 *  the answer differs: a probe rendered ONCE when a level loads is nearly free,
 *  while a mirror re-rendered every frame doubles a scene's draw calls.
 *
 *  **Sized in physical pixels**, not logical ones: a target is not on screen, so
 *  there is no device pixel ratio to apply and nothing to be crisp against. A
 *  caller that wants half-resolution asks for half the pixels.
 *
 *  Kept alive by the caller. Unlike a mesh — which is cached weakly, so an
 *  unreachable one is collected on its own — a target holds a framebuffer and
 *  two attachments that the GC cannot see, so `dispose` is the only thing that
 *  frees them. */
export interface RenderTarget3D {
    /** Physical width in pixels. */
    readonly width: number;
    /** Physical height in pixels. */
    readonly height: number;
    /** Re-allocate at a new size. Cheap and idempotent when nothing changed, so a
     *  caller tracking a widget's rect may call it every frame. */
    resize(width: number, height: number): void;
    /** Read the colour attachment back into `RGBA8` bytes, top row first.
     *
     *  For tests and for a caller that genuinely wants the pixels on the CPU —
     *  a thumbnail, a saved screenshot. It is a full pipeline stall on both
     *  backends and has no place in a frame loop; the point of a target is that
     *  the GPU keeps the result. */
    readPixels(): Promise<Uint8Array>;
    /** Free the framebuffer and its attachments. */
    dispose(): void;
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
    /** An offscreen surface this renderer can draw into — see `RenderTarget3D`.
     *
     *  Belongs to the renderer that made it: a target is a framebuffer in one
     *  context, and handing it to another renderer draws nothing. */
    createTarget(width: number, height: number): RenderTarget3D;
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
