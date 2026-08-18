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
    /** Build a mip chain for every smooth texture and sample it trilinearly.
     *
     *  Off by default, because it CHANGES THE PICTURE: a minified texture stops
     *  sampling its full-resolution texels and starts sampling a filtered
     *  average, which is the point — it is what removes the shimmer a texture
     *  minified across a large surface produces as the camera moves — but it is
     *  a different image, and softer at distance.
     *
     *  Orthogonal to `antialias`, which is multisampling: MSAA resolves GEOMETRY
     *  edges and does nothing at all for texture minification, since it runs the
     *  fragment shader once per pixel however many samples that pixel has. The
     *  two fix different aliasing and neither substitutes for the other.
     *
     *  `pixelated` textures are exempt: a sprite sheet asking for NEAREST is
     *  asking not to be filtered, and a mip chain is filtering.
     *
     *  Both backends honour it. WebGPU has no `generateMipmap`, so it builds the
     *  chain with a render pass per level instead — see `MIP_BLIT_WGSL` there.
     *  The two are required to draw the same frame, and a flag that only one of
     *  them read would be the plainest possible way to break that. */
    mipmaps?: boolean;
    /** Skip nodes the camera cannot see, and batch runs of one mesh+material into
     *  one instanced call.
     *
     *  **Both OFF by default, and that is a retreat rather than a design.** They
     *  were measured to work — 87% of a level's nodes culled, a run of draws
     *  folded into one — and then reported from play as geometry vanishing in
     *  plain sight and props turning black. Neither cause is understood yet, and a
     *  wrong picture is worse than a slow one, so they are behind a flag until
     *  each is verified against a real scene rather than against a test's idea of
     *  one. See `cull.ts` and `drawInstanced`. */
    frustumCulling?: boolean;
    instancing?: boolean;
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
