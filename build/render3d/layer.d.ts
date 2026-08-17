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
    /** A ceiling on the display's device pixel ratio, for the backing store only.
     *
     *  **The arithmetic this exists for.** A scene's fill cost is
     *  `(dpr * resolutionScale)^2 * sampleCount` per logical pixel. A phone at
     *  dpr 3 with 4x multisampling is 36 samples for every logical pixel on
     *  screen, and every per-pixel cost in the frame — each texture fetch, the
     *  normal frame, the lighting, the tone curve — is paid against that number.
     *  Capping at 2 removes 56% of those pixels and leaves the geometry edges to
     *  MSAA, which is what was resolving them anyway.
     *
     *  Distinct from `resolutionScale`, though they multiply into the same
     *  figure: the scale is a fraction a player chooses, and this is a ceiling on
     *  a number the DEVICE reports. A desktop at dpr 1 or 2 is unaffected by a
     *  cap of 2, so this costs nothing where there was nothing to save.
     *
     *  Uncapped by default. */
    maxDpr?: number;
}
/** Put `renderer`'s canvas directly behind the app's, sized and DPR-matched to
 *  it, and keep them in step across resizes and orientation changes.
 *
 *  Returns a handle; call `detach` to tear it down. The renderer itself is not
 *  disposed — it may be serving `UI.viewport3d` widgets as well. */
export declare function attachSceneLayer(app: App, renderer: Renderer3D, opts?: SceneLayerOptions): SceneLayer;
