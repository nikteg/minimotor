import type { Backend3D, Renderer3D } from "./renderer.js";
import type { WebGL2RendererOptions } from "./webgl2.js";
export * from "./mesh.js";
export * from "./obj.js";
export * from "./scene.js";
export * from "./camera.js";
export * from "./cull.js";
export { attachSceneLayer } from "./layer.js";
export type { SceneLayer, SceneLayerOptions } from "./layer.js";
export * from "./animation.js";
export * from "./particles.js";
export * from "./gltf.js";
export { isGlb, parseGlb, type GlbContainer } from "./glb.js";
export { createUiSurface, intersectQuad, pointerRay, type Ray, type UiSurface, type UiSurfaceDrawOptions, type UiSurfaceOptions, } from "./ui-surface.js";
export type { Backend3D, RenderFrameStats, RenderOptions, RenderStats, Renderer3D, ResizeOptions, } from "./renderer.js";
export { createWebGL2Renderer } from "./webgl2.js";
export type { WebGL2RendererOptions } from "./webgl2.js";
export { createWebGPURenderer, isWebGPUAvailable } from "./webgpu.js";
export type { WebGPURendererOptions } from "./webgpu.js";
/** How to create a renderer, and which backend to prefer. */
export interface Renderer3DOptions extends WebGL2RendererOptions {
    /** Which backend to try first.
     *
     *  - `"auto"` (default) prefers WebGPU when the browser has it and falls
     *    back to WebGL2. WebGPU wins on draw-call overhead and is the only path
     *    to compute; WebGL2 is the one that works everywhere today.
     *  - A specific backend fails rather than falling back, which is what a
     *    test or a benchmark comparing the two wants. */
    backend?: Backend3D | "auto";
}
/** Create the best available 3D renderer.
 *
 *  Async because WebGPU adapter and device acquisition are — there is no
 *  synchronous way to ask whether a usable GPU exists. Await it once at
 *  startup and hand the result to every `UI.viewport3d`; one renderer serves
 *  any number of viewports.
 *
 *  Throws only when NO backend is available (WebGL2 missing as well, which
 *  means a browser older than 2017 or a lost context). A `backend` of `"auto"`
 *  never fails just because WebGPU is missing. */
export declare function createRenderer3D(opts?: Renderer3DOptions): Promise<Renderer3D>;
