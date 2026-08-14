export declare function uiCtx(): CanvasRenderingContext2D;
/** Redirect every subsequent widget draw into `ctx` until `popUiSurface`.
 *  Always pair the two in a `try`/`finally`: an unbalanced push leaves the
 *  whole UI drawing into an offscreen canvas, which looks like the UI having
 *  vanished rather than like an error. */
export declare function pushUiSurface(ctx: CanvasRenderingContext2D): void;
/** Leave the innermost render surface. */
export declare function popUiSurface(): void;
/** Whether drawing is currently redirected to an offscreen surface. Widgets
 *  that reach for the app canvas directly (the native text-input overlay)
 *  check this — a DOM element cannot follow the UI onto a texture. */
export declare function inUiSurface(): boolean;
