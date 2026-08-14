export type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;
/** Current generation of an engine-owned scratch, or `undefined` if `c` was
 *  not created by `scratchCanvas`. */
export declare function scratchGeneration(c: object): number | undefined;
/** Mark an engine-owned scratch dirty after in-place pixel writes. Write-once
 *  bakes (atlases, particle dots) never need this — they keep generation 0. */
export declare function bumpScratch(c: ScratchCanvas): void;
/** A w×h bitmap surface. Prefers `OffscreenCanvas`; falls back to a detached
 *  HTML canvas when that constructor is missing or `getContext("2d")` fails. */
export declare function scratchCanvas(w: number, h: number): ScratchCanvas;
/** 2D context of a scratch surface, or `null` when the environment cannot
 *  rasterise (jsdom). Callers treat null as "skip the bake". */
export declare function scratchContext(c: ScratchCanvas): CanvasRenderingContext2D | null;
