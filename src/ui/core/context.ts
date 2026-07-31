import { currentUiApp } from "./state.js";

// ---------- Implicit context ----------
// Widgets draw to the selected app's context. `createUI(app)` binds this
// automatically: every function it hands out runs inside `withUiApp`.

export function uiCtx(): CanvasRenderingContext2D {
  return currentUiApp().ctx;
}
