import type { TileSet, TileSetOptions } from "./types.js";
/** Slice a tileset image into named cells + selector factories — the
 *  space-indexed cousin of `Anim.fromGrid`. Named cells are fixed `Cell`s; the
 *  `region` crops a multi-cell atlas stamp; `pick`/`anim`/`auto9`/`auto16`
 *  build `Selector`s that choose a cell per grid cell. All drop into a skin:
 *
 *      const ts = Tiles.set(img, { size: 16, names: { ground: [0, 0], plank: [4, 0] } });
 *      const skin = { "#": ts.auto16(ts.ground), "-": ts.plank };
 *      Draw.tiles(level, skin);
 */
export declare function set<N extends string>(image: CanvasImageSource, options: TileSetOptions<N>): TileSet<N>;
/** Palette-swap a tileset image, returning a NEW image usable anywhere the
 *  original was — one drawn tileset becomes snow/night/lava variants:
 *
 *      const night = Tiles.recolor(terrain, { "#7ec850": "#2c4a3b", "#8bb": "#334" });
 *
 *  Keys and values are `#rgb`/`#rrggbb`/`#rrggbbaa`; matching is exact on RGB,
 *  and a value's alpha (when given) replaces the pixel's. Fully transparent
 *  pixels are left alone. Returns the original image unchanged when no 2D
 *  canvas exists (headless/jsdom) or the image has no intrinsic size. */
export declare function recolor(image: CanvasImageSource, palette: Record<string, string>): CanvasImageSource;
