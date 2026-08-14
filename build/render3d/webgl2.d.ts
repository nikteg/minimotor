import type { Renderer3D } from "./renderer.js";
/** How to build a WebGL2 renderer. */
export interface WebGL2RendererOptions {
    /** Render into this canvas instead of a fresh one — for a scene layer that
     *  is already in the document. */
    canvas?: HTMLCanvasElement;
    /** Multisampling. On by default: at preview sizes the jaggies on a silhouette
     *  are the single most obvious quality difference, and MSAA is nearly free
     *  compared with supersampling. */
    antialias?: boolean;
    /** Preserve the default framebuffer after compositing. This is expensive;
     *  it remains enabled by default for compatibility. */
    preserveDrawingBuffer?: boolean;
    /** Collect GPU timer-query samples. Disabled by default because queries add
     *  instrumentation overhead. */
    gpuTiming?: boolean;
    /** Initial logical size. */
    width?: number;
    height?: number;
    /** Device pixel ratio for the backing store. */
    dpr?: number;
}
/** Create a WebGL2 renderer, or throw if the context cannot be created.
 *  Callers that want a graceful fallback should use `createRenderer3D`, which
 *  reports failure instead. */
export declare function createWebGL2Renderer(opts?: WebGL2RendererOptions): Renderer3D;
