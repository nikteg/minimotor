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
    /** Skip drawing nodes the camera cannot see. Default ON.
     *
     *  Cost otherwise follows the size of the WORLD rather than the size of the
     *  view, so a bigger level is slower everywhere, including in the corner the
     *  player is looking at. MEASURED on a consumer's level: 416 drawable nodes
     *  down to 91 draws.
     *
     *  **It was once blamed for geometry vanishing in plain sight and it was
     *  innocent** — the culprit was an element-buffer rebind that repointed one
     *  mesh's indices at another, shipped in the same batch. Verified since by
     *  sweeping 32 camera angles over a real level and finding no node dropped
     *  while any of its own vertices were on screen.
     *
     *  The one case this cannot see is a node placed AFTER the world matrices are
     *  solved: it would be tested against a stale matrix. Nothing in the engine
     *  does that, but a consumer that does has this switch. */
    frustumCulling?: boolean;
    /** DIAGNOSTIC ONLY: world units added to every culled box before testing. A
     *  margin that fixes the picture means the arithmetic is slightly tight; a
     *  margin that does not means the box is in the wrong PLACE. */
    cullMargin?: number;
    /** Build a mip chain for every smooth texture and sample it trilinearly.
     *
     *  Off by default, because it CHANGES THE PICTURE: a minified texture stops
     *  sampling its full-resolution texels and starts sampling a filtered
     *  average, which is what removes the shimmer a texture minified across a
     *  large surface produces as the camera moves — and it is a different image,
     *  softer at distance.
     *
     *  Orthogonal to `antialias`, which is multisampling: MSAA resolves GEOMETRY
     *  edges and does nothing for texture minification, since the fragment shader
     *  runs once per pixel however many samples that pixel has.
     *
     *  `pixelated` textures are exempt: a sprite sheet asking for NEAREST is
     *  asking not to be filtered, and a mip chain is filtering. */
    mipmaps?: boolean;
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
