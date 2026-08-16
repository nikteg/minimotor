import { ensureWired, isInOverlayPass, isOverlayActive, lifecycleOnce, onFrameEnd, onStep, } from "./lifecycle.js";
import { hasUiApp, uiSlot, uiApp } from "./state.js";
import { pointInRect } from "../../collision/index.js";
import { isMeasuring } from "./measure-pass.js";
export const DEAD_POINTER = {
    x: -1e9,
    y: -1e9,
    down: false,
    released: false,
    pressed: false,
    doublePressed: false,
    wheel: 0,
};
const st = uiSlot(() => ({
    edgesSuppressed: false,
    gestureOwned: false,
    wheelTaken: false,
    dragHeld: false,
    overUi: false,
    overUiLast: false,
    press: null,
    transform: null,
    transformStack: [],
    clips: [],
    pointerCache: null,
}));
/** Blank the pointer's press/release/down edges for the rest of this frame — a
 *  drag gesture (e.g. list swipe-scroll) calls this so the ending release isn't
 *  read as a click. Cleared each frame-end (see `lists`). */
export function suppressPointerEdges() {
    st().edgesSuppressed = true;
}
/** Clear `suppressPointerEdges` — called from a frame-end hook. */
export function clearPointerEdges() {
    st().edgesSuppressed = false;
}
// Split deliberately, the same way `claimPointerGesture` is: registering the
// hook is idempotent MODULE-wide (the hook looks up per-app state when it
// runs), but wiring the frame loop is per APP — a second canvas, or a game
// re-init that replaces the app, needs its own `ensureWired`. Folding both into
// one `lifecycleOnce` leaves every app after the first with a claim that never
// clears, which is the bug this whole path exists to prevent.
const ensureWheelHook = lifecycleOnce(() => onFrameEnd(clearWheelClaim));
/** Clear the per-frame wheel claim — called from a frame-end hook. */
export function clearWheelClaim() {
    st().wheelTaken = false;
}
/** `dragSource` raises this every frame its payload is in flight. It lives here
 *  rather than in `dragdrop` because `buttonState` is core and must not import a
 *  widget; the widget pushes the fact down instead. Cleared at frame end. */
export function holdDragPayload() {
    st().dragHeld = true;
}
/** Whether a drag-and-drop payload is currently being carried. */
export function dragPayloadHeld() {
    return st().dragHeld;
}
/** Frame-end housekeeping for `holdDragPayload`. */
export function clearDragPayload() {
    st().dragHeld = false;
}
/** Report that a UI surface covers the pointer right now — a widget's hit-area
 *  (`buttonState` does this for you), a panel's frame, or an overlay taking the
 *  whole screen. What it buys is `pointerOverUi`. */
export function markPointerOverUi() {
    // `buttonState` is a pure helper as well as a widget's hit test, and callers
    // are free to run it on a rect of their own outside any frame. There is no
    // app to book the claim against then, and nothing to read it either.
    if (!hasUiApp())
        return;
    ensureWired();
    ensureOverUiHook();
    st().overUi = true;
}
const ensureOverUiHook = lifecycleOnce(() => onFrameEnd(rollPointerOverUi));
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
export function pointerOverUi() {
    const s = st();
    return s.overUi || s.overUiLast;
}
/** Frame-end housekeeping: this frame's answer becomes last frame's. */
export function rollPointerOverUi() {
    const s = st();
    s.overUiLast = s.overUi;
    s.overUi = false;
}
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
export function pressOrigin() {
    if (!hasUiApp())
        return null;
    ensureWired();
    ensurePressHook();
    const s = st();
    if (!s.press)
        return null;
    const t = s.transform;
    if (!t)
        return s.press;
    return { x: (s.press.x - t.ox) / t.scale, y: (s.press.y - t.oy) / t.scale };
}
/** Fixed-step housekeeping for `pressOrigin`. The pointer is read defensively
 *  because a headless host may not have one. */
export function trackPressOrigin() {
    const p = uiApp().Pointer;
    if (p?.pressed)
        st().press = { x: p.x, y: p.y };
}
const ensurePressHook = lifecycleOnce(() => onStep(trackPressOrigin));
/** A widget that DRAGS with the pointer (slider knob, scrollbar thumb, a
 *  drag-and-drop source, a text-selection drag) calls this every frame while
 *  its drag is live. Until the pointer releases, body drag-scroll (the
 *  swipe-to-scroll gesture on lists/overflow regions) will not engage — so
 *  working a slider inside a scroll region never also scrolls the region.
 *  Cleared automatically at the frame end after the pointer is released. */
export function claimPointerGesture() {
    ensureWired(); // the claim clears at frame end — that hook must actually run
    if (!gestureHookWired) {
        gestureHookWired = true;
        onFrameEnd(clearGestureClaim);
    }
    st().gestureOwned = true;
}
let gestureHookWired = false;
/** Whether a widget currently owns the pointer gesture (see
 *  `claimPointerGesture`). Read by `dragScroll` to keep body scrolling out of
 *  a live widget drag. */
export function pointerGestureOwned() {
    return st().gestureOwned;
}
/** Frame-end housekeeping: drop the gesture claim once the pointer is up.
 *  Kept at frame-END (not on the release edge) so the release that ends a
 *  widget drag can't be misread as a click by overlay close logic. */
export function clearGestureClaim() {
    const s = st();
    if (s.gestureOwned && !rawPointer().down)
        s.gestureOwned = false;
}
/** Claim this frame's wheel for a scroll region. `over` = the pointer is inside
 *  it; `atMin`/`atMax` = already pinned at the scroll extremes. Returns the delta
 *  to apply — 0 when another (outer) region already took it, the pointer is
 *  elsewhere, or this region can't move in the wheel's direction (so the wheel
 *  chains onward to a nested region). */
export function claimWheel(over, wheel, atMin, atMax) {
    // The reset belongs to whoever CLAIMS, not to whoever happens to scroll.
    // `lists` used to register it, so a screen with a wheel consumer but no
    // overflowing scroll region — a `viewport3d` on its own — claimed the wheel
    // on frame one and never got it back: the first notch zoomed and every notch
    // after it was silently dropped. Registering here makes the claim's lifetime
    // the claim's own business.
    ensureWired();
    ensureWheelHook();
    const s = st();
    if (s.wheelTaken || !over || wheel === 0)
        return 0;
    if ((wheel < 0 && atMin) || (wheel > 0 && atMax))
        return 0;
    s.wheelTaken = true;
    return wheel;
}
// Reused scratch for `rawPointer`. The underlying pointer can't change
// mid-frame (events dispatch between rAF callbacks), so every call in a frame
// would build an identical object — and several widgets call it per frame.
// Read, don't hold.
const rawScratch = { ...DEAD_POINTER };
/** The pointer, raw, from the current app's host app — overlays
 *  themselves read this (their close logic must see clicks even while they
 *  block everyone else). Reused scratch object: read, don't hold. */
export function rawPointer() {
    const p = uiApp().Pointer;
    // A pointer OVERRIDE replaces the position (and only the position) for the
    // duration of a surface draw. Everything else — the button edges, the wheel
    // — is still the real device's, because a UI drawn onto a 3D quad is being
    // clicked by the same physical pointer; only WHERE it lands has to be
    // re-derived, by casting a ray at the quad. `off` moves it far out of every
    // rect, which is how a ray that misses the quad reads as "not hovering"
    // without a second code path.
    if (pointerOverride) {
        rawScratch.x = pointerOverride.off ? -1e9 : pointerOverride.x;
        rawScratch.y = pointerOverride.off ? -1e9 : pointerOverride.y;
        rawScratch.down = p.down;
        rawScratch.released = p.frameReleased;
        rawScratch.pressed = p.framePressed;
        rawScratch.doublePressed = p.frameDoublePressed;
        rawScratch.wheel = p.wheel;
        return rawScratch;
    }
    rawScratch.x = p.x;
    rawScratch.y = p.y;
    rawScratch.down = p.down;
    rawScratch.released = p.frameReleased;
    rawScratch.pressed = p.framePressed;
    rawScratch.doublePressed = p.frameDoublePressed;
    rawScratch.wheel = p.wheel;
    return rawScratch;
}
let pointerOverride = null;
/** Re-aim the pointer at `(x, y)` in the current surface's coordinates, or
 *  mark it as missing the surface entirely. Returns the previous override so
 *  it can be restored — surfaces nest.
 *
 *  This exists because hit-testing a UI on a 3D quad is a ray cast, not an
 *  affine transform, so `pushUiTransform` (a scale plus an offset) cannot
 *  express it. */
export function pushPointerOverride(x, y, off) {
    const prev = pointerOverride;
    pointerOverride = { x, y, off };
    // The memoized pointer is keyed on the transform and clip, neither of which
    // changed, so it has to be dropped explicitly or the surface would see the
    // screen-space position for the rest of the frame.
    st().pointerCache = null;
    return prev;
}
/** Restore a previous override (or null for the real device pointer). */
export function popPointerOverride(prev) {
    pointerOverride = prev;
    st().pointerCache = null;
}
// ---------- UI transform (scale / reference-size fit) -----------------------
// A uniform scale + translate applied to a UI region: `outer = offset + scale *
// inner`, where `outer` is screen-logical coords (what the pointer arrives in)
// and `inner` is the reference coords a widget lays out with. `UI.scaled` pushes
// a transform onto the canvas AND here; `uiPointer` maps the pointer back into
// reference coords so hit-testing stays correct. `w`/`h` are the region's
// logical size (what `UI.width`/`UI.height` report). Transforms compose (nest);
// `null` is the root (no transform — the device viewport).
/** Enter a UI transform: everything drawn until `popUiTransform` lays out in
 *  coords that map `outer = offset + scale * inner`, with `w`×`h` the region's
 *  logical size. Composes with any enclosing transform. The canvas-side
 *  transform is the caller's job. */
export function pushUiTransform(scale, ox, oy, w, h) {
    const s = st();
    s.transformStack.push(s.transform);
    const pScale = s.transform?.scale ?? 1;
    const pOx = s.transform?.ox ?? 0;
    const pOy = s.transform?.oy ?? 0;
    s.transform = { scale: pScale * scale, ox: pOx + pScale * ox, oy: pOy + pScale * oy, w, h };
}
/** Undo the most recent `pushUiTransform`. */
export function popUiTransform() {
    const s = st();
    s.transform = s.transformStack.pop() ?? null;
}
/** The active UI scale (product of enclosing `scaled` factors, 1 at the root) —
 *  for stroke widths or thresholds that shouldn't scale with the UI. */
export function currentUiScale() {
    return st().transform?.scale ?? 1;
}
/** The active UI transform's raw mapping (`outer = offset + scale * inner`),
 *  or `null` at the root — for code that must RE-APPLY the transform to a
 *  canvas after escaping to the base transform (see `text`). Read-only. */
export function currentUiTransform() {
    return st().transform;
}
/** Map a point from the active reference space out to SCREEN coords — the
 *  inverse of the pointer mapping. Identity at the root (no transform). Use it
 *  to carry a coordinate measured inside `UI.scaled` (a layout cursor's rect,
 *  an anchor) out to something drawn in screen space later — a frame-end overlay
 *  or a deferred draw — instead of multiplying by the scale by hand (which would
 *  also miss the transform's offset). Pass `out` to write into your own object
 *  instead of allocating. */
export function uiToScreen(x, y, out) {
    const t = st().transform;
    const o = out ?? { x: 0, y: 0 };
    o.x = t ? t.ox + t.scale * x : x;
    o.y = t ? t.oy + t.scale * y : y;
    return o;
}
/** Map a SCREEN point into the active reference space — the inverse of
 *  `uiToScreen`, identity at the root. Use it to bring a screen-space
 *  coordinate (a raw pointer position, a fixed pixel inset like a header
 *  height) into the coords a `UI.scaled` block lays out in, instead of dividing
 *  by the scale by hand. Pass `out` to write into your own object. */
export function uiFromScreen(x, y, out) {
    const t = st().transform;
    const o = out ?? { x: 0, y: 0 };
    o.x = t ? (x - t.ox) / t.scale : x;
    o.y = t ? (y - t.oy) / t.scale : y;
    return o;
}
/** The pointer for a widget HOLDING A LIVE DRAG (slider knob, scrollbar thumb,
 *  a text-selection drag): the raw pointer mapped into the active UI transform's
 *  reference coords, but NOT gated by clips, overlays or edge suppression.
 *  `uiPointer` goes dead the moment the finger leaves the clip region the widget
 *  sits in — correct for hover/press, but a drag already in progress must keep
 *  tracking (and must release on the REAL pointer-up, not a clip-dead one).
 *  Start drags from `uiPointer` (a press must land inside the clip to count);
 *  track and release them through this. */
export function dragPointer() {
    const t = st().transform;
    const p = rawPointer();
    if (!t)
        return p;
    dragScratch.x = (p.x - t.ox) / t.scale;
    dragScratch.y = (p.y - t.oy) / t.scale;
    dragScratch.down = p.down;
    dragScratch.released = p.released;
    dragScratch.pressed = p.pressed;
    dragScratch.doublePressed = p.doublePressed;
    dragScratch.wheel = p.wheel;
    return dragScratch;
}
const dragScratch = { ...DEAD_POINTER };
function hostViewport() {
    return uiApp().viewport;
}
/** The width UI code lays out against — the reference size inside a `UI.scaled`
 *  region, else the host app's viewport. */
export function uiWidth() {
    return st().transform?.w ?? hostViewport().w;
}
/** The height UI code lays out against (see `uiWidth`). */
export function uiHeight() {
    return st().transform?.h ?? hostViewport().h;
}
function relativeSize(total, percent, options) {
    return Math.max(options.min ?? 0, Math.min(options.max ?? Infinity, (total * percent) / 100));
}
/** A percentage of the current UI width, optionally constrained. Respects
 * `UI.scaled` reference space. */
export function vw(percent, options = {}) {
    return relativeSize(uiWidth(), percent, options);
}
/** A percentage of the current UI height, optionally constrained. Respects
 * `UI.scaled` reference space. */
export function vh(percent, options = {}) {
    return relativeSize(uiHeight(), percent, options);
}
// Global UI-scale defaults that the no-arg `UI.scaled(body)` reads: a reference
// size the UI is laid out against, and a multiplier on top. Set once (or never).
// Deliberately shared by every app — it's app configuration, not UI state.
let baseSize = null;
let uiScaleSetting = 1;
/** Set the global reference size the UI is designed against — used by the no-arg
 *  `UI.scaled(body)`. Pass `null` to clear. */
export function setBaseSize(size) {
    baseSize = size;
}
/** Set the global UI-scale multiplier (accessibility / preference), applied on
 *  top of the auto-fit by the no-arg `UI.scaled(body)`. Default 1 — no scaling
 *  beyond the fit. */
export function setScale(scale) {
    uiScaleSetting = scale;
}
/** The global reference size set via `setBaseSize`, or `null`. */
export function getBaseSize() {
    return baseSize;
}
/** The global UI-scale multiplier set via `setScale` (default 1). */
export function getUiScaleSetting() {
    return uiScaleSetting;
}
/** Reset the global UI-scale settings — for tests (see lifecycle `_reset`;
 *  per-app transform state is dropped with the per-app slots). */
export function resetUiScale() {
    baseSize = null;
    uiScaleSetting = 1;
}
// Active clip rects (innermost last), stored in SCREEN-logical coords so gating
// is independent of the current UI transform. A widget clipped out of view must
// also be dead to the pointer — otherwise a control scrolled beyond a scroll
// region's visible box (drawn into empty space past it) still catches clicks.
// `clip` pushes/pops these; `uiPointer` deadens the pointer when it's outside.
/** The innermost active pointer clip in SCREEN-logical coords, or undefined
 *  outside any clip — widgets stash it beside a stored hit-rect so out-of-band
 *  hit tests (native event listeners) respect scrolled-away clipping. */
export function activeClip() {
    const s = st();
    return s.clips[s.clips.length - 1];
}
/** Restrict pointer hits to `rect` until popped — used by `clip`/scroll regions
 *  so clipped-away widgets can't be clicked. `rect` is in the current UI
 *  transform's coords; it's converted to screen-logical coords on the way in. */
export function pushPointerClip(rect) {
    const s = st();
    const scale = s.transform?.scale ?? 1;
    const ox = s.transform?.ox ?? 0;
    const oy = s.transform?.oy ?? 0;
    s.clips.push({
        x: ox + scale * rect.x,
        y: oy + scale * rect.y,
        w: rect.w * scale,
        h: rect.h * scale,
    });
}
/** Undo the most recent `pushPointerClip`. */
export function popPointerClip() {
    st().clips.pop();
}
/** Drop the memoized pointer — called from the kernel's frame-end hook. */
export function clearPointerCache() {
    st().pointerCache = null;
}
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
export function uiPointer() {
    ensureWired(); // per-frame housekeeping keeps overlay/tooltip state honest
    // **A measure pass sees no pointer at all**, and returns BEFORE the memo so
    // nothing computed while measuring can be handed to the real run behind it.
    // The rects being measured are provisional, so any hit-test against them is a
    // hit-test on a box that is about to move.
    //
    // This is deliberately not `pushPointerOverride`: that writes a module-level
    // override and drops the memo, and the memo's key does not mention it — under
    // a `UI.scaled` transform the two disagreed and the real run was handed a
    // pointer computed during the measure. MEASURED: a click inside a popover on
    // a scaled screen stopped registering, and only on a scaled one.
    if (isMeasuring())
        return DEAD_POINTER;
    const s = st();
    const overlayDead = isOverlayActive() && !isInOverlayPass();
    const inOverlayPass = isInOverlayPass();
    const clip = s.clips[s.clips.length - 1];
    const c = s.pointerCache;
    if (c &&
        c.t === s.transform &&
        c.clip === clip &&
        c.suppressed === s.edgesSuppressed &&
        c.overlayDead === overlayDead &&
        c.inOverlayPass === inOverlayPass) {
        return c.p;
    }
    const p = computeUiPointer(s, overlayDead, clip);
    s.pointerCache = {
        t: s.transform,
        clip,
        suppressed: s.edgesSuppressed,
        overlayDead,
        inOverlayPass,
        p,
    };
    return p;
}
function computeUiPointer(s, overlayDead, clip) {
    if (overlayDead)
        return DEAD_POINTER;
    try {
        const p = rawPointer(); // screen-logical coords
        // Innermost clip is the smallest, so testing it alone is enough (clips nest).
        // Clips are stored in screen coords, so gate before mapping into design coords.
        if (clip && !pointInRect(p.x, p.y, clip))
            return DEAD_POINTER;
        // Always COPY: the result is memoized for the rest of the frame, and
        // `rawPointer` hands back a scratch that later calls overwrite. One
        // allocation per cache miss (a handful per frame), not per widget.
        const out = { ...p };
        // Map into the active UI transform's reference coords so a widget's rect (in
        // reference coords) hit-tests against the pointer correctly.
        const t = s.transform;
        if (t) {
            out.x = (p.x - t.ox) / t.scale;
            out.y = (p.y - t.oy) / t.scale;
        }
        // A drag gesture in progress swallows the click edges (position/wheel stay).
        if (s.edgesSuppressed) {
            out.pressed = false;
            out.released = false;
            out.down = false;
            out.doublePressed = false;
        }
        return out;
    }
    catch {
        return DEAD_POINTER;
    }
}
/** Request a CSS cursor for this frame from UI/widget code — forwards to the
 *  host app's `setCursor` (the engine primitive; cursor is a canvas concern).
 *  Reset every frame, so call it each frame the state holds; higher `priority`
 *  (default 0) wins when several are requested. Re-exported as `UI.setCursor`. */
export function setCursor(cursor, priority) {
    uiApp().setCursor(cursor, priority);
}
/** Hovering an interactive widget asks for the hand cursor; the engine
 *  resets it every frame, so it clears the moment nothing is hovered. */
export function hoverCursor(hover) {
    if (hover)
        setCursor("pointer");
}
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
export function buttonState(rect, pointer, origin = pressOrigin()) {
    const hover = pointInRect(pointer.x, pointer.y, rect);
    if (hover)
        markPointerOverUi();
    const started = origin === null || pointInRect(origin.x, origin.y, rect);
    return { hover, active: hover && pointer.down, clicked: hover && pointer.released && started };
}
