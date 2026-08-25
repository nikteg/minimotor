import type { Renderer3D } from "./renderer.js";
/** How to build a WebGPU renderer. */
export interface WebGPURendererOptions {
    /** Skip drawing nodes the camera cannot see. Default ON — see the WebGL2
     *  backend, which carries the reasoning and the measurement. */
    frustumCulling?: boolean;
    /** World units added to every culled box before testing.
     *
     *  **Parity with the WebGL2 backend, which has taken this since it was
     *  written.** This one accepted the option nowhere and passed nothing, so a
     *  consumer that set it saw it work on one backend and do nothing on the
     *  other — and WebGPU is the default device.
     *
     *  Mostly a diagnostic: a margin that fixes a picture means the box or the
     *  plane arithmetic is slightly tight, and one that does not means the box is
     *  in the wrong PLACE. It has one honest production use, which is a consumer
     *  whose geometry legitimately reaches outside its own bounds — see
     *  `inFrustum`. */
    cullMargin?: number;
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
