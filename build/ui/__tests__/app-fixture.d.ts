import type { App } from "../../engine/index.js";
/** Run one frame boundary for a test app: everything `app.onFrame` collected.
 *  Without this a test is always inside frame one, and any bug about state
 *  surviving into frame two is invisible. */
export declare function endTestFrame(app: App): void;
/** Run one fixed step for a test app, which is where the kernel samples input
 *  edges. A test that sets `app.Pointer.pressed` and never calls this is
 *  describing a press the UI never saw. */
export declare function stepTestApp(app: App): void;
/** An explicit app boundary for low-level widget tests. */
export declare function createTestUiApp(ctx: CanvasRenderingContext2D): App;
