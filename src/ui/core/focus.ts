// ---------- Focus & keyboard/gamepad navigation ----------
// The focusable-widget registry + tab order, :focus-visible tracking, the
// keyboard (Tab / Enter / Arrows / Escape) and gamepad (d-pad / left-stick / A)
// navigation that drive the SAME focus machine, and the focus ring. Extracted
// from the frame kernel; the one thing it borrows back is the overlay-pass flag
// (`inOverlayPass`), which still lives in frame.ts alongside the overlay widgets.
import { gamepad, Buttons } from "../../input/gamepad.js";
import { roundRectPath, theme } from "./theme.js";
import { inOverlayPass } from "./lifecycle.js";

// Focusables register in draw order each frame. Keyboard events happen between
// frames, so they operate on the last complete registry rather than a retained
// widget tree.
export interface FocusEntry {
  id: string;
  disabled: boolean;
  overlay: boolean;
  tabIndex: number;
  native: boolean;
  focus?: () => void;
  blur?: () => void;
}

export let focusFrame: FocusEntry[] = [];

export let focusRegistry: FocusEntry[] = [];

export let focusedWidget: string | null = null;

// Mirrors browser :focus-visible behavior: pointer focus remains usable but
// only keyboard traversal paints the dotted focus indicator.
export let focusVisible = false;

export let focusTrapSeen = false;

export let focusOverlayActive = false;

export let focusBeforeOverlay: string | null = null;

// The gamepad that drives UI focus navigation (dpad moves focus, A activates,
// dpad left/right feed the focused slider). Defaults to hardware pad 0; a game
// with an on-screen gamepad calls `UI.setNavPad(pad)` so its virtual dpad drives
// menus too (a fused pad covers hardware + touch at once).
export let navPad: ReturnType<typeof gamepad> | null = null;

// Last left-stick vector, for edge-detecting stick-driven menu nav in `padNav`.
let lastNavStick = { x: 0, y: 0 };

/** Route UI focus navigation (gamepad dpad/A) through `pad` — e.g. an on-screen
 *  gamepad, so its virtual dpad walks the focusable widgets and A activates.
 *  Pass `null` to fall back to hardware pad 0. */
export function setNavPad(pad: ReturnType<typeof gamepad> | null): void {
  navPad = pad;
}

export let keyboardActivation: string | null = null;

export let keyboardCommand: { id: string; key: string } | null = null;

export let focusKeyboardWired = false;

export const focusCanvases = new WeakSet<HTMLCanvasElement>();

export function focusCandidates(): FocusEntry[] {
  const entries = focusOverlayActive
    ? focusRegistry.filter((entry) => entry.overlay)
    : focusRegistry;
  return (
    entries
      .filter((entry) => !entry.disabled && entry.tabIndex >= 0)
      .map((entry, order) => ({ entry, order }))
      // DOM tab-order semantics: a POSITIVE tabIndex is focused before the
      // default 0 (positives ascending), then everything at 0 in registration
      // order. So explicit chrome (tabs/buttons at 10/20/…) leads the sequence
      // and content that just defaults to 0 (list rows) follows — not the other
      // way around.
      .sort((a, b) => {
        const ta = a.entry.tabIndex;
        const tb = b.entry.tabIndex;
        if (ta > 0 && tb > 0) return ta - tb || a.order - b.order;
        if (ta > 0) return -1;
        if (tb > 0) return 1;
        return a.order - b.order;
      })
      .map(({ entry }) => entry)
  );
}

export function setWidgetFocus(id: string | null): void {
  if (focusedWidget === id) return;
  focusRegistry.find((entry) => entry.id === focusedWidget)?.blur?.();
  focusedWidget = id;
  focusRegistry.find((entry) => entry.id === id)?.focus?.();
}

export function moveWidgetFocus(direction: 1 | -1): void {
  const entries = focusCandidates();
  if (!entries.length) return setWidgetFocus(null);
  const current = entries.findIndex((entry) => entry.id === focusedWidget);
  const next =
    current < 0
      ? direction > 0
        ? 0
        : entries.length - 1
      : (current + direction + entries.length) % entries.length;
  setWidgetFocus(entries[next].id);
}

export function wireFocusCanvas(ctx: CanvasRenderingContext2D): void {
  const canvas = ctx.canvas;
  if (focusCanvases.has(canvas)) return;
  focusCanvases.add(canvas);
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  // The canvas is only a browser focus surface; individual canvas widgets
  // paint their own focus-visible state.
  canvas.style.outline = "none";
  canvas.addEventListener("pointerdown", () => {
    focusVisible = false;
  });
  canvas.addEventListener("focus", () => {
    if (!focusedWidget) moveWidgetFocus(1);
  });
}

export function registerFocusable(
  ctx: CanvasRenderingContext2D,
  opts: {
    id?: string;
    disabled?: boolean;
    tabIndex?: number;
    native?: boolean;
    focus?: () => void;
    blur?: () => void;
  },
): boolean {
  if (!opts.id) return false;
  wireFocusCanvas(ctx);
  focusFrame.push({
    id: opts.id,
    disabled: opts.disabled ?? false,
    overlay: inOverlayPass,
    tabIndex: opts.tabIndex ?? 0,
    native: opts.native ?? false,
    focus: opts.focus,
    blur: opts.blur,
  });
  return focusVisible && focusedWidget === opts.id;
}

export function markFocusableOverlay(id: string): void {
  const entry = [...focusFrame].reverse().find((item) => item.id === id);
  if (entry) entry.overlay = true;
}

export function focusFromPointer(ctx: CanvasRenderingContext2D, id: string | undefined): void {
  if (!id) return;
  focusVisible = false;
  focusedWidget = id;
  ctx.canvas.focus({ preventScroll: true });
}

export function drawFocusRing(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): void {
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(2, theme.borderWidth);
  ctx.setLineDash([4, 3]);
  roundRectPath(ctx, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, theme.radius + 2);
  ctx.stroke();
  ctx.restore();
}

export function consumeKeyboardActivation(id: string | undefined): boolean {
  if (!id || keyboardActivation !== id) return false;
  keyboardActivation = null;
  return true;
}

export function consumeKeyboardCommand(id: string | undefined): string | null {
  if (!id || keyboardCommand?.id !== id) return null;
  const key = keyboardCommand.key;
  keyboardCommand = null;
  return key;
}

/** Move keyboard focus to a registered widget. */
export function focus(id: string): void {
  if (focusRegistry.some((entry) => entry.id === id && !entry.disabled)) {
    focusVisible = true;
    setWidgetFocus(id);
  }
}

/** Clear canvas-widget keyboard focus. */
export function blur(): void {
  setWidgetFocus(null);
}

/** The currently focused widget id, or `null`. */
export function focusedId(): string | null {
  return focusedWidget;
}

/** Move to the next/previous widget in the most recently drawn tab order. */
export function focusNext(): void {
  moveWidgetFocus(1);
}

/** Move to the previous widget in the most recently drawn tab order. The
 *  reverse of `focusNext`. */
export function focusPrevious(): void {
  moveWidgetFocus(-1);
}

// Pad navigation drives the SAME focus machine as Tab/Enter (API_PLAN #46):
// dpad up/down traverse, dpad left/right feed the focused widget (sliders),
// A activates. Spatial (geometry-based) traversal is a planned refinement.
export function padNav(): void {
  let pad: ReturnType<typeof gamepad>;
  try {
    pad = navPad ?? gamepad();
  } catch {
    return;
  }
  if (!pad.connected) return;
  // Left-stick nav, edge-detected (one step per flick past the threshold) — ONLY
  // when a nav pad is explicitly wired via setNavPad, so a game's movement stick
  // never hijacks menu focus. The d-pad always navigates.
  let stickV = 0;
  let stickH = 0;
  if (navPad) {
    const T = 0.5;
    const sx = pad.axis(0);
    const sy = pad.axis(1);
    if (sy > T && lastNavStick.y <= T) stickV = 1;
    else if (sy < -T && lastNavStick.y >= -T) stickV = -1;
    if (sx > T && lastNavStick.x <= T) stickH = 1;
    else if (sx < -T && lastNavStick.x >= -T) stickH = -1;
    lastNavStick = { x: sx, y: sy };
  }
  const down = pad.pressed(Buttons.DpadDown) || stickV > 0;
  const up = pad.pressed(Buttons.DpadUp) || stickV < 0;
  if (down || up) {
    focusVisible = true;
    const dir: 1 | -1 = down ? 1 : -1;
    const before = focusedWidget;
    moveWidgetFocus(dir);
    // Focus didn't move — a single candidate, or a trapped overlay (an open
    // select's menu). Feed the direction to the focused widget as an arrow
    // command so it can consume it (walk the option list) instead of stalling.
    if (focusedWidget && focusedWidget === before) {
      keyboardCommand = { id: focusedWidget, key: dir > 0 ? "ArrowDown" : "ArrowUp" };
    }
  }
  if (!focusedWidget) return;
  if (pad.pressed(Buttons.A)) keyboardActivation = focusedWidget;
  if (pad.pressed(Buttons.DpadLeft) || stickH < 0)
    keyboardCommand = { id: focusedWidget, key: "ArrowLeft" };
  if (pad.pressed(Buttons.DpadRight) || stickH > 0)
    keyboardCommand = { id: focusedWidget, key: "ArrowRight" };
}

// Window keyboard wiring: Tab/Shift+Tab traverse, Enter/Space activate, Arrows
// feed the focused widget, Escape blurs — all keyed off the canvas focus surface
// so page chrome keeps its own keyboard. Idempotent; called by `ensureWired`.
export function wireFocusKeyboard(): void {
  if (focusKeyboardWired || typeof window === "undefined") return;
  focusKeyboardWired = true;
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Tab") focusVisible = true;
      const target = event.target as HTMLElement | null;
      const onFocusSurface =
        !!focusedWidget ||
        target?.dataset?.minimotorUi === "true" ||
        (target instanceof HTMLCanvasElement && focusCanvases.has(target));
      if (!onFocusSurface) return;
      const entry = focusRegistry.find((item) => item.id === focusedWidget);
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        moveWidgetFocus(event.shiftKey ? -1 : 1);
      } else if (!entry?.native && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (focusedWidget) keyboardActivation = focusedWidget;
      } else if (!entry?.native && event.key.startsWith("Arrow")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (focusedWidget) keyboardCommand = { id: focusedWidget, key: event.key };
      } else if (event.key === "Escape" && !entry?.native) {
        blur();
      }
    },
    true,
  );
  window.addEventListener("focusin", (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.dataset?.minimotorUi !== "true" &&
      !(target instanceof HTMLCanvasElement && focusCanvases.has(target))
    ) {
      setWidgetFocus(null);
    }
  });
}

// Frame-end: promote this frame's registration to the live registry, then handle
// the overlay focus trap (capture focus into an overlay while it's up, restore it
// after). Called by `ensureWired`'s onFrame; resets `focusTrapSeen` for next frame.
export function focusEndFrame(): void {
  focusRegistry = focusFrame;
  focusFrame = [];
  const wasFocusOverlay = focusOverlayActive;
  if (!wasFocusOverlay && focusTrapSeen) focusBeforeOverlay = focusedWidget;
  focusOverlayActive = focusTrapSeen;
  const candidates = focusCandidates();
  const focusMissing = !candidates.some((entry) => entry.id === focusedWidget);
  if (focusMissing && (focusedWidget || focusOverlayActive)) {
    const restore =
      !focusOverlayActive &&
      wasFocusOverlay &&
      candidates.some((entry) => entry.id === focusBeforeOverlay)
        ? focusBeforeOverlay
        : null;
    setWidgetFocus(focusOverlayActive && candidates.length ? candidates[0].id : restore);
  }
  if (wasFocusOverlay && !focusOverlayActive) focusBeforeOverlay = null;
  focusTrapSeen = false;
}

/** An overlay ran this frame — trap focus into it (called by `enterOverlay`). */
export function markFocusTrap(): void {
  focusTrapSeen = true;
}

/** Reset all focus state — for tests (see frame `_reset`). */
export function resetFocus(): void {
  focusFrame = [];
  focusRegistry = [];
  focusedWidget = null;
  focusVisible = false;
  focusTrapSeen = false;
  focusOverlayActive = false;
  focusBeforeOverlay = null;
  keyboardActivation = null;
  keyboardCommand = null;
  navPad = null;
  lastNavStick = { x: 0, y: 0 };
}
