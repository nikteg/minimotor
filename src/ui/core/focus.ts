// ---------- Focus & keyboard/gamepad navigation ----------
// The focusable-widget registry + tab order, :focus-visible tracking, the
// keyboard (Tab / Enter / Arrows / Escape) and gamepad (d-pad / left-stick / A)
// navigation that drive the SAME focus machine, and the focus ring. All state
// is per UI runtime (two apps on one page each get their own focus machine);
// the single window-level keyboard listener routes each event to the runtime
// whose canvas (or focused widget) it belongs to.
import { gamepad, Buttons } from "../../input/gamepad.js";
import { roundRectPath, theme } from "./theme.js";
import { isInOverlayPass } from "./lifecycle.js";
import {
  type UiRuntime,
  allRuntimes,
  currentRuntime,
  runtimeSlot,
  withRuntime,
} from "./runtime.js";

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

interface FocusState {
  frame: FocusEntry[];
  registry: FocusEntry[];
  focused: string | null;
  // Mirrors browser :focus-visible behavior: pointer focus remains usable but
  // only keyboard traversal paints the dotted focus indicator.
  visible: boolean;
  trapSeen: boolean;
  overlayActive: boolean;
  beforeOverlay: string | null;
  activation: string | null;
  command: { id: string; key: string } | null;
  // The gamepad that drives UI focus navigation (dpad moves focus, A activates,
  // dpad left/right feed the focused slider). Defaults to hardware pad 0; a game
  // with an on-screen gamepad calls `UI.setNavPad(pad)` so its virtual dpad
  // drives menus too (a fused pad covers hardware + touch at once).
  navPad: ReturnType<typeof gamepad> | null;
  // Last left-stick vector, for edge-detecting stick-driven menu nav in padNav.
  lastNavStick: { x: number; y: number };
}

const fs = runtimeSlot<FocusState>(() => ({
  frame: [],
  registry: [],
  focused: null,
  visible: false,
  trapSeen: false,
  overlayActive: false,
  beforeOverlay: null,
  activation: null,
  command: null,
  navPad: null,
  lastNavStick: { x: 0, y: 0 },
}));

// Read another runtime's focus state (keyboard routing) without switching.
const focusOf = (rt: UiRuntime): FocusState => withRuntime(rt, fs);

/** Route UI focus navigation (gamepad dpad/A) through `pad` — e.g. an on-screen
 *  gamepad, so its virtual dpad walks the focusable widgets and A activates.
 *  Pass `null` to fall back to hardware pad 0. Per UI runtime. */
export function setNavPad(pad: ReturnType<typeof gamepad> | null): void {
  fs().navPad = pad;
}

let focusKeyboardWired = false;

const focusCanvases = new WeakSet<HTMLCanvasElement>();

// Which runtime owns a wired canvas — the keyboard listener routes by this.
const runtimeByCanvas = new WeakMap<HTMLCanvasElement, UiRuntime>();

export function focusCandidates(): FocusEntry[] {
  const s = fs();
  const entries = s.overlayActive ? s.registry.filter((entry) => entry.overlay) : s.registry;
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
  const s = fs();
  if (s.focused === id) return;
  s.registry.find((entry) => entry.id === s.focused)?.blur?.();
  s.focused = id;
  s.registry.find((entry) => entry.id === id)?.focus?.();
}

export function moveWidgetFocus(direction: 1 | -1): void {
  const s = fs();
  const entries = focusCandidates();
  if (!entries.length) return setWidgetFocus(null);
  const current = entries.findIndex((entry) => entry.id === s.focused);
  const next =
    current < 0
      ? direction > 0
        ? 0
        : entries.length - 1
      : (current + direction + entries.length) % entries.length;
  setWidgetFocus(entries[next].id);
}

export function wireFocusCanvas(ctx: CanvasRenderingContext2D, rt: UiRuntime): void {
  const canvas = ctx.canvas;
  if (focusCanvases.has(canvas)) return;
  focusCanvases.add(canvas);
  runtimeByCanvas.set(canvas, rt);
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  // The canvas is only a browser focus surface; individual canvas widgets
  // paint their own focus-visible state.
  canvas.style.outline = "none";
  canvas.addEventListener("pointerdown", () => {
    focusOf(rt).visible = false;
  });
  canvas.addEventListener("focus", () => {
    withRuntime(rt, () => {
      if (!fs().focused) moveWidgetFocus(1);
    });
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
  const s = fs();
  wireFocusCanvas(ctx, currentRuntime());
  s.frame.push({
    id: opts.id,
    disabled: opts.disabled ?? false,
    overlay: isInOverlayPass(),
    tabIndex: opts.tabIndex ?? 0,
    native: opts.native ?? false,
    focus: opts.focus,
    blur: opts.blur,
  });
  return s.visible && s.focused === opts.id;
}

export function markFocusableOverlay(id: string): void {
  const frame = fs().frame;
  for (let i = frame.length - 1; i >= 0; i--) {
    if (frame[i].id === id) {
      frame[i].overlay = true;
      return;
    }
  }
}

export function focusFromPointer(ctx: CanvasRenderingContext2D, id: string | undefined): void {
  if (!id) return;
  const s = fs();
  s.visible = false;
  s.focused = id;
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
  const s = fs();
  if (!id || s.activation !== id) return false;
  s.activation = null;
  return true;
}

export function consumeKeyboardCommand(id: string | undefined): string | null {
  const s = fs();
  if (!id || s.command?.id !== id) return null;
  const key = s.command.key;
  s.command = null;
  return key;
}

/** Move keyboard focus to a registered widget. */
export function focus(id: string): void {
  const s = fs();
  if (s.registry.some((entry) => entry.id === id && !entry.disabled)) {
    s.visible = true;
    setWidgetFocus(id);
  }
}

/** Clear canvas-widget keyboard focus. */
export function blur(): void {
  setWidgetFocus(null);
}

/** The currently focused widget id, or `null`. */
export function focusedId(): string | null {
  return fs().focused;
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
// Runs per runtime, from its host loop's step.
export function padNav(): void {
  const s = fs();
  let pad: ReturnType<typeof gamepad>;
  try {
    pad = s.navPad ?? gamepad();
  } catch {
    return;
  }
  if (!pad.connected) return;
  // Left-stick nav, edge-detected (one step per flick past the threshold) — ONLY
  // when a nav pad is explicitly wired via setNavPad, so a game's movement stick
  // never hijacks menu focus. The d-pad always navigates.
  let stickV = 0;
  let stickH = 0;
  if (s.navPad) {
    const T = 0.5;
    const sx = pad.axis(0);
    const sy = pad.axis(1);
    if (sy > T && s.lastNavStick.y <= T) stickV = 1;
    else if (sy < -T && s.lastNavStick.y >= -T) stickV = -1;
    if (sx > T && s.lastNavStick.x <= T) stickH = 1;
    else if (sx < -T && s.lastNavStick.x >= -T) stickH = -1;
    s.lastNavStick = { x: sx, y: sy };
  }
  const down = pad.pressed(Buttons.DpadDown) || stickV > 0;
  const up = pad.pressed(Buttons.DpadUp) || stickV < 0;
  if (down || up) {
    s.visible = true;
    const dir: 1 | -1 = down ? 1 : -1;
    const before = s.focused;
    moveWidgetFocus(dir);
    // Focus didn't move — a single candidate, or a trapped overlay (an open
    // select's menu). Feed the direction to the focused widget as an arrow
    // command so it can consume it (walk the option list) instead of stalling.
    if (s.focused && s.focused === before) {
      s.command = { id: s.focused, key: dir > 0 ? "ArrowDown" : "ArrowUp" };
    }
  }
  if (!s.focused) return;
  if (pad.pressed(Buttons.A)) s.activation = s.focused;
  if (pad.pressed(Buttons.DpadLeft) || stickH < 0) s.command = { id: s.focused, key: "ArrowLeft" };
  if (pad.pressed(Buttons.DpadRight) || stickH > 0)
    s.command = { id: s.focused, key: "ArrowRight" };
}

// Window keyboard wiring: Tab/Shift+Tab traverse, Enter/Space activate, Arrows
// feed the focused widget, Escape blurs — all keyed off the canvas focus
// surfaces so page chrome keeps its own keyboard. ONE window listener for the
// page; each event is routed to the runtime that owns the target canvas (or,
// for native editors and pad-driven focus, whichever runtime holds a focused
// widget). Idempotent; called by `ensureWired`.
export function wireFocusKeyboard(): void {
  if (focusKeyboardWired || typeof window === "undefined") return;
  focusKeyboardWired = true;
  const routeTo = (target: HTMLElement | null): UiRuntime | null => {
    if (target instanceof HTMLCanvasElement) {
      const rt = runtimeByCanvas.get(target);
      if (rt) return rt;
    }
    for (const rt of allRuntimes) {
      if (focusOf(rt).focused) return rt;
    }
    return null;
  };
  window.addEventListener(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement | null;
      const rt = routeTo(target);
      if (!rt) return;
      withRuntime(rt, () => {
        const s = fs();
        if (event.key === "Tab") s.visible = true;
        const onFocusSurface =
          !!s.focused ||
          target?.dataset?.minimotorUi === "true" ||
          (target instanceof HTMLCanvasElement && focusCanvases.has(target));
        if (!onFocusSurface) return;
        const entry = s.registry.find((item) => item.id === s.focused);
        if (event.key === "Tab") {
          event.preventDefault();
          event.stopImmediatePropagation();
          moveWidgetFocus(event.shiftKey ? -1 : 1);
        } else if (!entry?.native && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (s.focused) s.activation = s.focused;
        } else if (!entry?.native && event.key.startsWith("Arrow")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (s.focused) s.command = { id: s.focused, key: event.key };
        } else if (event.key === "Escape" && !entry?.native) {
          blur();
        }
      });
    },
    true,
  );
  window.addEventListener("focusin", (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.dataset?.minimotorUi !== "true" &&
      !(target instanceof HTMLCanvasElement && focusCanvases.has(target))
    ) {
      // Browser focus left every UI surface — clear widget focus everywhere.
      for (const rt of allRuntimes) {
        withRuntime(rt, () => setWidgetFocus(null));
      }
    }
  });
}

// Frame-end: promote this frame's registration to the live registry, then handle
// the overlay focus trap (capture focus into an overlay while it's up, restore it
// after). Called per runtime by the kernel's housekeeping; resets `trapSeen` for
// next frame.
export function focusEndFrame(): void {
  const s = fs();
  s.registry = s.frame;
  s.frame = [];
  const wasFocusOverlay = s.overlayActive;
  if (!wasFocusOverlay && s.trapSeen) s.beforeOverlay = s.focused;
  s.overlayActive = s.trapSeen;
  const candidates = focusCandidates();
  const focusMissing = !candidates.some((entry) => entry.id === s.focused);
  if (focusMissing && (s.focused || s.overlayActive)) {
    const restore =
      !s.overlayActive &&
      wasFocusOverlay &&
      candidates.some((entry) => entry.id === s.beforeOverlay)
        ? s.beforeOverlay
        : null;
    setWidgetFocus(s.overlayActive && candidates.length ? candidates[0].id : restore);
  }
  if (wasFocusOverlay && !s.overlayActive) s.beforeOverlay = null;
  s.trapSeen = false;
}

/** An overlay ran this frame — trap focus into it (called by `enterOverlay`). */
export function markFocusTrap(): void {
  fs().trapSeen = true;
}
