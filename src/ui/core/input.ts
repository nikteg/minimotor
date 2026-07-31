import { ensureWired, isInOverlayPass, isOverlayActive, onFrameEnd } from "./lifecycle.js";
import { runtimeSlot, uiApp } from "./runtime.js";
import { pointInRect } from "../../collision.js";

export const DEAD_POINTER = {
  x: -1e9,
  y: -1e9,
  down: false,
  released: false,
  pressed: false,
  doublePressed: false,
  wheel: 0,
};

// ---------- Per-runtime input state ---------------------------------------
// Everything the pointer pipeline tracks across a frame: edge suppression, the
// wheel claim, the UI transform stack, pointer clips and the memoized pointer.
// One instance per UI runtime, so two apps' UIs can't leak gestures into each
// other.
interface UiTransform {
  scale: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

interface PointerCache {
  t: UiTransform | null;
  clip: { x: number; y: number; w: number; h: number } | undefined;
  suppressed: boolean;
  overlayDead: boolean;
  p: typeof DEAD_POINTER;
}

interface InputState {
  /** A widget mid-drag (list swipe-scroll) sets this so the press/release
   *  edges that drive the drag don't ALSO land as a click on whatever widget
   *  sits under the pointer; cleared every frame-end. */
  edgesSuppressed: boolean;
  /** A widget (slider knob, scrollbar thumb, drag-and-drop) owns the pointer
   *  until release — body drag-scroll must not engage. See
   *  `claimPointerGesture`. */
  gestureOwned: boolean;
  /** Wheel claiming for nested scroll regions — see `claimWheel`. */
  wheelTaken: boolean;
  transform: UiTransform | null;
  transformStack: (UiTransform | null)[];
  /** Active clip rects (innermost last), in SCREEN-logical coords. */
  clips: { x: number; y: number; w: number; h: number }[];
  pointerCache: PointerCache | null;
}

const st = runtimeSlot<InputState>(() => ({
  edgesSuppressed: false,
  gestureOwned: false,
  wheelTaken: false,
  transform: null,
  transformStack: [],
  clips: [],
  pointerCache: null,
}));

/** Blank the pointer's press/release/down edges for the rest of this frame — a
 *  drag gesture (e.g. list swipe-scroll) calls this so the ending release isn't
 *  read as a click. Cleared each frame-end (see `lists`). */
export function suppressPointerEdges(): void {
  st().edgesSuppressed = true;
}

/** Clear `suppressPointerEdges` — called from a frame-end hook. */
export function clearPointerEdges(): void {
  st().edgesSuppressed = false;
}

/** Clear the per-frame wheel claim — called from a frame-end hook. */
export function clearWheelClaim(): void {
  st().wheelTaken = false;
}

/** A widget that DRAGS with the pointer (slider knob, scrollbar thumb, a
 *  drag-and-drop source, a text-selection drag) calls this every frame while
 *  its drag is live. Until the pointer releases, body drag-scroll (the
 *  swipe-to-scroll gesture on lists/overflow regions) will not engage — so
 *  working a slider inside a scroll region never also scrolls the region.
 *  Cleared automatically at the frame end after the pointer is released. */
export function claimPointerGesture(): void {
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
export function pointerGestureOwned(): boolean {
  return st().gestureOwned;
}

/** Frame-end housekeeping: drop the gesture claim once the pointer is up.
 *  Kept at frame-END (not on the release edge) so the release that ends a
 *  widget drag can't be misread as a click by overlay close logic. */
export function clearGestureClaim(): void {
  const s = st();
  if (s.gestureOwned && !rawPointer().down) s.gestureOwned = false;
}

/** Claim this frame's wheel for a scroll region. `over` = the pointer is inside
 *  it; `atMin`/`atMax` = already pinned at the scroll extremes. Returns the delta
 *  to apply — 0 when another (outer) region already took it, the pointer is
 *  elsewhere, or this region can't move in the wheel's direction (so the wheel
 *  chains onward to a nested region). */
export function claimWheel(over: boolean, wheel: number, atMin: boolean, atMax: boolean): number {
  const s = st();
  if (s.wheelTaken || !over || wheel === 0) return 0;
  if ((wheel < 0 && atMin) || (wheel > 0 && atMax)) return 0;
  s.wheelTaken = true;
  return wheel;
}

// Reused scratch for `rawPointer`. The underlying pointer can't change
// mid-frame (events dispatch between rAF callbacks), so every call in a frame
// would build an identical object — and several widgets call it per frame.
// Read, don't hold.
const rawScratch = { ...DEAD_POINTER };

/** The pointer, raw, from the current runtime's host app — overlays
 *  themselves read this (their close logic must see clicks even while they
 *  block everyone else). Reused scratch object: read, don't hold. */
export function rawPointer() {
  try {
    const p = uiApp()?.Pointer;
    if (!p) return DEAD_POINTER;
    rawScratch.x = p.x;
    rawScratch.y = p.y;
    rawScratch.down = p.down;
    rawScratch.released = p.frameReleased;
    rawScratch.pressed = p.framePressed;
    rawScratch.doublePressed = p.frameDoublePressed;
    rawScratch.wheel = p.wheel;
    return rawScratch;
  } catch {
    // No app yet (headless/tests) — stay inert like `uiPointer`.
    return DEAD_POINTER;
  }
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
export function pushUiTransform(scale: number, ox: number, oy: number, w: number, h: number): void {
  const s = st();
  s.transformStack.push(s.transform);
  const pScale = s.transform?.scale ?? 1;
  const pOx = s.transform?.ox ?? 0;
  const pOy = s.transform?.oy ?? 0;
  s.transform = { scale: pScale * scale, ox: pOx + pScale * ox, oy: pOy + pScale * oy, w, h };
}

/** Undo the most recent `pushUiTransform`. */
export function popUiTransform(): void {
  const s = st();
  s.transform = s.transformStack.pop() ?? null;
}

/** The active UI scale (product of enclosing `scaled` factors, 1 at the root) —
 *  for stroke widths or thresholds that shouldn't scale with the UI. */
export function currentUiScale(): number {
  return st().transform?.scale ?? 1;
}

/** The active UI transform's raw mapping (`outer = offset + scale * inner`),
 *  or `null` at the root — for code that must RE-APPLY the transform to a
 *  canvas after escaping to the base transform (see `text`). Read-only. */
export function currentUiTransform(): { scale: number; ox: number; oy: number } | null {
  return st().transform;
}

/** Map a point from the active reference space out to SCREEN coords — the
 *  inverse of the pointer mapping. Identity at the root (no transform). Use it
 *  to carry a coordinate measured inside `UI.scaled` (a layout cursor's rect,
 *  an anchor) out to something drawn in screen space later — a frame-end overlay
 *  or a deferred draw — instead of multiplying by the scale by hand (which would
 *  also miss the transform's offset). Pass `out` to write into your own object
 *  instead of allocating. */
export function uiToScreen(
  x: number,
  y: number,
  out?: { x: number; y: number },
): { x: number; y: number } {
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
export function uiFromScreen(
  x: number,
  y: number,
  out?: { x: number; y: number },
): { x: number; y: number } {
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
  if (!t) return p;
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

function hostViewport(): { w: number; h: number } {
  const vp = uiApp()?.viewport;
  if (!vp) {
    throw new Error("Minimotor.UI: no app — use createUI(app) first");
  }
  return vp;
}

/** The width UI code lays out against — the reference size inside a `UI.scaled`
 *  region, else the host app's viewport. */
export function uiWidth(): number {
  return st().transform?.w ?? hostViewport().w;
}

/** The height UI code lays out against (see `uiWidth`). */
export function uiHeight(): number {
  return st().transform?.h ?? hostViewport().h;
}

export interface RelativeSizeOptions {
  /** Smallest returned size in logical px. */
  min?: number;
  /** Largest returned size in logical px. */
  max?: number;
}

function relativeSize(total: number, percent: number, options: RelativeSizeOptions): number {
  return Math.max(options.min ?? 0, Math.min(options.max ?? Infinity, (total * percent) / 100));
}

/** A percentage of the current UI width, optionally constrained. Respects
 * `UI.scaled` reference space. */
export function vw(percent: number, options: RelativeSizeOptions = {}): number {
  return relativeSize(uiWidth(), percent, options);
}

/** A percentage of the current UI height, optionally constrained. Respects
 * `UI.scaled` reference space. */
export function vh(percent: number, options: RelativeSizeOptions = {}): number {
  return relativeSize(uiHeight(), percent, options);
}

// Global UI-scale defaults that the no-arg `UI.scaled(body)` reads: a reference
// size the UI is laid out against, and a multiplier on top. Set once (or never).
// Deliberately shared by every runtime — it's app configuration, not UI state.
let baseSize: { w: number; h: number } | null = null;
let uiScaleSetting = 1;

/** Set the global reference size the UI is designed against — used by the no-arg
 *  `UI.scaled(body)`. Pass `null` to clear. */
export function setBaseSize(size: { w: number; h: number } | null): void {
  baseSize = size;
}

/** Set the global UI-scale multiplier (accessibility / preference), applied on
 *  top of the auto-fit by the no-arg `UI.scaled(body)`. Default 1 — no scaling
 *  beyond the fit. */
export function setScale(scale: number): void {
  uiScaleSetting = scale;
}

/** The global reference size set via `setBaseSize`, or `null`. */
export function getBaseSize(): { w: number; h: number } | null {
  return baseSize;
}

/** The global UI-scale multiplier set via `setScale` (default 1). */
export function getUiScaleSetting(): number {
  return uiScaleSetting;
}

/** Reset the global UI-scale settings — for tests (see lifecycle `_reset`;
 *  per-runtime transform state is dropped with the runtime slots). */
export function resetUiScale(): void {
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
export function activeClip(): { x: number; y: number; w: number; h: number } | undefined {
  const s = st();
  return s.clips[s.clips.length - 1];
}

/** Restrict pointer hits to `rect` until popped — used by `clip`/scroll regions
 *  so clipped-away widgets can't be clicked. `rect` is in the current UI
 *  transform's coords; it's converted to screen-logical coords on the way in. */
export function pushPointerClip(rect: { x: number; y: number; w: number; h: number }): void {
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
export function popPointerClip(): void {
  st().clips.pop();
}

/** Drop the memoized pointer — called from the kernel's frame-end hook. */
export function clearPointerCache(): void {
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
  const s = st();
  const overlayDead = isOverlayActive() && !isInOverlayPass();
  const clip = s.clips[s.clips.length - 1];
  const c = s.pointerCache;
  if (
    c &&
    c.t === s.transform &&
    c.clip === clip &&
    c.suppressed === s.edgesSuppressed &&
    c.overlayDead === overlayDead
  ) {
    return c.p;
  }
  const p = computeUiPointer(s, overlayDead, clip);
  s.pointerCache = { t: s.transform, clip, suppressed: s.edgesSuppressed, overlayDead, p };
  return p;
}

function computeUiPointer(
  s: InputState,
  overlayDead: boolean,
  clip: { x: number; y: number; w: number; h: number } | undefined,
) {
  if (overlayDead) return DEAD_POINTER;
  try {
    const p = rawPointer(); // screen-logical coords
    // Innermost clip is the smallest, so testing it alone is enough (clips nest).
    // Clips are stored in screen coords, so gate before mapping into design coords.
    if (clip && !pointInRect(p.x, p.y, clip)) return DEAD_POINTER;
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
  } catch {
    return DEAD_POINTER;
  }
}

/** Request a CSS cursor for this frame from UI/widget code — forwards to the
 *  host app's `setCursor` (the engine primitive; cursor is a canvas concern).
 *  Reset every frame, so call it each frame the state holds; higher `priority`
 *  (default 0) wins when several are requested. Re-exported as `UI.setCursor`. */
export function setCursor(cursor: string, priority?: number): void {
  uiApp()?.setCursor(cursor, priority);
}

/** Hovering an interactive widget asks for the hand cursor; the engine
 *  resets it every frame, so it clears the moment nothing is hovered. */
export function hoverCursor(hover: boolean): void {
  if (hover) setCursor("pointer");
}

/** The interaction state `button()` derives from a pointer. Pure — exported
 *  for tests and for custom-drawn buttons that want the logic without the
 *  default look. */
export function buttonState(
  rect: { x: number; y: number; w: number; h: number },
  pointer: { x: number; y: number; down: boolean; released: boolean },
): { hover: boolean; active: boolean; clicked: boolean } {
  const hover = pointInRect(pointer.x, pointer.y, rect);
  return { hover, active: hover && pointer.down, clicked: hover && pointer.released };
}
