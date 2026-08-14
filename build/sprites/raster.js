// ---------- Sprite pre-rendering ----------
// Pre-render expensive drawing operations (shadowBlur, gradients) to an
// offscreen canvas once, then blit with drawImage each frame.
import { lruCache } from "../cache/lruCache.js";
import { scratchCanvas, scratchContext } from "../engine/offscreen.js";
export { bumpScratch, scratchGeneration } from "../engine/offscreen.js";
// Both caches have an OPEN key space — size, dpr and any caller-supplied
// discriminator fold into the key — so both are bounded. Baking at a size
// derived from an animating value (a pulsing radius, a zoom-derived size)
// would otherwise pile up offscreen canvases forever. Sprites are small, so
// they get a roomy cap; layers are full-size, so only the recent few.
const cache = lruCache(128);
const layerCache = lruCache(16);
// Tints per source image. The outer WeakMap dies with the image; the inner
// per-color cache is bounded for the same reason as above (a tint color
// computed per frame is a plausible mistake).
const TINTS_PER_SOURCE = 16;
// Last DPR any bake was requested at. A change (window dragged between 1×
// and 2× monitors) strands every entry baked for the old DPR — sweep them so
// the caches don't hold both worlds forever. The "@<dpr>" key suffix makes
// stale entries checkable.
let lastDpr;
function sweepOtherDpr(dpr) {
    if (dpr === lastDpr)
        return;
    lastDpr = dpr;
    const keep = "@" + dpr;
    // Deleting the entry the iterator is standing on is well-defined for a Map,
    // which is what backs these caches — no snapshot needed.
    for (const [key] of cache.entries())
        if (!key.endsWith(keep))
            cache.delete(key);
    for (const [key] of layerCache.entries())
        if (!key.endsWith(keep))
            layerCache.delete(key);
}
/** Get or create a pre-rendered sprite canvas keyed by `cacheKey`.
 *  `size` is the logical size in CSS pixels. It is folded into the real cache
 *  key, so two call sites sharing a key at different sizes each get their own
 *  bake instead of the first one's canvas.
 *  `dpr` is the device pixel ratio for sharp rendering. It is part of the real
 *  cache key, so dragging the window between 1× and 2× monitors re-bakes
 *  sharp sprites automatically instead of serving stale ones.
 *  `draw` is called once with the offscreen 2D context (already DPR-scaled
 *  and translated to center).
 *  The cache is a bounded LRU: a key space that churns (a size recomputed every
 *  frame) can't grow it without limit, but it will thrash re-bakes — bake at a
 *  fixed set of sizes. */
export function getSprite(cacheKey, size, dpr, draw) {
    sweepOtherDpr(dpr);
    cacheKey += "@" + size + "@" + dpr;
    let sprite = cache.get(cacheKey);
    if (!sprite) {
        sprite = scratchCanvas(Math.ceil(size * dpr), Math.ceil(size * dpr));
        sprite.logicalSize = size;
        const ctx = scratchContext(sprite);
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
export function getLayer(cacheKey, w, h, dpr, draw) {
    sweepOtherDpr(dpr);
    cacheKey += "@" + dpr;
    let layer = layerCache.get(cacheKey); // an LRU get refreshes recency
    if (!layer) {
        layer = scratchCanvas(Math.max(1, Math.ceil(w * dpr)), Math.max(1, Math.ceil(h * dpr)));
        const ctx = scratchContext(layer);
        ctx.scale(dpr, dpr);
        draw(ctx);
        layerCache.set(cacheKey, layer); // evicts the oldest bake beyond the cap
    }
    return layer;
}
const tintCache = new WeakMap();
/** A solid-`color` silhouette of `source` — the same opaque shape, flat-filled.
 *  Draw it over the original at a fading alpha for a hit "white flash" (pair
 *  the alpha with `Goodies.flash`), or use it for damage tints and team colors.
 *  Cached per (source, color) — a bounded LRU per source image — so call it
 *  every frame freely, as long as the colors come from a fixed set.
 *
 *    ctx.drawImage(frame, x, y);
 *    ctx.globalAlpha = flash.value;
 *    ctx.drawImage(Sprites.tint(frame, "#fff"), x, y); // same dest rect as `frame`
 *    ctx.globalAlpha = 1; */
export function tint(source, color) {
    const w = Math.max(1, Math.ceil("naturalWidth" in source ? source.naturalWidth : source.width));
    const h = Math.max(1, Math.ceil("naturalHeight" in source ? source.naturalHeight : source.height));
    let byColor = tintCache.get(source);
    if (!byColor) {
        byColor = lruCache(TINTS_PER_SOURCE);
        tintCache.set(source, byColor);
    }
    const key = `${color}@${w}x${h}`;
    let out = byColor.get(key);
    if (!out) {
        out = scratchCanvas(w, h);
        const ctx = scratchContext(out);
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
export function clearSpriteCache() {
    cache.clear();
    layerCache.clear();
}
/** Bake `count` cells into one grid atlas canvas — a texture atlas / sprite
 *  sheet — so you never hand-roll `document.createElement` + `getContext`.
 *  Slice the result with `Tiles.set` (named skin cells for `Draw.tiles`) or
 *  `Anim.fromGrid` (named animation states). `draw(ctx, i)` renders
 *  cell `i` with the context saved/restored and translated to that cell
 *  (top-left origin by default — see `AtlasOptions.origin`). Cells fill
 *  left-to-right, top-to-bottom. The canvas is 1:1 (no DPR scaling):
 *  `Tiles.set`/`Anim.fromGrid` blit `fw × fh` per cell and handle their own
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
 *    const sheet = Anim.fromGrid(spin, {
 *      frame: { w: 40, h: 40 },
 *      states: { spin: { row: 0, frames: 16, fps: 14 } },
 *    }); */
export function atlas(fw, fh, count, draw, opts = {}) {
    const cols = Math.max(1, opts.cols ?? count);
    const rows = Math.max(1, Math.ceil(count / cols));
    const offX = opts.origin === "center" ? fw / 2 : 0;
    const offY = opts.origin === "center" ? fh / 2 : 0;
    const cv = scratchCanvas(fw * cols, fh * rows);
    const ctx = scratchContext(cv);
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
 *    const sheet = Anim.fromGrid(img, {
 *      frame: { w: 32, h: 32 },
 *      states: { idle: { row: 0, frames: 4, fps: 6 } },
 *    }); */
export function packAtlas(images, opts = {}) {
    if (images.length === 0)
        throw new Error("Sprites.packAtlas: no frames");
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
export function contentBounds(source, threshold = 8) {
    const w = source.width;
    const h = source.height;
    const cv = scratchCanvas(w, h);
    const ctx = scratchContext(cv);
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > threshold) {
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
                if (y < minY)
                    minY = y;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (maxX < 0)
        return { x: 0, y: 0, w, h };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
