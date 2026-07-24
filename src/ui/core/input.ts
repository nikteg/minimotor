import { ensureWired, inOverlayPass, overlayActive } from "./lifecycle.js";
import { Pointer, Stage } from "../../engine/index.js";
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

// A widget mid-drag (list swipe-scroll) sets this so the press/release edges
// that drive the drag don't ALSO land as a click on whatever widget sits under
// the pointer. `uiPointer` blanks the edges (position + wheel survive) while
// it's set; `lists` clears it every frame-end. The dragging widget itself reads
// `uiPointer` BEFORE it calls `suppressPointerEdges`, so it still sees the edges.
let edgesSuppressed = false;

/** Blank the pointer's press/release/down edges for the rest of this frame — a
 *  drag gesture (e.g. list swipe-scroll) calls this so the ending release isn't
 *  read as a click. Cleared each frame-end (see `lists`). */
export function suppressPointerEdges(): void {
  edgesSuppressed = true;
}

/** Clear `suppressPointerEdges` — called from a frame-end hook. */
export function clearPointerEdges(): void {
  edgesSuppressed = false;
}

/** The pointer, raw — overlays themselves read this (their close logic must
 *  see clicks even while they block everyone else). */
export function rawPointer() {
  return {
    x: Pointer.x,
    y: Pointer.y,
    down: Pointer.down,
    released: Pointer.frameReleased,
    pressed: Pointer.framePressed,
    doublePressed: Pointer.frameDoublePressed,
    wheel: Pointer.wheel,
  };
}

// ---------- UI transform (scale / reference-size fit) -----------------------
// A uniform scale + translate applied to a UI region: `outer = offset + scale *
// inner`, where `outer` is screen-logical coords (what the pointer arrives in)
// and `inner` is the reference coords a widget lays out with. `UI.scaled` pushes
// a transform onto the canvas AND here; `uiPointer` maps the pointer back into
// reference coords so hit-testing stays correct. `w`/`h` are the region's
// logical size (what `UI.width`/`UI.height` report). Transforms compose (nest);
// `null` is the root (no transform — the device viewport).
interface UiTransform {
  scale: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}
let uiTransform: UiTransform | null = null;
const uiTransformStack: (UiTransform | null)[] = [];

/** Enter a UI transform: everything drawn until `popUiTransform` lays out in
 *  coords that map `outer = offset + scale * inner`, with `w`×`h` the region's
 *  logical size. Composes with any enclosing transform. The canvas-side
 *  transform is the caller's job. */
export function pushUiTransform(scale: number, ox: number, oy: number, w: number, h: number): void {
  uiTransformStack.push(uiTransform);
  const pScale = uiTransform?.scale ?? 1;
  const pOx = uiTransform?.ox ?? 0;
  const pOy = uiTransform?.oy ?? 0;
  uiTransform = { scale: pScale * scale, ox: pOx + pScale * ox, oy: pOy + pScale * oy, w, h };
}

/** Undo the most recent `pushUiTransform`. */
export function popUiTransform(): void {
  uiTransform = uiTransformStack.pop() ?? null;
}

/** The active UI scale (product of enclosing `scaled` factors, 1 at the root) —
 *  for stroke widths or thresholds that shouldn't scale with the UI. */
export function currentUiScale(): number {
  return uiTransform?.scale ?? 1;
}

/** The width UI code lays out against — the reference size inside a `UI.scaled`
 *  region, else the device viewport. */
export function uiWidth(): number {
  return uiTransform?.w ?? Stage.viewport.w;
}

/** The height UI code lays out against (see `uiWidth`). */
export function uiHeight(): number {
  return uiTransform?.h ?? Stage.viewport.h;
}

// Global UI-scale defaults that the no-arg `UI.scaled(body)` reads: a reference
// size the UI is laid out against, and a multiplier on top. Set once (or never).
let baseSize: { w: number; h: number } | null = null;
let uiScaleSetting = 1;

/** Set the global reference size the UI is designed against — used by the no-arg
 *  `UI.scaled(body)`. Pass `null` to clear. */
export function setBaseSize(size: { w: number; h: number } | null): void {
  baseSize = size;
}

/** Set the global UI-scale multiplier (accessibility / preference), applied on
 *  top of the fit by the no-arg `UI.scaled(body)`. */
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

/** Reset UI-scale state — for tests (see lifecycle `_reset`). */
export function resetUiScale(): void {
  uiTransform = null;
  uiTransformStack.length = 0;
  baseSize = null;
  uiScaleSetting = 1;
}

// Active clip rects (innermost last), stored in SCREEN-logical coords so gating
// is independent of the current UI transform. A widget clipped out of view must
// also be dead to the pointer — otherwise a control scrolled beyond a scroll
// region's visible box (drawn into empty space past it) still catches clicks.
// `clip` pushes/pops these; `uiPointer` deadens the pointer when it's outside.
const pointerClips: { x: number; y: number; w: number; h: number }[] = [];

/** Restrict pointer hits to `rect` until popped — used by `clip`/scroll regions
 *  so clipped-away widgets can't be clicked. `rect` is in the current UI
 *  transform's coords; it's converted to screen-logical coords on the way in. */
export function pushPointerClip(rect: { x: number; y: number; w: number; h: number }): void {
  const scale = uiTransform?.scale ?? 1;
  const ox = uiTransform?.ox ?? 0;
  const oy = uiTransform?.oy ?? 0;
  pointerClips.push({
    x: ox + scale * rect.x,
    y: oy + scale * rect.y,
    w: rect.w * scale,
    h: rect.h * scale,
  });
}

/** Undo the most recent `pushPointerClip`. */
export function popPointerClip(): void {
  pointerClips.pop();
}

/** The pointer as widgets see it: frame-scoped edges, dead while an overlay has
 *  the screen (unless we're in the overlay's own pass), and dead when outside
 *  the active clip region. Falls back to a dead pointer when there's no default
 *  game yet (headless/tests), so widgets still render, they just don't interact. */
export function uiPointer() {
  ensureWired(); // per-frame housekeeping keeps overlay/tooltip state honest
  if (overlayActive && !inOverlayPass) return DEAD_POINTER;
  try {
    const p = rawPointer(); // screen-logical coords
    // Innermost clip is the smallest, so testing it alone is enough (clips nest).
    // Clips are stored in screen coords, so gate before mapping into design coords.
    const clip = pointerClips[pointerClips.length - 1];
    if (clip && !pointInRect(p.x, p.y, clip)) return DEAD_POINTER;
    // Map into the active UI transform's reference coords so a widget's rect (in
    // reference coords) hit-tests against the pointer correctly.
    const t = uiTransform;
    const mapped = t ? { ...p, x: (p.x - t.ox) / t.scale, y: (p.y - t.oy) / t.scale } : p;
    // A drag gesture in progress swallows the click edges (position/wheel stay).
    if (edgesSuppressed)
      return { ...mapped, pressed: false, released: false, down: false, doublePressed: false };
    return mapped;
  } catch {
    return DEAD_POINTER;
  }
}

/** Request a CSS cursor for this frame from UI/widget code — forwards to
 *  `Stage.setCursor` (the engine primitive; cursor is a canvas concern). Reset
 *  every frame, so call it each frame the state holds; higher `priority`
 *  (default 0) wins when several are requested. Re-exported as `UI.setCursor`. */
export function setCursor(cursor: string, priority?: number): void {
  Stage.setCursor(cursor, priority);
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
