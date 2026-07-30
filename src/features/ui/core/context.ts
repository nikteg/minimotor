import { currentRuntime, runtimeFor, switchRuntime } from "./runtime.js";

// ---------- Implicit context ----------
// Widgets draw to the current UI runtime's host context. `createUI(app)`
// binds this automatically; low-level `begin(ctx)` selects an explicit
// standalone context. Switching contexts switches the whole runtime.

/** Point the widgets at a specific context (isolated apps, offscreen
 *  canvases) — switches to that context's UI runtime, so focus/scroll/editor
 *  state stays per-app. Call it at the top of that app's draw every frame;
 *  frame-end housekeeping returns to the default runtime. */
export function begin(ctx: CanvasRenderingContext2D): void {
  switchRuntime(runtimeFor(ctx));
}

export function uiCtx(): CanvasRenderingContext2D {
  const ctx = currentRuntime().host;
  if (!ctx) throw new Error("Minimotor.UI internal error: widget ran outside its bound runtime");
  return ctx;
}
