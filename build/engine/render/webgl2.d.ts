import type { SceneRenderer } from "./target.js";
export interface WebGL2RendererOptions {
    /** Overlay play-area colour. Cleared on the GL canvas each frame. */
    background?: string | null;
    /** When true, a missing WebGL2 context throws instead of returning null. */
    required?: boolean;
}
/** Create a WebGL2 scene renderer stacked under `overlay`, or `null` when
 *  WebGL2 is unavailable and `required` is not set. */
export declare function createWebGL2Renderer(overlay: HTMLCanvasElement, opts?: WebGL2RendererOptions): SceneRenderer | null;
