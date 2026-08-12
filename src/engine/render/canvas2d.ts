// ---------- Canvas2D scene adapter ----------
// The default renderer has no separate scene layer: `Draw.sprites` / `tiles` /
// `particles` keep their original Canvas2D loops in `draw.ts`. This no-op
// exists so the `SceneRenderer` interface has a canvas-side inhabitant; it is
// not wired by `createApp`.

import type { SceneRenderer } from "./target.js";
import type { Affine } from "./math.js";
import type { DrawSprite, DrawSpritesOptions } from "../draw.js";
import type { Rgba } from "./color.js";

export function createCanvas2DRenderer(): SceneRenderer {
  return {
    kind: "canvas",
    beginFrame() {},
    endFrame() {},
    resize() {},
    setTransform(_m: Affine) {},
    sprites(_list: Iterable<DrawSprite>, _opts?: DrawSpritesOptions) {},
    blitImage() {},
    fillQuad(_dx: number, _dy: number, _dw: number, _dh: number, _rgba: Rgba) {},
    destroy() {},
  };
}
