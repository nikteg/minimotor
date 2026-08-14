import { currentUiApp } from "./state.js";
// ---------- Implicit context ----------
// Widgets draw to the selected app's context. `createUI(app)` binds this
// automatically: every function it hands out runs inside `withUiApp`.
//
// One thing can redirect it: a RENDER SURFACE. `pushUiSurface` swaps the
// context for an offscreen one so a whole UI can be drawn into a texture —
// which is how `uiSurface` (src/render3d) puts a live, interactive panel onto
// a quad in a 3D scene without porting a single widget. The surface is a
// stack, so a surface may be drawn from inside another one.
const surfaces = [];
export function uiCtx() {
    return surfaces[surfaces.length - 1] ?? currentUiApp().ctx;
}
/** Redirect every subsequent widget draw into `ctx` until `popUiSurface`.
 *  Always pair the two in a `try`/`finally`: an unbalanced push leaves the
 *  whole UI drawing into an offscreen canvas, which looks like the UI having
 *  vanished rather than like an error. */
export function pushUiSurface(ctx) {
    surfaces.push(ctx);
}
/** Leave the innermost render surface. */
export function popUiSurface() {
    surfaces.pop();
}
/** Whether drawing is currently redirected to an offscreen surface. Widgets
 *  that reach for the app canvas directly (the native text-input overlay)
 *  check this — a DOM element cannot follow the UI onto a texture. */
export function inUiSurface() {
    return surfaces.length > 0;
}
