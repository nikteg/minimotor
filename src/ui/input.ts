import { ensureWired, inOverlayPass, overlayActive } from "./frame.js";
import { Loop, Pointer } from "../engine/index.js";
import { pointInRect } from "../collision.js";

export const DEAD_POINTER = {
  x: -1e9,
  y: -1e9,
  down: false,
  released: false,
  pressed: false,
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
    wheel: Pointer.wheel,
  };
}

/** The pointer as widgets see it: frame-scoped edges, and dead while an
 *  overlay has the screen (unless we're in the overlay's own pass). Falls
 *  back to a dead pointer when there's no default game yet (headless/tests),
 *  so widgets still render, they just don't interact. */
export function uiPointer() {
  ensureWired(); // per-frame housekeeping keeps overlay/tooltip state honest
  if (overlayActive && !inOverlayPass) return DEAD_POINTER;
  try {
    return rawPointer();
  } catch {
    return DEAD_POINTER;
  }
}

/** Hovering an interactive widget asks for the hand cursor; the engine
 *  resets it every frame, so it clears the moment nothing is hovered. */
export function hoverCursor(hover: boolean): void {
  if (hover) Loop.setCursor("pointer");
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
