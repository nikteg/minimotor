import { currentRuntime } from "./runtime.js";

// ---------- Implicit context ----------
// Widgets draw to the current UI runtime's host context. `createUI(app)` binds
// this automatically: every function it hands out runs inside `withRuntime`,
// so `current` is always the runtime that call belongs to.

export function uiCtx(): CanvasRenderingContext2D {
  const ctx = currentRuntime().host;
  if (!ctx) throw new Error("Minimotor.UI internal error: widget ran outside its bound runtime");
  return ctx;
}
