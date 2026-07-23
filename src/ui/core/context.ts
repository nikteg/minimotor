import { Draw } from "../../engine/index.js";

// ---------- Implicit context ----------

export let begunCtx: CanvasRenderingContext2D | null = null;

/** Point the widgets at a specific context for this frame (isolated games,
 *  offscreen canvases). Without it, everything draws to the default game's
 *  `Draw.ctx`. Cleared at frame end. */
export function begin(ctx: CanvasRenderingContext2D): void {
  begunCtx = ctx;
}

/** Clear the overridden context at frame end (called from `frame.ts`'s
 *  ensureWired, which can't reassign this imported binding). */
export function setBegunCtx(ctx: CanvasRenderingContext2D | null): void {
  begunCtx = ctx;
}

export function uiCtx(): CanvasRenderingContext2D {
  return begunCtx ?? Draw.ctx;
}

/** Untangle the two call forms: `widget(opts)` (implicit ctx) and
 *  `widget(ctx, opts)`. */
export function withCtx<T>(
  ctxOrValue: CanvasRenderingContext2D | T,
  value?: T,
): [CanvasRenderingContext2D, T] {
  return value === undefined
    ? [uiCtx(), ctxOrValue as T]
    : [ctxOrValue as CanvasRenderingContext2D, value];
}
