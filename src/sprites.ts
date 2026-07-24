// ---------- Sprite pre-rendering ----------
// Pre-render expensive drawing operations (shadowBlur, gradients) to an
// offscreen canvas once, then blit with drawImage each frame.

import { lruCache } from "./cache.js";
import { component, type Component, type Ecs } from "./ecs/index.js";
import type { DrawSprite } from "./engine/index.js";

/** An offscreen canvas pre-rendered for blitting, tagged with its `logicalSize`. */
export interface SpriteCanvas extends HTMLCanvasElement {
  /** Logical size in CSS pixels (the backing store is DPR × logicalSize) */
  logicalSize: number;
}

const cache = new Map<string, SpriteCanvas>();
const layerCache = lruCache<HTMLCanvasElement>(16); // layers are big; keep only the recent few

// Last DPR any bake was requested at. A change (window dragged between 1×
// and 2× monitors) strands every entry baked for the old DPR — sweep them so
// the caches don't hold both worlds forever. The "@<dpr>" key suffix makes
// stale entries checkable.
let lastDpr: number | undefined;

function sweepOtherDpr(dpr: number): void {
  if (dpr === lastDpr) return;
  lastDpr = dpr;
  const keep = "@" + dpr;
  for (const key of cache.keys()) if (!key.endsWith(keep)) cache.delete(key);
  for (const [key] of layerCache.entries()) if (!key.endsWith(keep)) layerCache.delete(key);
}

/** Get or create a pre-rendered sprite canvas keyed by `cacheKey`.
 *  `size` is the logical size in CSS pixels. It is folded into the real cache
 *  key, so two call sites sharing a key at different sizes each get their own
 *  bake instead of the first one's canvas.
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
  sweepOtherDpr(dpr);
  cacheKey += "@" + size + "@" + dpr;
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
 *  is folded into the key automatically.
 *
 *  The layer cache is a small LRU (16 entries) — layers are full-size canvases,
 *  so churning many distinct keys evicts the least recently used bake. */
export function getLayer(
  cacheKey: string,
  w: number,
  h: number,
  dpr: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  sweepOtherDpr(dpr);
  cacheKey += "@" + dpr;
  let layer = layerCache.get(cacheKey); // an LRU get refreshes recency
  if (!layer) {
    layer = document.createElement("canvas");
    layer.width = Math.max(1, Math.ceil(w * dpr));
    layer.height = Math.max(1, Math.ceil(h * dpr));
    const ctx = layer.getContext("2d")!;
    ctx.scale(dpr, dpr);
    draw(ctx);
    layerCache.set(cacheKey, layer); // evicts the oldest bake beyond the cap
  }
  return layer;
}

const tintCache = new WeakMap<
  HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  Map<string, HTMLCanvasElement>
>();

/** A solid-`color` silhouette of `source` — the same opaque shape, flat-filled.
 *  Draw it over the original at a fading alpha for a hit "white flash" (pair
 *  the alpha with `Goodies.flash`), or use it for damage tints and team colors.
 *  Cached per (source, color), so call it every frame freely.
 *
 *    ctx.drawImage(frame, x, y);
 *    ctx.globalAlpha = flash.value;
 *    ctx.drawImage(Sprites.tint(frame, "#fff"), x, y); // same dest rect as `frame`
 *    ctx.globalAlpha = 1; */
export function tint(
  source: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  color: string,
): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil("naturalWidth" in source ? source.naturalWidth : source.width));
  const h = Math.max(
    1,
    Math.ceil("naturalHeight" in source ? source.naturalHeight : source.height),
  );
  let byColor = tintCache.get(source);
  if (!byColor) {
    byColor = new Map();
    tintCache.set(source, byColor);
  }
  const key = `${color}@${w}x${h}`;
  let out = byColor.get(key);
  if (!out) {
    out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(source, 0, 0, w, h);
    // Keep only the pixels the sprite already covers, recolored flat.
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    byColor.set(key, out);
  }
  return out;
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

/** Options for `atlas` / `packAtlas`. */
export interface AtlasOptions {
  /** Grid columns; cells fill row-major. Default: all cells on one row. */
  cols?: number;
  /** Where each cell's draw origin sits. `"top-left"` (default) puts (0,0) at
   *  the cell's top-left corner, matching how you draw everything else on a
   *  canvas — and how tileset cells are laid out (slice the result with
   *  `Tiles.set`). `"center"` puts (0,0) at the cell centre — the cell spans
   *  `[-fw/2, fw/2] × [-fh/2, fh/2]` — so rotating or scaling a procedural
   *  animation frame in place stays symmetric. */
  origin?: "top-left" | "center";
}

/** Bake `count` cells into one grid atlas canvas — a texture atlas / sprite
 *  sheet — so you never hand-roll `document.createElement` + `getContext`.
 *  Slice the result with `Tiles.set` (named skin cells for `Draw.tiles`) or
 *  `Anim.sheet` (named animation states). `draw(ctx, i)` renders
 *  cell `i` with the context saved/restored and translated to that cell
 *  (top-left origin by default — see `AtlasOptions.origin`). Cells fill
 *  left-to-right, top-to-bottom. The canvas is 1:1 (no DPR scaling):
 *  `Tiles.set`/`Anim.sheet` blit `fw × fh` per cell and handle their own
 *  crisp compositing.
 *
 *    // A tileset (default top-left origin):
 *    const img = Sprites.atlas(24, 24, 3, (g, i) => {
 *      g.fillStyle = ["#69db7c", "#7a5230", "#b0575a"][i];
 *      g.fillRect(0, 0, 24, 24);
 *    });
 *    const tiles = Tiles.set(img, { size: 24, names: { grass: [0, 0], dirt: [1, 0], brick: [2, 0] } });
 *
 *    // Rotatable animation frames (centre origin):
 *    const spin = Sprites.atlas(40, 40, 16, (ctx, i) => {
 *      ctx.rotate((i / 16) * Math.PI * 2);
 *      ctx.fillStyle = "#5fd8ff";
 *      ctx.fillRect(-8, -8, 16, 16);
 *    }, { origin: "center" });
 *    const sheet = Anim.sheet(spin, {
 *      frame: { w: 40, h: 40 },
 *      states: { spin: { row: 0, frames: 16, fps: 14 } },
 *    }); */
export function atlas(
  fw: number,
  fh: number,
  count: number,
  draw: (ctx: CanvasRenderingContext2D, index: number) => void,
  opts: AtlasOptions = {},
): HTMLCanvasElement {
  const cols = Math.max(1, opts.cols ?? count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const offX = opts.origin === "center" ? fw / 2 : 0;
  const offY = opts.origin === "center" ? fh / 2 : 0;
  const cv = document.createElement("canvas");
  cv.width = fw * cols;
  cv.height = fh * rows;
  const ctx = cv.getContext("2d")!;
  for (let i = 0; i < count; i++) {
    ctx.save();
    ctx.translate((i % cols) * fw + offX, Math.floor(i / cols) * fh + offY);
    draw(ctx, i);
    ctx.restore();
  }
  return cv;
}

/** Pack same-size images into one grid atlas canvas — the common "N separate
 *  PNGs → one sheet" case. Frame size defaults to the first image's
 *  dimensions; pass `cols` for a grid (default: one row).
 *
 *    const img = Sprites.packAtlas([idle0, idle1, idle2, idle3]);
 *    const sheet = Anim.sheet(img, {
 *      frame: { w: 32, h: 32 },
 *      states: { idle: { row: 0, frames: 4, fps: 6 } },
 *    }); */
export function packAtlas(
  images: Array<CanvasImageSource & { width: number; height: number }>,
  opts: { cols?: number; fw?: number; fh?: number } = {},
): HTMLCanvasElement {
  if (images.length === 0) throw new Error("Sprites.packAtlas: no frames");
  const fw = opts.fw ?? images[0].width;
  const fh = opts.fh ?? images[0].height;
  return atlas(fw, fh, images.length, (ctx, i) => ctx.drawImage(images[i], 0, 0), {
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

// ---------- The standard Sprite component (ECS integration) ----------
// The sprite component + its renderer live OUTSIDE the ECS core: the ECS is a
// content-agnostic data container, and rendering is a rendering concern. Attach
// `Sprites.Sprite` to entities, then blit the store with
// `Draw.sprites(ecs.dense(Sprites.Sprite), { alpha, view })`. Data never draws
// itself — the ECS holds it, `Draw` renders it, and neither imports the other.

/** The standard sprite component's data: position + texture + presentation.
 *  Structurally identical to `DrawSprite` (what `Draw.sprites` consumes), so a
 *  Sprite store drops straight into the renderer with no adapter. */
export type SpriteData = DrawSprite;

/** The standard sprite component. Bake a texture with `Sprites.getSprite` (or
 *  load an image), attach `Sprites.Sprite.with({ x, y, img })`, then blit the
 *  store with `Draw.sprites(ecs.dense(Sprites.Sprite))`. It's just a normal
 *  component — the ECS gives it no special treatment. */
export const Sprite: Component<SpriteData> = component<SpriteData>("Sprite");

/** Register the per-step interpolation snapshot for the `Sprite` store on
 *  `ecs`: each update it records every sprite's current `x`/`y` into `px`/`py`
 *  BEFORE your systems move them, so `Draw.sprites(list, { alpha: Loop.alpha })`
 *  can draw one step behind and interpolate — smooth motion on 90/120/144 Hz
 *  displays. Opt-in (skip it and sprites simply aren't interpolated), and it
 *  must run before your movement systems, so call it right after
 *  `ECS.create()`, before registering those. When you teleport a sprite, reset
 *  `px`/`py` alongside `x`/`y` or it streaks for one frame. */
export function interpolate(ecs: Ecs): void {
  ecs.system("sprite-interpolate", (w) => {
    for (const s of w.dense(Sprite)) {
      s.px = s.x;
      s.py = s.y;
    }
  });
}
