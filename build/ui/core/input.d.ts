export declare const DEAD_POINTER: {
    x: number;
    y: number;
    down: boolean;
    released: boolean;
    pressed: boolean;
    doublePressed: boolean;
    wheel: number;
};
/** Blank the pointer's press/release/down edges for the rest of this frame — a
 *  drag gesture (e.g. list swipe-scroll) calls this so the ending release isn't
 *  read as a click. Cleared each frame-end (see `lists`). */
export declare function suppressPointerEdges(): void;
/** Clear `suppressPointerEdges` — called from a frame-end hook. */
export declare function clearPointerEdges(): void;
/** Clear the per-frame wheel claim — called from a frame-end hook. */
export declare function clearWheelClaim(): void;
/** `dragSource` raises this every frame its payload is in flight. It lives here
 *  rather than in `dragdrop` because `buttonState` is core and must not import a
 *  widget; the widget pushes the fact down instead. Cleared at frame end. */
export declare function holdDragPayload(): void;
/** Whether a drag-and-drop payload is currently being carried. */
export declare function dragPayloadHeld(): boolean;
/** Frame-end housekeeping for `holdDragPayload`. */
export declare function clearDragPayload(): void;
/** Report that a UI surface covers the pointer right now — a widget's hit-area
 *  (`buttonState` does this for you), a panel's frame, or an overlay taking the
 *  whole screen. What it buys is `pointerOverUi`. */
export declare function markPointerOverUi(): void;
/** Whether the UI has the pointer, for a game drawn UNDER its own HUD.
 *
 *  A world that reads the pointer directly — an orbit drag, a click that picks
 *  something out of the scene — has to leave alone the presses the interface
 *  is already using, or every button doubles as a handle on the world behind
 *  it. This is that question, and the answer covers every widget with a hit
 *  area, every panel, and the whole screen while a modal or popover is up.
 *
 *  It reports the frame just drawn as well as the one being drawn, because the
 *  two orders both happen: an immediate-mode HUD is usually drawn AFTER the
 *  world it sits over, so at the moment the world reads the pointer this
 *  frame's widgets do not exist yet. The cost is that the answer stays true
 *  for one frame after the pointer leaves the UI, which is invisible next to
 *  the alternative of a click landing in both places at once.
 *
 *  It answers where the pointer IS, not what it is doing: a gesture that
 *  starts on a button and drags out over the world stops being over the UI
 *  halfway through. Whoever owns the gesture should latch this on the press
 *  and hold it until the release. */
export declare function pointerOverUi(): boolean;
/** Frame-end housekeeping: this frame's answer becomes last frame's. */
export declare function rollPointerOverUi(): void;
/** Where the gesture in flight began, in the CURRENT transform's coords, or
 *  null before the first press of the session.
 *
 *  A click is a press and a release on the same thing. Without this the release
 *  is the whole of it, so a drag that starts anywhere at all — on the world
 *  behind the HUD, on a different button, on nothing — fires whatever happens
 *  to be under the pointer when it comes up. `buttonState` gates on it.
 *
 *  Recorded in a fixed step rather than at frame end: the press edge is one
 *  update step long and the draw that reads it comes after. It is never
 *  cleared, only overwritten by the next press, because on the release frame
 *  the pointer is already up — clearing on "not down" would wipe the origin
 *  in the same step that needs it. */
export declare function pressOrigin(): {
    x: number;
    y: number;
} | null;
/** Fixed-step housekeeping for `pressOrigin`. The pointer is read defensively
 *  because a headless host may not have one. */
export declare function trackPressOrigin(): void;
/** A widget that DRAGS with the pointer (slider knob, scrollbar thumb, a
 *  drag-and-drop source, a text-selection drag) calls this every frame while
 *  its drag is live. Until the pointer releases, body drag-scroll (the
 *  swipe-to-scroll gesture on lists/overflow regions) will not engage — so
 *  working a slider inside a scroll region never also scrolls the region.
 *  Cleared automatically at the frame end after the pointer is released. */
export declare function claimPointerGesture(): void;
/** Whether a widget currently owns the pointer gesture (see
 *  `claimPointerGesture`). Read by `dragScroll` to keep body scrolling out of
 *  a live widget drag. */
export declare function pointerGestureOwned(): boolean;
/** Frame-end housekeeping: drop the gesture claim once the pointer is up.
 *  Kept at frame-END (not on the release edge) so the release that ends a
 *  widget drag can't be misread as a click by overlay close logic. */
export declare function clearGestureClaim(): void;
/** Claim this frame's wheel for a scroll region. `over` = the pointer is inside
 *  it; `atMin`/`atMax` = already pinned at the scroll extremes. Returns the delta
 *  to apply — 0 when another (outer) region already took it, the pointer is
 *  elsewhere, or this region can't move in the wheel's direction (so the wheel
 *  chains onward to a nested region). */
export declare function claimWheel(over: boolean, wheel: number, atMin: boolean, atMax: boolean): number;
/** The pointer, raw, from the current app's host app — overlays
 *  themselves read this (their close logic must see clicks even while they
 *  block everyone else). Reused scratch object: read, don't hold. */
export declare function rawPointer(): {
    x: number;
    y: number;
    down: boolean;
    released: boolean;
    pressed: boolean;
    doublePressed: boolean;
    wheel: number;
};
/** Where the pointer should be treated as being, in place of the device's own
 *  position. Set while a UI is drawn onto a surface whose pixels are not on
 *  the screen — see `pushPointerOverride`. */
interface PointerOverride {
    x: number;
    y: number;
    /** The pointer is not over this surface at all. */
    off: boolean;
}
/** Re-aim the pointer at `(x, y)` in the current surface's coordinates, or
 *  mark it as missing the surface entirely. Returns the previous override so
 *  it can be restored — surfaces nest.
 *
 *  This exists because hit-testing a UI on a 3D quad is a ray cast, not an
 *  affine transform, so `pushUiTransform` (a scale plus an offset) cannot
 *  express it. */
export declare function pushPointerOverride(x: number, y: number, off: boolean): PointerOverride | null;
/** Restore a previous override (or null for the real device pointer). */
export declare function popPointerOverride(prev: PointerOverride | null): void;
/** Enter a UI transform: everything drawn until `popUiTransform` lays out in
 *  coords that map `outer = offset + scale * inner`, with `w`×`h` the region's
 *  logical size. Composes with any enclosing transform. The canvas-side
 *  transform is the caller's job. */
export declare function pushUiTransform(scale: number, ox: number, oy: number, w: number, h: number): void;
/** Undo the most recent `pushUiTransform`. */
export declare function popUiTransform(): void;
/** The active UI scale (product of enclosing `scaled` factors, 1 at the root) —
 *  for stroke widths or thresholds that shouldn't scale with the UI. */
export declare function currentUiScale(): number;
/** The active UI transform's raw mapping (`outer = offset + scale * inner`),
 *  or `null` at the root — for code that must RE-APPLY the transform to a
 *  canvas after escaping to the base transform (see `text`). Read-only. */
export declare function currentUiTransform(): {
    scale: number;
    ox: number;
    oy: number;
} | null;
/** Map a point from the active reference space out to SCREEN coords — the
 *  inverse of the pointer mapping. Identity at the root (no transform). Use it
 *  to carry a coordinate measured inside `UI.scaled` (a layout cursor's rect,
 *  an anchor) out to something drawn in screen space later — a frame-end overlay
 *  or a deferred draw — instead of multiplying by the scale by hand (which would
 *  also miss the transform's offset). Pass `out` to write into your own object
 *  instead of allocating. */
export declare function uiToScreen(x: number, y: number, out?: {
    x: number;
    y: number;
}): {
    x: number;
    y: number;
};
/** Map a SCREEN point into the active reference space — the inverse of
 *  `uiToScreen`, identity at the root. Use it to bring a screen-space
 *  coordinate (a raw pointer position, a fixed pixel inset like a header
 *  height) into the coords a `UI.scaled` block lays out in, instead of dividing
 *  by the scale by hand. Pass `out` to write into your own object. */
export declare function uiFromScreen(x: number, y: number, out?: {
    x: number;
    y: number;
}): {
    x: number;
    y: number;
};
/** The pointer for a widget HOLDING A LIVE DRAG (slider knob, scrollbar thumb,
 *  a text-selection drag): the raw pointer mapped into the active UI transform's
 *  reference coords, but NOT gated by clips, overlays or edge suppression.
 *  `uiPointer` goes dead the moment the finger leaves the clip region the widget
 *  sits in — correct for hover/press, but a drag already in progress must keep
 *  tracking (and must release on the REAL pointer-up, not a clip-dead one).
 *  Start drags from `uiPointer` (a press must land inside the clip to count);
 *  track and release them through this. */
export declare function dragPointer(): {
    x: number;
    y: number;
    down: boolean;
    released: boolean;
    pressed: boolean;
    doublePressed: boolean;
    wheel: number;
};
/** The width UI code lays out against — the reference size inside a `UI.scaled`
 *  region, else the host app's viewport. */
export declare function uiWidth(): number;
/** The height UI code lays out against (see `uiWidth`). */
export declare function uiHeight(): number;
export interface RelativeSizeOptions {
    /** Smallest returned size in logical px. */
    min?: number;
    /** Largest returned size in logical px. */
    max?: number;
}
/** A percentage of the current UI width, optionally constrained. Respects
 * `UI.scaled` reference space. */
export declare function vw(percent: number, options?: RelativeSizeOptions): number;
/** A percentage of the current UI height, optionally constrained. Respects
 * `UI.scaled` reference space. */
export declare function vh(percent: number, options?: RelativeSizeOptions): number;
/** Set the global reference size the UI is designed against — used by the no-arg
 *  `UI.scaled(body)`. Pass `null` to clear. */
export declare function setBaseSize(size: {
    w: number;
    h: number;
} | null): void;
/** Set the global UI-scale multiplier (accessibility / preference), applied on
 *  top of the auto-fit by the no-arg `UI.scaled(body)`. Default 1 — no scaling
 *  beyond the fit. */
export declare function setScale(scale: number): void;
/** The global reference size set via `setBaseSize`, or `null`. */
export declare function getBaseSize(): {
    w: number;
    h: number;
} | null;
/** The global UI-scale multiplier set via `setScale` (default 1). */
export declare function getUiScaleSetting(): number;
/** Reset the global UI-scale settings — for tests (see lifecycle `_reset`;
 *  per-app transform state is dropped with the per-app slots). */
export declare function resetUiScale(): void;
/** The innermost active pointer clip in SCREEN-logical coords, or undefined
 *  outside any clip — widgets stash it beside a stored hit-rect so out-of-band
 *  hit tests (native event listeners) respect scrolled-away clipping. */
export declare function activeClip(): {
    x: number;
    y: number;
    w: number;
    h: number;
} | undefined;
/** Restrict pointer hits to `rect` until popped — used by `clip`/scroll regions
 *  so clipped-away widgets can't be clicked. `rect` is in the current UI
 *  transform's coords; it's converted to screen-logical coords on the way in. */
export declare function pushPointerClip(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}): void;
/** Undo the most recent `pushPointerClip`. */
export declare function popPointerClip(): void;
/** Drop the memoized pointer — called from the kernel's frame-end hook. */
export declare function clearPointerCache(): void;
/** The pointer as widgets see it: frame-scoped edges, dead while an overlay has
 *  the screen (unless we're in the overlay's own pass), and dead when outside
 *  the active clip region. Falls back to a dead pointer when there's no app
 *  yet (headless/tests), so widgets still render, they just don't interact.
 *
 *  Called several times per widget; the raw pointer can't change mid-frame
 *  (events dispatch between rAF callbacks), so the mapped result is memoized
 *  against everything that CAN change mid-frame: the active transform/clip
 *  (reference identity — push/pop swaps the object), the edge-suppression flag
 *  and the overlay gate. Cleared each frame-end. */
/** True when THIS pass has no claim on the pointer: a measure pass, or the
 *  background pass of a frame whose overlay owns the input.
 *
 *  `uiPointer` hands both of those a `DEAD_POINTER`, and for hit-testing that
 *  is exactly right — nothing is hovered, nothing is pressed. It is wrong for
 *  any widget holding a gesture ACROSS frames, because "nothing is pressed"
 *  and "the finger let go" are the same reading, and only one of them is true.
 *
 *  MEASURED, and this is what the predicate is for: a scroll region inside a
 *  modal is evaluated TWICE a frame — once live in the overlay pass, once dead
 *  in the background pass — so a body-drag registered by the live pass was torn
 *  down by the dead one before the next frame could advance it. Every frame.
 *  The wheel hid it completely, since a wheel needs no state to survive a
 *  frame, so this only ever showed up on touch, where the wheel is not there to
 *  paper over it.
 *
 *  Deliberately NOT the same question as `uiPointer() === DEAD_POINTER`: that
 *  is also what a pointer CLIPPED out of the current region returns, and a
 *  finger leaving a region is a real event a widget is entitled to act on. */
export declare function pointerPassInert(): boolean;
export declare function uiPointer(): {
    x: number;
    y: number;
    down: boolean;
    released: boolean;
    pressed: boolean;
    doublePressed: boolean;
    wheel: number;
};
/** Request a CSS cursor for this frame from UI/widget code — forwards to the
 *  host app's `setCursor` (the engine primitive; cursor is a canvas concern).
 *  Reset every frame, so call it each frame the state holds; higher `priority`
 *  (default 0) wins when several are requested. Re-exported as `UI.setCursor`. */
export declare function setCursor(cursor: string, priority?: number): void;
/** Hovering an interactive widget asks for the hand cursor; the engine
 *  resets it every frame, so it clears the moment nothing is hovered. */
export declare function hoverCursor(hover: boolean): void;
/** The interaction state `button()` derives from a pointer. Pure — exported
 *  for tests and for custom-drawn buttons that want the logic without the
 *  default look.
 *
 *  A click needs the press AND the release: `origin` defaults to
 *  `pressOrigin()`, and a release whose press began somewhere else is not this
 *  widget's click. A press that leaves the widget and comes back still is,
 *  which is what every other toolkit does too. Pass `origin` explicitly to test
 *  the rule, or `null` to opt out of it — null is also what a session that has
 *  never seen a press reports, and there is no gesture to attribute then. */
export declare function buttonState(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, pointer: {
    x: number;
    y: number;
    down: boolean;
    released: boolean;
}, origin?: {
    x: number;
    y: number;
} | null): {
    hover: boolean;
    active: boolean;
    clicked: boolean;
};
export {};
