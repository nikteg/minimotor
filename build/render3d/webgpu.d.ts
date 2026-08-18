import type { Renderer3D } from "./renderer.js";
export interface WebGPURendererOptions {
    /** Build a mip chain for every smooth texture and sample it trilinearly.
     *
     *  The WebGL2 backend's option, honoured here so the two draw the same frame
     *  — which is a rule this engine holds itself to rather than a nicety. WebGPU
     *  has no `generateMipmap`, so the chain is produced the way WebGPU expects:
     *  a render pass per level, each sampling the level above it. That is why the
     *  textures are created with `RENDER_ATTACHMENT` usage.
     *
     *  Off by default, because it changes the picture: a minified texture stops
     *  sampling full-resolution texels and starts sampling a filtered average,
     *  which removes shimmer and softens distance. `pixelated` textures are
     *  exempt — NEAREST is a request not to be filtered. */
    mipmaps?: boolean;
    /** See the WebGL2 backend: off by default until the reports of vanishing
     *  geometry are understood. */
    frustumCulling?: boolean;
    canvas?: HTMLCanvasElement;
    width?: number;
    height?: number;
    dpr?: number;
    /** Multisampling. On by default, matching the WebGL2 backend — a context
     *  attribute there, four explicit objects here: the pass draws into an
     *  offscreen 4x colour texture and resolves it into the swap chain. */
    antialias?: boolean;
    /** Ask for a high-performance adapter (the discrete GPU on a laptop that has
     *  both). Default `"high-performance"`; `"low-power"` for a small preview
     *  that is not worth spinning a dGPU up for. */
    powerPreference?: GPUPowerPreference;
    /** Collect timestamp-query samples. Disabled by default because readback
     *  instrumentation adds overhead. */
    gpuTiming?: boolean;
}
/** Whether this browser exposes WebGPU at all. A synchronous, cheap check —
 *  it does not prove an adapter can be acquired, only that asking is worth
 *  the round trip. */
export declare function isWebGPUAvailable(): boolean;
/** Create a WebGPU renderer. Rejects when WebGPU is missing, no adapter can be
 *  acquired, or device creation fails — `createRenderer3D` catches that and
 *  falls back to WebGL2. */
export declare function createWebGPURenderer(opts?: WebGPURendererOptions): Promise<Renderer3D>;
