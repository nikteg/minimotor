import { ensureWired, inOverlayPass, overlayActive } from "./frame.js";
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

// Active clip rects (innermost last). A widget clipped out of view must also be
// dead to the pointer — otherwise a control scrolled beyond a scroll region's
// visible box (drawn into empty space past it) still catches clicks. `clip`
// pushes/pops these; `uiPointer` deadens the pointer when it's outside.
const pointerClips: { x: number; y: number; w: number; h: number }[] = [];

/** Restrict pointer hits to `rect` until popped — used by `clip`/scroll regions
 *  so clipped-away widgets can't be clicked. */
export function pushPointerClip(rect: { x: number; y: number; w: number; h: number }): void {
  pointerClips.push(rect);
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
    const p = rawPointer();
    // Innermost clip is the smallest, so testing it alone is enough (clips nest).
    const clip = pointerClips[pointerClips.length - 1];
    if (clip && !pointInRect(p.x, p.y, clip)) return DEAD_POINTER;
    return p;
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
