// ---------- Scene layer ----------
// The third way 3D and 2D meet, and the right one for a full-screen 3D game
// with a 2D HUD: two stacked canvases, the GL scene underneath and the app's
// existing 2D canvas on top, transparent.
//
// Why this and not the other two:
//
//   `UI.viewport3d`  blits the scene into the UI's 2D context. Correct for a
//                    view INSIDE a panel; at full screen it is a 1920×1080
//                    `drawImage` every frame, paid for nothing — the scene is
//                    behind all the UI anyway.
//   `createUiSurface` puts the UI on a quad. Correct for a diegetic panel; for
//                    a HUD it would upload a screen-sized texture every frame
//                    and then resample crisp text through a perspective
//                    divide, which is strictly worse than not doing it.
//   this             the browser composites two layers. No copy, no upload,
//                    HUD text at native DPR. The cost is that the scene is
//                    ALWAYS under all UI, which for a HUD is exactly right.
//
// The app must not paint its own background, or the 2D canvas is opaque and
// the scene never shows: create it with no `background` and the engine leaves
// the play area alone (`createApp`'s own rule), so the canvas stays clear.
//
// That cuts both ways, and it is the one thing to get right. "The engine leaves
// the play area alone" means it does not clear it EITHER — so a HUD drawn on
// the top canvas must erase itself, or every frame's text stacks on the last
// one's. Start the draw with `app.ctx.clearRect(0, 0, viewport.w, viewport.h)`.
// The symptom is a HUD that smears rather than one that is missing, which is
// why it is easy to mistake for a font problem.

import type { App } from "@src/engine/index.js";
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
export function attachSceneLayer(
  app: App,
  renderer: Renderer3D,
  opts: SceneLayerOptions = {},
): SceneLayer {
  let scale = Math.max(0.1, opts.resolutionScale ?? 1);
  const target = app.canvas;
  const layer = renderer.canvas;

  // Inherit the app canvas's own positioning rather than hard-coding it: a
  // page that opted out of `fullscreenCSS` and laid the canvas out itself must
  // still get the two aligned.
  const computed = getComputedStyle(target);
  layer.style.position = computed.position === "static" ? "absolute" : computed.position;
  layer.style.top = computed.top === "auto" ? "0" : computed.top;
  layer.style.left = computed.left === "auto" ? "0" : computed.left;
  layer.style.display = "block";
  layer.style.pointerEvents = "none"; // every event belongs to the UI canvas
  // Explicit and adjacent, so the ordering does not depend on document order
  // or on whatever a sample's stylesheet happens to say.
  layer.style.zIndex = String((Number(computed.zIndex) || 0) - 1);
  target.parentNode?.insertBefore(layer, target);

  function sync(): void {
    const vp = app.viewport;
    layer.style.width = `${vp.canvas.clientWidth || vp.w}px`;
    layer.style.height = `${vp.canvas.clientHeight || vp.h}px`;
    // The renderer's own logical size stays the app's logical size, so a
    // camera's aspect ratio is unaffected by `resolutionScale`; only the
    // backing store shrinks.
    renderer.resize(vp.w, vp.h, vp.dpr * scale);
  }
  sync();
  const off = app.onResize(sync);

  return {
    get resolutionScale() {
      return scale;
    },
    setResolutionScale(next: number) {
      scale = Math.max(0.1, next);
      sync();
    },
    detach() {
      off();
      layer.remove();
    },
  };
}
