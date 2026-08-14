/** An overlay is active for the current frame — background widgets must ignore
 *  the pointer. This includes an overlay captured during the ordinary draw
 *  pass and one carried over from the previous frame. */
export declare function isOverlayActive(): boolean;
/** The rest of this frame belongs to an overlay opened this frame. */
export declare function isInOverlayPass(): boolean;
/** Capture the background while an overlay is being deferred. The overlay's
 *  own controls are not live until `enterOverlay()` runs in the overlay pass. */
export declare function captureOverlay(focusVisible?: boolean): void;
/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  immediate overlays and by deferred overlays when their pass begins. */
export declare function enterOverlay(focusVisible?: boolean): void;
type LifecycleHook = () => void;
/** Register a fixed-step update — aging float-text pools, the spinner phase, … */
export declare function onStep(fn: LifecycleHook): void;
/** Register a deferred overlay-pass draw — run at frame-end BEFORE the focus
 *  registry closes, so a menu drawn now still registers its focusables. */
export declare function onOverlayPass(fn: LifecycleHook): void;
/** Register frame-end cleanup — native editor eviction, per-frame seen-sets,
 *  tooltip hover-stability, drag cancel. Run after the overlay focus trap. */
export declare function onFrameEnd(fn: LifecycleHook): void;
/** Wrap one-time hook registration.
 *
 *  A widget can't register its lifecycle hooks at import time — that would wire
 *  the frame loop for a widget the game never draws — so each registers on its
 *  first draw and must then not register again. Five widgets had written the
 *  same module-level `let wired` guard; this is that guard:
 *
 *      const ensureHooks = lifecycleOnce(() => { onFrameEnd(sweep); onReset(clear); });
 *
 *  Module-scoped, deliberately, like the hook lists themselves: registration is
 *  idempotent per hook, and the hooks look up per-app state when they run. */
export declare function lifecycleOnce(register: () => void): () => void;
/** Register test-reset cleanup, run by `_reset` (once per app — release
 *  DOM nodes here; plain slot state is dropped wholesale). */
export declare function onReset(fn: LifecycleHook): void;
export declare function ensureWired(): void;
/** Reset the theme, global UI-scale settings, every app's widget state
 *  (running each app's registered resets first — they release DOM nodes)
 *  and the app wiring — for tests. */
export declare function _reset(): void;
export {};
