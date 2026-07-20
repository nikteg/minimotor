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
 *  `dpr` is the device pixel ratio for sharp rendering. It is part of the real
 *  cache key, so dragging the window between 1× and 2× monitors re-bakes
 *  sharp sprites automatically instead of serving stale ones.
 *  `draw` is called once with the offscreen 2D context (already DPR-scaled
 *  and translated to center). */
export function getSprite(
  cacheKey: string,
  size: number,
  dpr: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): SpriteCanvas {
  cacheKey += "@" + dpr;
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
 *  resize or theme change re-bakes instead of returning a stale layer. `dpr`
 *  is folded into the key automatically. */
export function getLayer(
  cacheKey: string,
  w: number,
  h: number,
  dpr: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  cacheKey += "@" + dpr;
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

// ---------- Sprite-sheet baking ----------
// Build the grid sheet an `Anim.sheet` slices — either from a per-frame draw
// callback (procedural art) or by packing separate frame images — plus a helper
// to measure a sprite's real opaque bounds (trim transparent padding).

/** Options for `bakeSheet` / `composeSheet`. */
export interface SheetOptions {
  /** Grid columns; frames fill row-major. Default: all frames on one row. */
  cols?: number;
}

/** Bake `count` frames into one grid sprite-sheet canvas, ready to hand to
 *  `Anim.sheet(canvas, { fw, fh, cols })`. `draw(ctx, i)` renders frame `i`
 *  with the context saved/restored and translated to that cell's **centre**
 *  (so rotating/scaling procedural art is symmetric); the cell spans
 *  `[-fw/2, fw/2] × [-fh/2, fh/2]`. Frames fill left-to-right, top-to-bottom.
 *
 *    const sheet = Sprites.bakeSheet(40, 40, 16, (ctx, i) => {
 *      ctx.rotate((i / 16) * Math.PI * 2);
 *      ctx.fillStyle = "#5fd8ff";
 *      ctx.fillRect(-8, -8, 16, 16);
 *    });
 *    const spin = Anim.sheet(sheet, { fw: 40, fh: 40, cols: 16, fps: 14 }); */
export function bakeSheet(
  fw: number,
  fh: number,
  count: number,
  draw: (ctx: CanvasRenderingContext2D, index: number) => void,
  opts: SheetOptions = {},
): HTMLCanvasElement {
  const cols = Math.max(1, opts.cols ?? count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const cv = document.createElement("canvas");
  cv.width = fw * cols;
  cv.height = fh * rows;
  const ctx = cv.getContext("2d")!;
  for (let i = 0; i < count; i++) {
    ctx.save();
    ctx.translate((i % cols) * fw + fw / 2, Math.floor(i / cols) * fh + fh / 2);
    draw(ctx, i);
    ctx.restore();
  }
  return cv;
}

/** Pack same-size frame images into one grid sprite-sheet canvas — the common
 *  "N separate PNGs → one sheet for `Anim.sheet`" case. Frame size defaults to
 *  the first image's dimensions; pass `cols` for a grid (default: one row).
 *
 *    const sheet = Sprites.composeSheet([idle0, idle1, idle2, idle3]);
 *    const idle = Anim.sheet(sheet, { fw: 32, fh: 32, cols: 4, fps: 6 }); */
export function composeSheet(
  images: Array<CanvasImageSource & { width: number; height: number }>,
  opts: SheetOptions & { fw?: number; fh?: number } = {},
): HTMLCanvasElement {
  if (images.length === 0) throw new Error("Sprites.composeSheet: no frames");
  const fw = opts.fw ?? images[0].width;
  const fh = opts.fh ?? images[0].height;
  return bakeSheet(fw, fh, images.length, (ctx, i) => ctx.drawImage(images[i], -fw / 2, -fh / 2), {
    cols: opts.cols,
  });
}

/** The opaque (alpha > `threshold`) bounding box of an image/canvas, in pixels.
 *  Use it to trim transparent padding — e.g. seat a sprite on a surface by its
 *  real base (`(box.y + box.h) / img.height`) instead of the frame edge.
 *  Returns the full rect when nothing clears the threshold. Reads pixels, so the
 *  source must be same-origin / untainted. */
export function contentBounds(
  source: CanvasImageSource & { width: number; height: number },
  threshold = 8,
): { x: number; y: number; w: number; h: number } {
  const w = source.width;
  const h = source.height;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
