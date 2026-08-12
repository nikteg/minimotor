// ---------- Scene renderer ----------
// The GPU (or a no-op Canvas2D stand-in) that `Draw.sprite` / `Draw.sprites` /
// `Draw.tiles` / `Draw.particles` talk to when a scene layer is attached.
// Everything else (`Draw.rect`, text, UI) stays on the overlay 2D context.

import type { DrawSprite, DrawSpritesOptions } from "../draw.js";
import type { Affine } from "./math.js";
import type { Rgba } from "./color.js";

export type { Affine } from "./math.js";
export type { Rgba } from "./color.js";

/** Which path `createApp` actually bound. `"auto"` is never stored — it
 *  resolves to one of these. */
export type SceneRendererKind = "canvas" | "webgl";

export interface SceneRenderer {
  readonly kind: SceneRendererKind;
  beginFrame(): void;
  endFrame(): void;
  /** Match the overlay canvas's backing store and CSS box. */
  resize(): void;
  /** Camera / letterbox matrix applied to subsequent `sprites` / `blitImage`. */
  setTransform(m: Affine): void;
  sprites(list: Iterable<DrawSprite>, opts?: DrawSpritesOptions): void;
  blitImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    alpha?: number,
    tint?: Rgba,
  ): void;
  /** Solid quad in the current transform — colour-skin tiles and the particle
   *  `arc`/`fill` fallback. */
  fillQuad(dx: number, dy: number, dw: number, dh: number, rgba: Rgba): void;
  /** Axis-aligned clip in the current transform's user space. Pass `null` to
   *  disable. Replaces any previous clip (does not intersect). */
  setClip(rect: { x: number; y: number; w: number; h: number } | null): void;
  destroy(): void;
}
