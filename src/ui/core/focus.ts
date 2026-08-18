// ---------- Focus & keyboard/gamepad navigation ----------
// The focusable-widget registry + tab order, :focus-visible tracking, the
// keyboard (Tab / Enter / Arrows / Escape) and gamepad (d-pad / left-stick / A)
// navigation that drive the SAME focus machine, and the focus ring. All state
// is per app (two apps on one page each get their own focus machine);
// the single window-level keyboard listener routes each event to the app
// whose canvas (or focused widget) it belongs to.
import { navigation, type GamepadState } from "@src/input/gamepad.js";
import type { App } from "@src/engine/index.js";
import { pointInRect } from "@src/collision/index.js";
import { roundRectPath, theme } from "./theme.js";
import { isInOverlayPass } from "./lifecycle.js";
import { uiPointer, uiToScreen } from "./input.js";
import { allUiApps, currentUiApp, uiGamepads, uiSlot, uiApp, withUiApp } from "./state.js";
import { isMeasuring } from "./measure-pass.js";

// Focusables register in draw order each frame. Keyboard events happen between
// frames, so they operate on the last complete registry rather than a retained
// widget tree.
export interface FocusEntry {
  id: string;
  disabled: boolean;
  overlay: boolean;
  tabIndex: number;
  native: boolean;
  /** Where the widget drew, in SCREEN-logical coords — so a scroll region can
   *  bring a keyboard-focused widget into view (see `focusReveal`). */
  rect?: { x: number; y: number; w: number; h: number };
  focus?: () => void;
  blur?: () => void;
}

/** A rect drawn by one widget that counts as a press on ANOTHER — a
 *  `UI.field` label standing in for the input it labels. Registered in the
 *  coords the proxy drew in, and only for the current frame. */
export interface FocusProxy {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
}

interface FocusState {
  frame: FocusEntry[];
  registry: FocusEntry[];
  /** Proxy rects registered THIS frame, in draw order. The proxy always draws
   *  before its target (a label precedes its input), so a widget can read the
   *  rects standing in for it while it is still deciding what the pointer did. */
  proxies: FocusProxy[];
  focused: string | null;
  // Mirrors browser :focus-visible behavior: pointer focus remains usable but
  // only keyboard traversal paints the dotted focus indicator.
  visible: boolean;
  trapSeen: boolean;
  trapFocusVisible: boolean;
  overlayActive: boolean;
  beforeOverlay: string | null;
  activation: string | null;
  command: { id: string; key: string } | null;
  dismissRequested: boolean;
  // An optional extra pad for integrations that do not register with Input.
  // Hardware and engine-created on-screen pads are discovered automatically.
  navPad: GamepadState | null;
  repeatV: NavRepeat;
  repeatH: NavRepeat;
  // Bumped every time KEYBOARD/pad traversal moves the focus. Scroll regions
  // compare it against the last value they acted on, so they reveal the newly
  // focused widget exactly once and never fight a manual scroll afterwards.
  revealEpoch: number;
}

interface NavRepeat {
  key: string | null;
  elapsed: number;
  next: number;
  count: number;
}

const navRepeat = (): NavRepeat => ({ key: null, elapsed: 0, next: 350, count: 0 });

const fs = uiSlot<FocusState>(() => ({
  frame: [],
  registry: [],
  proxies: [],
  focused: null,
  visible: false,
  trapSeen: false,
  trapFocusVisible: false,
  overlayActive: false,
  beforeOverlay: null,
  activation: null,
  command: null,
  dismissRequested: false,
  navPad: null,
  repeatV: navRepeat(),
  repeatH: navRepeat(),
  revealEpoch: 0,
}));

// Read another app's focus state (keyboard routing) without switching.
const focusOf = (app: App): FocusState => withUiApp(app, fs);

/** Add an unregistered custom UI navigation pad. Hardware and engine-created
 * on-screen pads are discovered automatically, so most games never need this.
 * Pass `null` to remove the custom pad. Per app. */
export function setNavPad(pad: GamepadState | null): void {
  fs().navPad = pad;
}

/** Whether a connected navigation pad is being used right now. This is an
 * input-modality hint for overlays, not merely a connection check: an idle
 * controller should not make a newly opened modal paint a focus ring. */
export function hasActiveNavPad(): boolean {
  const s = fs();
  const registered = uiGamepads();
  const pads = s.navPad ? [s.navPad, ...registered] : registered;
  return pads.some((pad) => {
    if (!pad.connected) return false;
    for (let axis = 0; axis < 4; axis++) if (Math.abs(pad.axis(axis)) > 0.2) return true;
    for (let button = 0; button < 16; button++) if (pad.down(button)) return true;
    return false;
  });
}

let focusKeyboardWired = false;

const focusCanvases = new WeakSet<HTMLCanvasElement>();

// Which app owns a wired canvas — the keyboard listener routes by this.
const appByCanvas = new WeakMap<HTMLCanvasElement, App>();

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
  s.revealEpoch++; // a scroll region should bring the new focus into view
  s.registry.find((entry) => entry.id === id)?.focus?.();
}

/** Whether a scroll region still owes the keyboard-focused widget a reveal,
 *  paired with where that widget drew (SCREEN-logical coords). `seen` is the
 *  epoch the caller last acted on; a region that returns a rect should store
 *  the returned `epoch` so it only scrolls once per focus move. Null when the
 *  focus came from the pointer (the widget was already visible — clicking it
 *  proves it), when nothing is focused, or when the widget hasn't drawn yet. */
export function focusReveal(
  seen: number,
): { epoch: number; rect: { x: number; y: number; w: number; h: number } } | null {
  const s = fs();
  if (!s.visible || s.revealEpoch === seen || !s.focused) return null;
  // This frame's registry first (the widget may have just moved), else the
  // completed one from last frame.
  const entry =
    s.frame.find((e) => e.id === s.focused) ?? s.registry.find((e) => e.id === s.focused);
  return entry?.rect ? { epoch: s.revealEpoch, rect: entry.rect } : null;
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

export function wireFocusCanvas(ctx: CanvasRenderingContext2D, app: App): void {
  const canvas = ctx.canvas;
  if (focusCanvases.has(canvas)) return;
  focusCanvases.add(canvas);
  appByCanvas.set(canvas, app);
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  // The canvas is only a browser focus surface; individual canvas widgets
  // paint their own focus-visible state.
  canvas.style.outline = "none";
  // A mouse/touch press must NOT hand the keyboard to the UI: a game with a HUD
  // button would otherwise lose its arrow keys the moment the player clicks the
  // world (arrows are routed to the focused widget). Tabbing in — or a
  // programmatic `canvas.focus()` — still lands on the first widget, because
  // then no press preceded the focus event.
  let focusFromPress = false;
  canvas.addEventListener("pointerdown", () => {
    focusOf(app).visible = false;
    focusFromPress = true;
    // The browser focuses the canvas within the same task as the press, so the
    // flag only has to survive until this task ends.
    setTimeout(() => (focusFromPress = false), 0);
  });
  canvas.addEventListener("focus", () => {
    if (focusFromPress) return;
    withUiApp(app, () => {
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
    /** The widget's rect in the coords it drew in — recorded (mapped to screen)
     *  so a scroll region can reveal it when the keyboard focuses it. */
    rect?: { x: number; y: number; w: number; h: number };
    focus?: () => void;
    blur?: () => void;
  },
): boolean {
  if (isMeasuring()) return false;
  if (!opts.id) return false;
  const s = fs();
  wireFocusCanvas(ctx, currentUiApp());
  const r = opts.rect;
  const tl = r ? uiToScreen(r.x, r.y) : null;
  const br = r ? uiToScreen(r.x + r.w, r.y + r.h) : null;
  s.frame.push({
    id: opts.id,
    disabled: opts.disabled ?? false,
    overlay: isInOverlayPass(),
    tabIndex: opts.tabIndex ?? 0,
    native: opts.native ?? false,
    rect: tl && br ? { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y } : undefined,
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

/** Register `rect` as standing in for widget `id` for the rest of this frame:
 *  a press inside it is a press on that widget. This is how `UI.field` binds a
 *  label to its input, and it has to live in the kernel — the widget being
 *  proxied is the only code that can act on it, and it draws LATER in the frame.
 *
 *  Without it a label could set the focus id and nothing more: `textInput`
 *  blurs its editor on any press outside its own box, so the field would throw
 *  the focus away on the very frame the label granted it. */
export function registerFocusProxy(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
): void {
  fs().proxies.push({ id, rect });
}

/** This frame's proxy rects for `id`, in the coords they were registered in —
 *  what a widget adds to its own hit area. Empty for the common case. */
export function focusProxies(id: string): { x: number; y: number; w: number; h: number }[] {
  const proxies = fs().proxies;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const proxy of proxies) if (proxy.id === id) out.push(proxy.rect);
  return out;
}

/** Whether the pointer is inside one of this frame's proxy rects for `id` —
 *  the test a widget runs alongside its own `hovered`. */
export function focusProxyHovered(id: string): boolean {
  const proxies = fs().proxies;
  if (proxies.length === 0) return false;
  const p = uiPointer();
  return proxies.some((proxy) => proxy.id === id && pointInRect(p.x, p.y, proxy.rect));
}

export function focusFromPointer(ctx: CanvasRenderingContext2D, id: string | undefined): void {
  if (!id) return;
  const s = fs();
  s.visible = false;
  s.focused = id;
  // **A native widget owns a real DOM element, and focusing the canvas takes
  // focus off it.** For everything else the canvas IS where focus belongs —
  // that is how the kit receives keys at all — but a text field has just put
  // the caret in an offscreen `<input>`, and moving focus to the canvas blurs
  // it. The widget then focuses it straight back, so on a desktop the round
  // trip is invisible and this looked harmless for a long time.
  //
  // It is not harmless on a PHONE. iOS only honours a programmatic `focus()`
  // inside a user gesture: the press listener opens the editor within the
  // gesture and the keyboard comes up, then this line — running a frame later
  // from `requestAnimationFrame`, with no gesture in scope — blurs it, and the
  // re-focus behind it is refused. Reported from an iPhone as the keyboard
  // opening and closing again on every tap, and it is why a long press that
  // released on the field was the only thing that worked.
  //
  // Registration happens before a widget handles its own press, so the entry
  // for `id` is already in this frame's list by the time this runs.
  if (s.frame.some((entry) => entry.id === id && entry.native)) return;
  ctx.canvas.focus({ preventScroll: true });
}

export function drawFocusRing(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const cursor = theme.skin?.sprites.cursor;
  if (cursor) {
    const { region, image } = cursor;
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      region.sx,
      region.sy,
      region.sw,
      region.sh,
      rect.x - region.sw - 4,
      rect.y + (rect.h - region.sh) / 2,
      region.sw,
      region.sh,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(2, theme.borderWidth);
  ctx.setLineDash([4, 3]);
  roundRectPath(ctx, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, theme.radius + 2);
  ctx.stroke();
  ctx.restore();
}

export function consumeKeyboardActivation(id: string | undefined): boolean {
  if (isMeasuring()) return false;
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

/** Consume the current frame's semantic modal-dismiss request (gamepad B or
 * Escape). Modal owns the close action; focus only owns the input convention. */
export function consumeDismissRequest(): boolean {
  if (isMeasuring()) return false;
  const s = fs();
  if (!s.dismissRequested) return false;
  s.dismissRequested = false;
  return true;
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

function repeatPulse(state: NavRepeat, key: string | null): boolean {
  if (!key) {
    state.key = null;
    state.elapsed = state.count = 0;
    state.next = 350;
    return false;
  }
  if (state.key !== key) {
    state.key = key;
    state.elapsed = state.count = 0;
    state.next = 350;
    return true;
  }
  const app = uiApp();
  state.elapsed += app.Loop.step;
  if (state.elapsed < state.next) return false;
  state.count++;
  state.next += Math.max(50, 120 - state.count * 10);
  return true;
}

// Pad navigation drives the SAME focus machine as Tab/Enter (API_PLAN #46).
// Directions fire immediately, then repeat after a short hold with an
// accelerating cadence — sliders adjust smoothly without making menu taps
// overshoot. A activates. Runs per app from its loop's fixed step.
export function padNav(): void {
  const s = fs();
  const registered = uiGamepads();
  const pads = s.navPad ? [s.navPad, ...registered] : registered;
  let x = 0;
  let y = 0;
  let accept = false;
  let cancel = false;
  for (const pad of pads) {
    if (!pad.connected) continue;
    const nav = navigation(pad, { stick: 0 });
    if (Math.abs(nav.x) > Math.abs(x)) x = nav.x;
    if (Math.abs(nav.y) > Math.abs(y)) y = nav.y;
    accept ||= nav.acceptPressed;
    cancel ||= nav.cancelPressed;
  }
  const T = 0.5;
  const vertical = y > T ? "ArrowDown" : y < -T ? "ArrowUp" : null;
  if (repeatPulse(s.repeatV, vertical)) {
    s.visible = true;
    const dir: 1 | -1 = vertical === "ArrowDown" ? 1 : -1;
    const before = s.focused;
    moveWidgetFocus(dir);
    // Focus didn't move — a single candidate, or a trapped overlay (an open
    // select's menu). Feed the direction to the focused widget as an arrow
    // command so it can consume it (walk the option list) instead of stalling.
    if (s.focused && s.focused === before) {
      s.command = { id: s.focused, key: dir > 0 ? "ArrowDown" : "ArrowUp" };
    }
  }
  const horizontal = x > T ? "ArrowRight" : x < -T ? "ArrowLeft" : null;
  const horizontalPulse = repeatPulse(s.repeatH, horizontal);
  if (cancel) s.dismissRequested = true;
  if (!s.focused) return;
  if (accept) s.activation = s.focused;
  if (horizontalPulse) s.command = { id: s.focused, key: horizontal as "ArrowLeft" | "ArrowRight" };
}

// Window keyboard wiring: Tab/Shift+Tab traverse, Enter/Space activate, Arrows
// feed the focused widget, Escape blurs — all keyed off the canvas focus
// surfaces so page chrome keeps its own keyboard. ONE window listener for the
// page; each event is routed to the app that owns the target canvas (or,
// for native editors and pad-driven focus, whichever app holds a focused
// widget). Idempotent; called by `ensureWired`.
export function wireFocusKeyboard(): void {
  if (focusKeyboardWired || typeof window === "undefined") return;
  focusKeyboardWired = true;
  const routeTo = (target: HTMLElement | null): App | null => {
    if (target instanceof HTMLCanvasElement) {
      const app = appByCanvas.get(target);
      if (app) return app;
    }
    for (const app of allUiApps) {
      if (focusOf(app).focused) return app;
    }
    return null;
  };
  window.addEventListener(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement | null;
      const app = routeTo(target);
      if (!app) return;
      withUiApp(app, () => {
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
        } else if (s.focused && !entry?.native && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          s.activation = s.focused;
        } else if (s.focused && !entry?.native && event.key.startsWith("Arrow")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          s.command = { id: s.focused, key: event.key };
        } else if (event.key === "Escape" && !entry?.native) {
          if (s.overlayActive) s.dismissRequested = true;
          else blur();
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
      for (const app of allUiApps) {
        withUiApp(app, () => setWidgetFocus(null));
      }
    }
  });
}

// Frame-end: promote this frame's registration to the live registry, then handle
// the overlay focus trap (capture focus into an overlay while it's up, restore it
// after). Called per app by the kernel's housekeeping; resets `trapSeen` for
// next frame.
export function focusEndFrame(): void {
  const s = fs();
  s.registry = s.frame;
  s.frame = [];
  s.proxies.length = 0;
  const wasFocusOverlay = s.overlayActive;
  if (!wasFocusOverlay && s.trapSeen) s.beforeOverlay = s.focused;
  s.overlayActive = s.trapSeen;
  const candidates = focusCandidates();
  if (!wasFocusOverlay && s.overlayActive && s.trapFocusVisible && candidates.length) {
    s.visible = true;
  }
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
  s.trapFocusVisible = false;
  s.dismissRequested = false;
}

/** An overlay ran this frame — trap focus into it (called by `enterOverlay`). */
export function markFocusTrap(focusVisible = false): void {
  const s = fs();
  s.trapSeen = true;
  s.trapFocusVisible ||= focusVisible;
}
