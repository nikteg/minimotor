import type { DrawTilesOptions } from "../engine/index.js";
import type { Level, Skin } from "./types.js";
import type { GridDims } from "./mesh.js";
export interface Painter<C extends string> {
    render(ctx: CanvasRenderingContext2D, skin: Skin<Level<C>>, opts?: DrawTilesOptions): void;
    /** Drop the baked offscreen layer. */
    invalidate(): void;
}
/** Build the paint path for one level. `cells` is the level's live cell array,
 *  so `set()` is visible here without any notification. */
export declare function createPainter<C extends string>(dims: GridDims, cells: string[][], level: Level<C>): Painter<C>;
