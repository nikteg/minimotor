// ---------- Sprite pre-rendering ----------
// Pre-render expensive drawing operations (shadowBlur, gradients) to an
// offscreen canvas once, then blit with drawImage each frame.

export interface SpriteCanvas extends HTMLCanvasElement {
  /** Logical size in CSS pixels (the backing store is DPR × logicalSize) */
  logicalSize: number;
}

const cache = new Map<string, SpriteCanvas>();
const layerCache = new Map<string, HTMLCanvasElement>();

/** Get or create a pre-rendered sprite canvas keyed by `cacheKey`.
 *  `size` is the logical size in CSS pixels.
 *  `dpr` is the device pixel ratio for sharp rendering.
 *  `draw` is called once with the offscreen 2D context (already DPR-scaled
 *  and translated to center). */
export function getSprite(
  cacheKey: string,
  size: number,
  dpr: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): SpriteCanvas {
  let sprite = cache.get(cacheKey);
  if (!sprite) {
    sprite = document.createElement("canvas") as SpriteCanvas;
    sprite.width = Math.ceil(size * dpr);
    sprite.height = Math.ceil(size * dpr);
    sprite.logicalSize = size;
    const ctx = sprite.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);
    draw(ctx);
    cache.set(cacheKey, sprite);
  }
  return sprite;
}

/** Get or create a pre-rendered offscreen canvas of arbitrary width/height,
 *  keyed by `cacheKey`. Unlike getSprite, the origin stays at the top-left
 *  (no centering) and width/height are independent — use it for wide strips,
 *  panels or full backgrounds rather than square sprites. The context is
 *  DPR-scaled, so `draw` works in logical (CSS) pixels.
 *
 *  Cache by everything the baked pixels depend on (e.g. `theme + ":" + w`) so a
 *  resize or theme change re-bakes instead of returning a stale layer. */
export function getLayer(
  cacheKey: string,
  w: number,
  h: number,
  dpr: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  let layer = layerCache.get(cacheKey);
  if (!layer) {
    layer = document.createElement("canvas");
    layer.width = Math.max(1, Math.ceil(w * dpr));
    layer.height = Math.max(1, Math.ceil(h * dpr));
    const ctx = layer.getContext("2d")!;
    ctx.scale(dpr, dpr);
    draw(ctx);
    layerCache.set(cacheKey, layer);
  }
  return layer;
}

/** Clear the sprite AND layer caches (call on resize or theme change if needed). */
export function clearSpriteCache(): void {
  cache.clear();
  layerCache.clear();
}
