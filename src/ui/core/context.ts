import { Draw } from "../../engine/index.js";
import { currentRuntime, runtimeFor, switchRuntime } from "./runtime.js";

// ---------- Implicit context ----------
// The widgets draw to the current UI runtime's host context; without a
// `begin()` that's the default game's `Draw.ctx`. Switching contexts switches
// the WHOLE runtime (focus, scroll state, open editors), so independent games
// on one page get fully isolated UIs — see runtime.ts.

/** Point the widgets at a specific context (isolated games, offscreen
 *  canvases) — switches to that context's UI runtime, so focus/scroll/editor
 *  state stays per-game. Call it at the top of that game's draw every frame;
 *  frame-end housekeeping returns to the default runtime. */
export function begin(ctx: CanvasRenderingContext2D): void {
  switchRuntime(runtimeFor(ctx));
}

export function uiCtx(): CanvasRenderingContext2D {
  return currentRuntime().host ?? Draw.ctx;
}
