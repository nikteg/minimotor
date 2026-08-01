// ---------- 3D ----------
// Hardware-accelerated 3D, as a layer on top of the 2D engine rather than a
// replacement for it. The shape:
//
//   mesh.ts      geometry as plain typed arrays + primitives
//   scene.ts     a flat, JSON-safe node array with TRS transforms
//   camera.ts    an orbit camera and its matrices
//   animation.ts keyframe tracks over node transforms
//   renderer.ts  the backend-agnostic interface
//   webgl2.ts    the WebGL2 backend
//   webgpu.ts    the WebGPU backend
//
// Nothing here reaches into the 2D renderer, and the 2D renderer does not know
// this exists. The two meet in exactly one place — `UI.viewport3d`, which
// blits a rendered frame into the UI's 2D context so a 3D view behaves like a
// widget.
//
//   const renderer = await createRenderer3D();
//   const scene = createScene();
//   addNode(scene, node({ mesh: box(1), material: { color: [0.9, 0.5, 0.2, 1] } }));
//   const camera = createCamera();
//   // ...in draw:
//   UI.viewport3d({ renderer, scene, camera, interactive: true, h: 240 });

import { createWebGL2Renderer } from "./webgl2.js";
import type { Backend3D, Renderer3D } from "./renderer.js";
import type { WebGL2RendererOptions } from "./webgl2.js";

export * from "./mesh.js";
export * from "./scene.js";
export * from "./camera.js";
export * from "./animation.js";
export type { Backend3D, RenderOptions, RenderStats, Renderer3D } from "./renderer.js";
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
export async function createRenderer3D(opts: Renderer3DOptions = {}): Promise<Renderer3D> {
  const want = opts.backend ?? "auto";
  if (want === "webgl2") return createWebGL2Renderer(opts);

  const { createWebGPURenderer } = await import("./webgpu.js");
  if (want === "webgpu") return createWebGPURenderer(opts);

  try {
    return await createWebGPURenderer(opts);
  } catch {
    // Expected on Firefox and on older Safari — not worth a console warning
    // every time an app starts. Callers who care read `renderer.backend`.
    return createWebGL2Renderer(opts);
  }
}
