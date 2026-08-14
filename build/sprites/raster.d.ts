import { type ScratchCanvas } from "../engine/offscreen.js";
export type { ScratchCanvas };
export { bumpScratch, scratchGeneration } from "../engine/offscreen.js";
/** An offscreen canvas pre-rendered for blitting, tagged with its `logicalSize`. */
export type SpriteCanvas = ScratchCanvas & {
    /** Logical size in CSS pixels (the backing store is DPR × logicalSize) */
    logicalSize: number;
};
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
export declare function getSprite(cacheKey: string, size: number, dpr: number, draw: (ctx: CanvasRenderingContext2D) => void): SpriteCanvas;
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
export declare function getLayer(cacheKey: string, w: number, h: number, dpr: number, draw: (ctx: CanvasRenderingContext2D) => void): ScratchCanvas;
/** Any drawable that reports its own size — canvas, image, bitmap, and the
 *  font atlases `Font.atlas` tints. */
export type TintSource = CanvasImageSource & {
    width: number;
    height: number;
};
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
export declare function tint(source: TintSource, color: string): ScratchCanvas;
/** Clear the sprite AND layer caches (call on resize or theme change if needed). */
export declare function clearSpriteCache(): void;
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
export declare function atlas(fw: number, fh: number, count: number, draw: (ctx: CanvasRenderingContext2D, index: number) => void, opts?: AtlasOptions): ScratchCanvas;
/** Pack same-size images into one grid atlas canvas — the common "N separate
 *  PNGs → one sheet" case. Frame size defaults to the first image's
 *  dimensions; pass `cols` for a grid (default: one row).
 *
 *    const img = Sprites.packAtlas([idle0, idle1, idle2, idle3]);
 *    const sheet = Anim.fromGrid(img, {
 *      frame: { w: 32, h: 32 },
 *      states: { idle: { row: 0, frames: 4, fps: 6 } },
 *    }); */
export declare function packAtlas(images: Array<CanvasImageSource & {
    width: number;
    height: number;
}>, opts?: {
    cols?: number;
    fw?: number;
    fh?: number;
}): ScratchCanvas;
/** The opaque (alpha > `threshold`) bounding box of an image/canvas, in pixels.
 *  Use it to trim transparent padding — e.g. seat a sprite on a surface by its
 *  real base (`(box.y + box.h) / img.height`) instead of the frame edge.
 *  Returns the full rect when nothing clears the threshold. Reads pixels, so the
 *  source must be same-origin / untainted. */
export declare function contentBounds(source: CanvasImageSource & {
    width: number;
    height: number;
}, threshold?: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
