// ---------- Per-app UI state ----------
// The app itself is the UI's identity and supplies its context, viewport,
// input, clock, and lifecycle. UI-only mutable state (focus, layout stacks,
// scroll offsets, open editors, gesture tracking) lives in a private map keyed
// by that app, so two apps on one page stay isolated without a wrapper object.
// `createUI` registers an app and wraps every function it hands out in
// `withUiApp`, so `current` is always the app that call belongs to. Widget
// modules keep their state in a `uiSlot`, which reads/creates the module's
// value for the currently selected app.
//
// Deliberately GLOBAL (shared by every app): the theme, the base-size/
// ui-scale settings, and the lifecycle hook registries (those are module
// wiring — the functions themselves operate on the current app's slots).
const noGamepads = () => [];
let states = new WeakMap();
let current = null;
/** Apps with registered UI, for routing page-level keyboard events. */
export const allUiApps = [];
function stateFor(app) {
    let state = states.get(app);
    if (!state) {
        state = { slots: [], wired: false, gamepads: noGamepads };
        states.set(app, state);
        allUiApps.push(app);
    }
    return state;
}
/** Register UI state for an app and configure its navigation-pad source. */
export function registerUiApp(app, gamepads = noGamepads) {
    stateFor(app).gamepads = gamepads;
    return app;
}
/** The app selected by `withUiApp` or `selectUiApp`. */
export function currentUiApp() {
    if (!current) {
        throw new Error("createUI: no active app; create UI with createUI(app)");
    }
    return current;
}
/** Whether any app is selected — for kernel bookkeeping that a caller may
 *  reach outside a frame, where there is nothing to book against. */
export function hasUiApp() {
    return current !== null;
}
/** Select an app; returns the previous selection. */
export function selectUiApp(app) {
    const prev = current;
    stateFor(app);
    current = app;
    return prev;
}
/** Run `fn` with `app` selected, restoring the previous selection after. */
export function withUiApp(app, fn) {
    const prev = selectUiApp(app);
    try {
        return fn();
    }
    finally {
        current = prev;
    }
}
/** Clear the ambient selection when an app's frame ends. */
export function clearUiApp(app) {
    if (current === app)
        current = null;
}
let nextSlot = 0;
/** Reserve a per-app state slot for a module. Call at module scope; the
 *  returned accessor reads (lazily creating via `init`) the SELECTED app's
 *  instance of the state:
 *
 *    const state = uiSlot(() => ({ drag: null as Drag | null }));
 *    ...
 *    state().drag = ...;   // always the current app's copy */
export function uiSlot(init) {
    const slot = nextSlot++;
    return () => {
        const slots = stateFor(currentUiApp()).slots;
        let v = slots[slot];
        if (v === undefined) {
            v = init();
            slots[slot] = v;
        }
        return v;
    };
}
/** The app currently hosting UI work. */
export function uiApp() {
    return currentUiApp();
}
export function uiGamepads() {
    return stateFor(currentUiApp()).gamepads();
}
/** Whether lifecycle hooks have been attached to this app. */
export function uiAppWired(app) {
    return stateFor(app).wired;
}
/** Record that lifecycle hooks have been attached to this app. */
export function markUiAppWired(app) {
    stateFor(app).wired = true;
}
/** Drop every app's UI state and clear the active selection — for tests
 *  (see lifecycle `_reset`). Run widget `onReset` hooks FIRST: some state
 *  owns DOM nodes (native editors) that a plain slot wipe would leak. */
export function resetUiApps() {
    for (const app of allUiApps) {
        const state = stateFor(app);
        state.slots.length = 0;
        state.wired = false;
    }
    allUiApps.length = 0;
    states = new WeakMap();
    current = null;
}
