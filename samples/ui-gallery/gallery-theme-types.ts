import type { TileRegion, TilesetMapping } from "minimotor/ui";

/** Source art annotations shown by the gallery's atlas inspector. Uniform
 * `split` grids are used for tile mappings; `insets` define real nine-slice
 * boundaries for UI frames. */
export interface GalleryAtlasEntry {
  label: string;
  region: TileRegion;
  split?: { cols: number; rows: number };
  mapping: TilesetMapping;
  insets?: { left: number; top: number; right: number; bottom: number };
}

export interface GalleryAtlasVariant {
  label: string;
  image: CanvasImageSource;
  tileSize?: { w: number; h: number };
  entries: readonly GalleryAtlasEntry[];
}

/** Runtime-derived atlas views. Variants are alternate skins already supplied
 * by a theme (for example Tiny RPG's alternate panel treatment). */
export interface GalleryAtlasDebug extends GalleryAtlasVariant {
  variants?: readonly GalleryAtlasVariant[];
}
