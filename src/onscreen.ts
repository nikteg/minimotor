// ---------- On-screen touch controls ----------
// An opt-in virtual gamepad that renders on the canvas and feeds the SAME input
// path as a hardware pad. `OnscreenInput.gamepad(config)` returns a
// `GamepadState` (drop it straight into `Input.map({ pad })`); `drawControls`
// renders it each frame. Touch and a real controller are one code path: the
// touch state is turned into a synthetic standard-mapping gamepad, optionally
// FUSED with a hardware pad (button = either, axis = larger magnitude), then run
// through the very same `createGamepadTracker` the hardware pad uses — so
// `pressed`/`released` stay edge-correct no matter which source acted.
//
// It lives ABOVE both `Input` (pixel-free) and `UI` (already depends on Input):
// nesting it in `Input` would force `Input → UI` and cycle. Multi-touch uses its
// own `pointerId`-keyed listeners + `setPointerCapture`, because the engine
// `Pointer` collapses to a single touch.
//
//   const pad = OnscreenInput.gamepad({
//     stick: { anchor: { side: "left", x: 90, y: 90 }, radius: 60 },
//     buttons: [{ anchor: { side: "right", x: 70, y: 70 }, r: 34, button: "a", label: "A" }],
//   });
//   const input = Input.map({ jump: ["Space", "pad:a"], left: ["KeyA", "pad:lstick-left"] }, { pad });
//   // draw(): OnscreenInput.drawControls(pad);

import { Draw, App } from "./engine/index.js";
import { Loop } from "./engine/index.js";
import { Buttons, createGamepadTracker, type GamepadState, type PadButton } from "./input/index.js";
import { getTheme } from "./ui/core/theme.js";

/** Placement inset from a bottom corner, in logical px. `y` counts UP from the
 *  bottom edge, so a layout survives aspect-ratio / resolution changes. */
export type Anchor = { side: "left" | "right"; x: number; y: number };

/** Haptics for a button — fires `navigator.vibrate` on touch-down (opt-in,
 *  silent no-op where unsupported). */
export interface HapticsConfig {
  /** Pulse duration in ms. Default 12. */
  ms?: number;
  /** A `navigator.vibrate()` pattern; overrides `ms`. */
  pattern?: number[];
  /** Buzz on press. Default true. */
  onPress?: boolean;
  /** Buzz on release. Default false. */
  onRelease?: boolean;
}

/** The LEFT analog stick — auto-binds to standard `lstick` axes `0`/`1`
 *  (readable as `pad:lstick-*` or `pad.axis(0)`/`pad.axis(1)`). */
export interface StickSpec {
  /** Fixed center of the stick base. */
  anchor: Anchor;
  /** Travel radius in px — a finger at the rim reads magnitude `1`. */
  radius: number;
  /** Radial deadzone `0..1` applied before the tracker's own. Default 0. */
  deadzone?: number;
}

/** One RIGHT-cluster (or custom) button. Give `button` to feed a `pad:` binding,
 *  or `onTap`/`onHold` for an unmapped control (pause, inventory). */
export interface ButtonSpec {
  /** Center of the button. */
  anchor: Anchor;
  /** Radius in px. */
  r: number;
  /** Glyph drawn in the center. */
  label?: string;
  /** Standard-mapping button this actuates — read via `pad:<button>`. */
  button?: PadButton;
  /** Unmapped tap callback (fires on release). */
  onTap?: () => void;
  /** Unmapped press/release callback (`true` on down, `false` on up). */
  onHold?: (down: boolean) => void;
  /** Per-button haptics override. */
  haptics?: boolean | HapticsConfig;
  /** Evaluated each frame: return `true` to gray the button out and ignore
   *  touches on it (e.g. an "ENTER CAR" button that's live only when near a
   *  car). Omit for an always-active button. */
  disabled?: () => boolean;
}

/** Shape of an on-screen gamepad passed to `gamepad()`: an optional left/right
 *  `stick` plus a `buttons` cluster, drawn as translucent touch controls on the
 *  canvas. Touches drive a synthetic standard-mapping pad, fused with a real
 *  controller by default (`merge`), so `pad:` bindings in `Input.map` work
 *  identically from either source. */
export interface OnscreenGamepadConfig {
  /** Fuse with a hardware pad: `true` = pad `0` (unplugged contributes
   *  nothing), a number = that index, `false` = touch-only. Default true. */
  merge?: boolean | number;
  /** Show only while touch is the live input source; hide on desktop or when a
   *  real pad acts (visual only — input keeps feeding). Default true. */
  autohide?: boolean;
  /** Fade duration in ms for autohide. Default 200; `0` = instant. */
  autohideFadeMs?: number;
  /** Control opacity `0..1`. Default 0.5. */
  opacity?: number;
  /** Default haptics for mapped buttons. Default false. */
  haptics?: boolean | HapticsConfig;
  /** The left analog stick — binds to `lstick` axes 0/1. */
  stick?: StickSpec;
  /** An optional RIGHT analog stick — binds to `rstick` axes 2/3 (`pad:rstick-*`
   *  or `pad.axis(2)`/`pad.axis(3)`). Add it for twin-stick controls (move with
   *  the left, aim/fire with the right). */
  rightStick?: StickSpec;
  /** The button cluster (>= 2 recommended) plus any custom buttons. */
  buttons?: ButtonSpec[];
}

/** What `OnscreenInput.gamepad` returns: a `GamepadState` (for `Input.map`) that
 *  also knows how to render itself via `OnscreenInput.drawControls`. */
export type OnscreenPad = GamepadState;

// ---------- Pure helpers (exported for tests) ----------

/** Standard-mapping index for a face/shoulder/dpad `PadButton` (undefined for
 *  stick pseudo-buttons, which are axes, not buttons). */
export function padButtonIndex(button: PadButton): number | undefined {
  return PAD_INDEX[button];
}

const PAD_INDEX: Partial<Record<PadButton, number>> = {
  a: Buttons.A,
  b: Buttons.B,
  x: Buttons.X,
  y: Buttons.Y,
  l1: Buttons.L1,
  r1: Buttons.R1,
  l2: Buttons.L2,
  r2: Buttons.R2,
  select: Buttons.Select,
  start: Buttons.Start,
  l3: Buttons.L3,
  r3: Buttons.R3,
  "dpad-up": Buttons.DpadUp,
  "dpad-down": Buttons.DpadDown,
  "dpad-left": Buttons.DpadLeft,
  "dpad-right": Buttons.DpadRight,
};

/** Stick vector `-1..1` from a finger offset `(dx, dy)` relative to the base
 *  center, clamped to the rim and rescaled past the deadzone. Screen `y` grows
 *  down, matching standard `lstick` axis 1 (down = positive). */
export function computeStick(
  dx: number,
  dy: number,
  radius: number,
  deadzone = 0,
): { x: number; y: number } {
  const mag = Math.hypot(dx, dy);
  if (mag === 0 || radius <= 0) return { x: 0, y: 0 };
  const n = Math.min(mag / radius, 1);
  if (n <= deadzone) return { x: 0, y: 0 };
  const scaled = (n - deadzone) / (1 - deadzone);
  return { x: (dx / mag) * scaled, y: (dy / mag) * scaled };
}

/** A raw pad snapshot the tracker understands: connection, button pressed
 *  flags, and axis values. */
export interface RawPad {
  connected: boolean;
  buttons: { pressed: boolean }[];
  axes: number[];
}

const maxMag = (a: number, b: number): number => (Math.abs(a) >= Math.abs(b) ? a : b);

/** Raw-level fusion: button = touch OR hardware, axis = larger magnitude. Keeps
 *  edge semantics correct when the same action comes from both sources. */
export function fuseGamepad(touch: RawPad, hw: RawPad | null): RawPad {
  if (!hw || !hw.connected) return touch;
  const nButtons = Math.max(touch.buttons.length, hw.buttons.length);
  const buttons: { pressed: boolean }[] = [];
  for (let i = 0; i < nButtons; i++) {
    buttons[i] = {
      pressed: (touch.buttons[i]?.pressed ?? false) || (hw.buttons[i]?.pressed ?? false),
    };
  }
  const nAxes = Math.max(touch.axes.length, hw.axes.length);
  const axes: number[] = [];
  for (let i = 0; i < nAxes; i++) axes[i] = maxMag(touch.axes[i] ?? 0, hw.axes[i] ?? 0);
  return { connected: true, buttons, axes };
}

// ---------- Internal per-pad state ----------

interface ResolvedConfig {
  mergeIndex: number | null;
  autohide: boolean;
  fadeMs: number;
  opacity: number;
  haptics: boolean | HapticsConfig;
  stick?: StickSpec;
  rightStick?: StickSpec;
  buttons: ButtonSpec[];
}

type Which = "left" | "right";
type TouchTarget = { kind: "stick"; which: Which } | { kind: "button"; spec: ButtonSpec };

interface PadInternal {
  cfg: ResolvedConfig;
  tracker: GamepadState & { poll(): void };
  stick: { x: number; y: number };
  rstick: { x: number; y: number };
  pointers: Map<number, TouchTarget>;
  lastSource: "touch" | "hardware";
  coarse: boolean;
  fade: number; // 0..1 current render multiplier
  lastFrameTs: number;
  wantPaint: boolean; // set by drawControls(), consumed by the onFrame paint
  wired: boolean;
  listening: boolean;
}

const registry = new WeakMap<GamepadState, PadInternal>();

const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);

function readHardware(index: number | null): RawPad | null {
  if (index === null) return null;
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  const gp = navigator.getGamepads()[index];
  if (!gp || gp.connected === false) return null;
  return {
    connected: true,
    buttons: gp.buttons.map((b) => ({ pressed: b.pressed })),
    axes: [...gp.axes],
  };
}

/** Build the touch-driven synthetic pad from the current pointer state. */
// Standard mapping is 16 buttons — ALWAYS emit the full array so a released
// button reports `pressed:false` rather than dropping out. A shrinking array
// left the tracker's `for i < buttons.length` poll loop skipping now-absent
// indices, so their `held` bit stuck true and the button only ever fired
// `pressed` once (e.g. a touch pad could jump once and never again).
const STANDARD_BUTTONS = 16;

function synthFromTouch(st: PadInternal): RawPad {
  const buttons: { pressed: boolean }[] = [];
  for (let i = 0; i < STANDARD_BUTTONS; i++) buttons[i] = { pressed: false };
  for (const target of st.pointers.values()) {
    if (target.kind !== "button" || target.spec.button === undefined) continue;
    const idx = padButtonIndex(target.spec.button);
    if (idx !== undefined && idx < buttons.length) buttons[idx].pressed = true;
  }
  // Axes 0/1 = left stick, 2/3 = right stick (standard mapping).
  return { connected: true, buttons, axes: [st.stick.x, st.stick.y, st.rstick.x, st.rstick.y] };
}

// ---------- Coordinate mapping ----------
// The controls live in WINDOW space (full canvas in CSS px, origin top-left),
// NOT the logical/letterbox viewport — so a virtual pad sits in the physical
// screen corners, unaffected by a `resolution` letterbox or a `Camera` block.
// Both hit-testing and rendering use these same window coordinates.

let rectCache: DOMRect | null = null;

/** Window size in CSS px (the full canvas, ignoring any letterbox). */
function windowSize(): { w: number; h: number } {
  const canvas = App.canvas;
  const dpr = App.viewport.dpr;
  return { w: canvas.width / dpr, h: canvas.height / dpr };
}

/** Map a pointer's client coords to WINDOW CSS px (no letterbox offset/scale). */
function toWindow(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = App.canvas;
  const { w, h } = windowSize();
  rectCache ??= canvas.getBoundingClientRect();
  const rect = rectCache;
  return {
    x: rect.width > 0 ? ((clientX - rect.left) * w) / rect.width : 0,
    y: rect.height > 0 ? ((clientY - rect.top) * h) / rect.height : 0,
  };
}

function anchorCenter(anchor: Anchor): { x: number; y: number } {
  const { w, h } = windowSize();
  return {
    x: anchor.side === "left" ? anchor.x : w - anchor.x,
    y: h - anchor.y,
  };
}

// ---------- Haptics ----------

function fireHaptics(cfg: ResolvedConfig, spec: ButtonSpec, phase: "press" | "release"): void {
  const h = spec.haptics ?? cfg.haptics;
  if (!h) return;
  const hc: HapticsConfig = h === true ? {} : h;
  if (phase === "press" && hc.onPress === false) return;
  if (phase === "release" && !(hc.onRelease ?? false)) return;
  const value = hc.pattern ?? hc.ms ?? 12;
  try {
    (navigator as Navigator | undefined)?.vibrate?.(value);
  } catch {
    /* unsupported */
  }
}

// ---------- Touch capture ----------

function hitTest(st: PadInternal, x: number, y: number): TouchTarget | null {
  for (const spec of st.cfg.buttons) {
    if (spec.disabled?.()) continue; // grayed-out button ignores touches
    const c = anchorCenter(spec.anchor);
    if (Math.hypot(x - c.x, y - c.y) <= spec.r) return { kind: "button", spec };
  }
  // Generous grab: anywhere within ~1.6× the travel radius starts a stick.
  const sticks: [Which, StickSpec | undefined][] = [
    ["left", st.cfg.stick],
    ["right", st.cfg.rightStick],
  ];
  for (const [which, spec] of sticks) {
    if (!spec) continue;
    const c = anchorCenter(spec.anchor);
    if (Math.hypot(x - c.x, y - c.y) <= spec.radius * 1.6) return { kind: "stick", which };
  }
  return null;
}

function updateStick(st: PadInternal, which: Which, x: number, y: number): void {
  const s = which === "left" ? st.cfg.stick : st.cfg.rightStick;
  if (!s) return;
  const c = anchorCenter(s.anchor);
  const v = computeStick(x - c.x, y - c.y, s.radius, s.deadzone ?? 0);
  if (which === "left") st.stick = v;
  else st.rstick = v;
}

function attachListeners(st: PadInternal): void {
  if (st.listening) return;
  let canvas: HTMLCanvasElement;
  try {
    canvas = App.canvas;
  } catch {
    return; // no default app yet — retry on the next poll/draw
  }
  st.listening = true;
  // Stop the browser eating touches: `touch-action:none` kills scroll/zoom/
  // double-tap-zoom; disabling text selection + the iOS long-press callout stops
  // hold-to-select/magnifier from hijacking a finger that's holding the stick or
  // a button (which otherwise steals the pointer and leaves the stick stuck).
  canvas.style.touchAction = "none";
  canvas.style.userSelect = "none";
  canvas.style.setProperty("-webkit-user-select", "none");
  canvas.style.setProperty("-webkit-touch-callout", "none");

  // Touch/pen always actuate; a mouse only when the pad is actually on screen
  // (fade > 0), so a hidden autohidden pad never eats desktop clicks.
  const isActuator = (e: PointerEvent) =>
    e.pointerType === "touch" || e.pointerType === "pen" || st.fade > 0.1;

  canvas.addEventListener("pointerdown", (e) => {
    if (!isActuator(e)) return;
    const { x, y } = toWindow(e.clientX, e.clientY);
    const target = hitTest(st, x, y);
    if (!target) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    st.pointers.set(e.pointerId, target);
    st.lastSource = "touch";
    if (target.kind === "stick") updateStick(st, target.which, x, y);
    else {
      target.spec.onHold?.(true);
      fireHaptics(st.cfg, target.spec, "press");
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const target = st.pointers.get(e.pointerId);
    if (!target || target.kind !== "stick") return;
    const { x, y } = toWindow(e.clientX, e.clientY);
    updateStick(st, target.which, x, y);
  });

  const release = (e: PointerEvent) => {
    const target = st.pointers.get(e.pointerId);
    if (!target) return;
    st.pointers.delete(e.pointerId);
    if (target.kind === "stick") {
      // Another finger might still hold THIS stick — clear only when none do.
      const which = target.which;
      const held = [...st.pointers.values()].some((t) => t.kind === "stick" && t.which === which);
      if (!held) {
        if (which === "left") st.stick = { x: 0, y: 0 };
        else st.rstick = { x: 0, y: 0 };
      }
    } else {
      target.spec.onHold?.(false);
      target.spec.onTap?.();
      fireHaptics(st.cfg, target.spec, "release");
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // Safety net: if the OS steals the pointer for a system gesture (an iOS
  // long-press, say) without a pointerup/pointercancel, capture is lost — treat
  // that as a release so the stick/button can't get stuck at its last value.
  canvas.addEventListener("lostpointercapture", release);
  // The rect is cached for hot-path coordinate math; invalidate on layout change.
  const invalidate = () => {
    rectCache = null;
  };
  window.addEventListener("resize", invalidate);
  window.addEventListener("scroll", invalidate, true);
}

// ---------- Poll wiring ----------

function ensureWired(st: PadInternal): void {
  attachListeners(st);
  if (st.wired) return;
  try {
    Loop.onStepStart(() => st.tracker.poll());
    // Paint from onFrame, which fires AFTER the (letterbox-)clipped draw — so the
    // pad lands in the physical window corners, outside any camera/letterbox.
    Loop.onFrame(() => paint(st));
    st.wired = true;
  } catch {
    // No default app yet — retry on the next call.
  }
}

// ---------- Public API ----------

/** Build an on-screen gamepad. The returned value is a `GamepadState` — pass it
 *  to `Input.map` as `pad` and render it each frame with
 *  `OnscreenInput.drawControls`. Touch and a hardware pad share one code path,
 *  so `pressed`/`released` stay edge-correct whichever source acted.
 *
 *      const pad = OnscreenInput.gamepad({
 *        stick: { anchor: { side: "left", x: 90, y: 90 }, radius: 60 },
 *        buttons: [{ anchor: { side: "right", x: 70, y: 70 }, r: 34, button: "a", label: "A" }],
 *      });
 *      const input = Input.map({ jump: ["Space", "pad:a"] }, { pad });
 *      // draw(): OnscreenInput.drawControls(pad); */
export function gamepad(config: OnscreenGamepadConfig = {}): OnscreenPad {
  const cfg: ResolvedConfig = {
    mergeIndex: config.merge === false ? null : typeof config.merge === "number" ? config.merge : 0,
    autohide: config.autohide ?? true,
    fadeMs: config.autohideFadeMs ?? 200,
    opacity: config.opacity ?? 0.5,
    haptics: config.haptics ?? false,
    stick: config.stick,
    rightStick: config.rightStick,
    buttons: config.buttons ?? [],
  };

  const st: PadInternal = {
    cfg,
    tracker: undefined as unknown as GamepadState & { poll(): void },
    stick: { x: 0, y: 0 },
    rstick: { x: 0, y: 0 },
    pointers: new Map(),
    lastSource: "touch",
    coarse: typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : true,
    fade: 0,
    lastFrameTs: now(),
    wantPaint: false,
    wired: false,
    listening: false,
  };

  st.tracker = createGamepadTracker(() => {
    const touch = synthFromTouch(st);
    const hw = readHardware(cfg.mergeIndex);
    // Any real-pad activity flips the live source to hardware (drives autohide).
    if (hw && (hw.buttons.some((b) => b.pressed) || hw.axes.some((a) => Math.abs(a) > 0.2))) {
      st.lastSource = "hardware";
    }
    return fuseGamepad(touch, hw) as unknown as Gamepad;
  });

  registry.set(st.tracker, st);
  ensureWired(st);
  return st.tracker;
}

/** Render an on-screen gamepad — call once per frame in `draw`. The controls are
 *  painted in WINDOW space at end-of-frame, so they sit in the physical screen
 *  corners regardless of a `resolution` letterbox or a `Camera.render` block
 *  (calling it inside or outside a camera block makes no difference). Honors
 *  `opacity` and the autohide fade. */
export function drawControls(pad: OnscreenPad): void {
  const st = registry.get(pad);
  if (!st) return;
  ensureWired(st);
  st.wantPaint = true; // actual paint runs from the onFrame hook, post-clip
}

/** Whether the on-screen controls are currently faded in (touch is the live
 *  input on a coarse pointer). Use it to suppress desktop-only affordances while
 *  the virtual pad is up — e.g. disable mouse-aim so it doesn't fight the right
 *  stick. Reflects the autohide fade, so it eases in/out with the controls. */
export function visible(pad: OnscreenPad): boolean {
  const st = registry.get(pad);
  return !!st && st.fade > 0.05;
}

/** The real render, run from `onFrame` (after the clipped draw) in window space. */
function paint(st: PadInternal): void {
  if (!st.wantPaint) return;
  st.wantPaint = false;

  // Advance the autohide fade toward the target visibility.
  const t = now();
  const dt = Math.max(0, t - st.lastFrameTs);
  st.lastFrameTs = t;
  const visible = !st.cfg.autohide || (st.coarse && st.lastSource === "touch");
  const target = visible ? 1 : 0;
  const step = st.cfg.fadeMs > 0 ? dt / st.cfg.fadeMs : 1;
  st.fade += Math.sign(target - st.fade) * Math.min(Math.abs(target - st.fade), step);

  const alpha = st.cfg.opacity * st.fade;
  if (alpha <= 0.01) return;

  const ctx = Draw.ctx;
  const th = getTheme();
  const dpr = App.viewport.dpr;
  ctx.save();
  // Reset to WINDOW space: 1 unit = 1 CSS px, origin at the true window corner
  // (drop the letterbox scale/offset the base transform carries).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.font = `600 13px ${th.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2;

  // Sticks: base ring + knob offset by the live vector (left, then right).
  const drawStick = (spec: StickSpec | undefined, v: { x: number; y: number }) => {
    if (!spec) return;
    const c = anchorCenter(spec.anchor);
    const r = spec.radius;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = th.track;
    ctx.fill();
    ctx.strokeStyle = th.border;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x + v.x * r, c.y + v.y * r, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = v.x !== 0 || v.y !== 0 ? th.accent : th.accentSoft;
    ctx.fill();
  };
  drawStick(st.cfg.stick, st.stick);
  drawStick(st.cfg.rightStick, st.rstick);

  // Buttons: filled disc, brighter while a finger holds it, grayed when disabled.
  for (const spec of st.cfg.buttons) {
    const disabled = spec.disabled?.() ?? false;
    const c = anchorCenter(spec.anchor);
    const held =
      !disabled && [...st.pointers.values()].some((tt) => tt.kind === "button" && tt.spec === spec);
    ctx.save();
    if (disabled) ctx.globalAlpha *= 0.4;
    ctx.beginPath();
    ctx.arc(c.x, c.y, spec.r, 0, Math.PI * 2);
    ctx.fillStyle = held ? th.accent : th.bg;
    ctx.fill();
    ctx.strokeStyle = held ? th.accent : th.border;
    ctx.stroke();
    if (spec.label) {
      ctx.fillStyle = held ? th.bgActive : th.text;
      ctx.fillText(spec.label, c.x, c.y + 1);
    }
    ctx.restore();
  }

  ctx.restore();
}

/** Drop all cached listener/poll state — for tests. */
export function _resetOnscreen(): void {
  rectCache = null;
}
