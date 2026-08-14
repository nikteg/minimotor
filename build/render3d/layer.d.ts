import type { App } from "../engine/index.js";
import type { Renderer3D } from "./renderer.js";
/** A live scene layer. */
export interface SceneLayer {
    /** Render the scene at a new fraction of the display resolution, effective
     *  immediately. The 2D HUD on the canvas above is unaffected, which is the
     *  whole appeal of the knob: a game can drop the world to 0.6 and keep its
     *  text sharp. */
    setResolutionScale(scale: number): void;
    /** The current resolution scale. */
    readonly resolutionScale: number;
    /** Stop syncing and remove the scene canvas from the document. */
    detach(): void;
}
/** How to attach a scene layer. */
export interface SceneLayerOptions {
    /** Render the scene at a fraction of the display resolution and let the
     *  browser scale it up — the standard 3D quality knob. 0.75 is a large
     *  saving for a small softening; the HUD is unaffected either way, because
     *  it is on the other canvas. Default 1. */
    resolutionScale?: number;
}
/** Put `renderer`'s canvas directly behind the app's, sized and DPR-matched to
 *  it, and keep them in step across resizes and orientation changes.
 *
 *  Returns a handle; call `detach` to tear it down. The renderer itself is not
 *  disposed — it may be serving `UI.viewport3d` widgets as well. */
export declare function attachSceneLayer(app: App, renderer: Renderer3D, opts?: SceneLayerOptions): SceneLayer;
