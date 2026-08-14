import type { Rect } from "../../engine/index.js";
import type { Level, TileSpec } from "../../tiles/index.js";
export interface MinimapCell {
    col: number;
    row: number;
    tile: string;
    spec: TileSpec;
}
export interface MinimapPoint {
    x: number;
    y: number;
    color: string;
    /** Marker width/height in UI pixels. Default 3. */
    size?: number;
    /** Optional larger square behind the marker. */
    outline?: string;
}
export interface MinimapOptions {
    /** Screen-space destination rect, commonly obtained from a panel layout. */
    at: Rect;
    background?: string;
    /** Tile color or callback. Return null to hide a semantic cell. */
    tile?: string | ((cell: MinimapCell) => string | null);
    points?: Iterable<MinimapPoint>;
    /** Camera/world viewport to outline. */
    view?: Rect;
    viewColor?: string;
}
/** Draw a complete semantic level overview with slopes, markers, and viewport. */
export declare function minimap(level: Level<string>, options: MinimapOptions): void;
