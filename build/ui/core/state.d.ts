import type { App } from "../../engine/index.js";
import type { GamepadState } from "../../input/gamepad.js";
/** Apps with registered UI, for routing page-level keyboard events. */
export declare const allUiApps: App[];
/** Register UI state for an app and configure its navigation-pad source. */
export declare function registerUiApp(app: App, gamepads?: () => readonly GamepadState[]): App;
/** The app selected by `withUiApp` or `selectUiApp`. */
export declare function currentUiApp(): App;
/** Whether any app is selected — for kernel bookkeeping that a caller may
 *  reach outside a frame, where there is nothing to book against. */
export declare function hasUiApp(): boolean;
/** Select an app; returns the previous selection. */
export declare function selectUiApp(app: App): App | null;
/** Run `fn` with `app` selected, restoring the previous selection after. */
export declare function withUiApp<R>(app: App, fn: () => R): R;
/** Clear the ambient selection when an app's frame ends. */
export declare function clearUiApp(app: App): void;
/** Reserve a per-app state slot for a module. Call at module scope; the
 *  returned accessor reads (lazily creating via `init`) the SELECTED app's
 *  instance of the state:
 *
 *    const state = uiSlot(() => ({ drag: null as Drag | null }));
 *    ...
 *    state().drag = ...;   // always the current app's copy */
export declare function uiSlot<T>(init: () => T): () => T;
/** The app currently hosting UI work. */
export declare function uiApp(): App;
export declare function uiGamepads(): readonly GamepadState[];
/** Whether lifecycle hooks have been attached to this app. */
export declare function uiAppWired(app: App): boolean;
/** Record that lifecycle hooks have been attached to this app. */
export declare function markUiAppWired(app: App): void;
/** Drop every app's UI state and clear the active selection — for tests
 *  (see lifecycle `_reset`). Run widget `onReset` hooks FIRST: some state
 *  owns DOM nodes (native editors) that a plain slot wipe would leak. */
export declare function resetUiApps(): void;
