import { setBegunCtx, uiCtx, withCtx } from "./context.js";
import { idScopes, requiredWidgetId } from "./identity.js";
import { hoverCursor, rawPointer, uiPointer } from "./input.js";
import { Stack, place } from "./stack.js";
import { centeredText, drawBox, roundRectPath, setTheme, theme, uiFont } from "./theme.js";
import { button, panel } from "./controls.js";
import { pointInRect } from "../collision.js";
import { Loop, Pointer, Stage } from "../engine/index.js";

// ---------- Drag state (shared: widgets set it, the frame loop cancels it) ----
export interface ActiveDrag {
  sourceId: string;
  payload: unknown;
  offsetX: number;
  offsetY: number;
}

export let activeDrag: ActiveDrag | null = null;

/** Set/clear the active drag from the dragdrop widgets (they can't reassign an
 *  imported binding). */
export function setActiveDrag(d: ActiveDrag | null): void {
  activeDrag = d;
}

/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  the overlay widgets (popover/modal), which can't reassign the imported flags. */
export function enterOverlay(): void {
  overlaySeen = true;
  focusTrapSeen = true;
  inOverlayPass = true;
}

// ---------- Shared input (overlay capture + hover cursor) ----------

// While an overlay (modal OR open popover) is up, widgets drawn outside its
// pass must go dead — otherwise a click "through" it still lands on them.
export let overlaySeen = false; // an overlay ran this frame

export let overlayActive = false; // an overlay ran last frame → block the background

export let inOverlayPass = false; // the rest of the frame belongs to the overlay

export interface TextEditor {
  id: string;
  input: HTMLInputElement;
  value: string;
  changed: boolean;
  submitted: boolean;
}

export let textEditor: TextEditor | null = null;

export let textInputSeen: string | null = null;

export interface SelectEditor {
  id: string;
  select: HTMLSelectElement;
  index: number;
  changed: boolean;
  open: boolean;
  justOpened: boolean;
}

export let selectEditor: SelectEditor | null = null;

export let selectSeen: string | null = null;

export interface SelectOverlayRequest<T = unknown> {
  ctx: CanvasRenderingContext2D;
  opts: SelectOptions<T> & { id: string };
  rect: { x: number; y: number; w: number; h: number };
}

export let selectOverlayRequest: SelectOverlayRequest | null = null;

export let selectCommit: { id: string; index: number } | null = null;

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

export let keyboardActivation: string | null = null;

export let keyboardCommand: { id: string; key: string } | null = null;

export let focusKeyboardWired = false;

export const focusCanvases = new WeakSet<HTMLCanvasElement>();

export function focusCandidates(): FocusEntry[] {
  const entries = focusOverlayActive
    ? focusRegistry.filter((entry) => entry.overlay)
    : focusRegistry;
  return entries
    .filter((entry) => !entry.disabled && entry.tabIndex >= 0)
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.tabIndex - b.entry.tabIndex || a.order - b.order)
    .map(({ entry }) => entry);
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

export function focusPrevious(): void {
  moveWidgetFocus(-1);
}

// ---------- Floating text ----------

/** Options for a floating text. */
export interface FloatOptions {
  /** Rise speed in px/s (negative = up). Default -50. */
  vy?: number;
  /** Lifetime in ms. Default 900. */
  life?: number;
  /** Fill color. Default "#fff". */
  color?: string;
  /** Font. Default "bold 14px monospace". */
  font?: string;
}

export interface FloatText {
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  remaining: number;
  color: string;
  font: string;
}

/** A pool of rising, fading texts. Pure — drive `advance(dt)` yourself (the
 *  `UI` facade wires it to the fixed step for you). */
export interface FloatManager {
  spawn(text: string, x: number, y: number, opts?: FloatOptions): void;
  /** Age every text by `dt` ms; expired ones are removed. */
  advance(dt: number): void;
  /** Draw all live texts, centered on their (drifting) position. */
  draw(ctx: CanvasRenderingContext2D): void;
  clear(): void;
  readonly size: number;
}

export function createFloats(): FloatManager {
  const texts: FloatText[] = [];
  return {
    spawn(text, x, y, opts = {}) {
      texts.push({
        text,
        x,
        y,
        vy: opts.vy ?? -50,
        life: opts.life ?? 900,
        remaining: opts.life ?? 900,
        color: opts.color ?? "#fff",
        font: opts.font ?? "bold 14px monospace",
      });
    },

    advance(dt) {
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.remaining -= dt;
        if (t.remaining <= 0) {
          texts.splice(i, 1);
          continue;
        }
        t.y += (t.vy * dt) / 1000;
      }
    },

    draw(ctx) {
      if (texts.length === 0) return;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of texts) {
        // Full strength, then fade out over the last half of the lifetime.
        ctx.globalAlpha = Math.min(1, (2 * t.remaining) / t.life);
        ctx.fillStyle = t.color;
        ctx.font = t.font;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    },

    clear() {
      texts.length = 0;
    },

    get size() {
      return texts.length;
    },
  };
}

// ---------- Text input ----------

export interface TextInputOptions {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  value: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  at?: Stack;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  type?: "text" | "password" | "email" | "number" | "search";
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
  ariaLabel?: string;
  /** Keyboard traversal order. Negative values exclude the field. */
  tabIndex?: number;
  /** Blur after Enter. Default true. */
  blurOnSubmit?: boolean;
}

export interface TextInputResult {
  value: string;
  changed: boolean;
  submitted: boolean;
  focused: boolean;
}

export function removeTextEditor(): void {
  textEditor?.input.remove();
  textEditor = null;
}

export function openTextEditor(opts: TextInputOptions & { id: string }): void {
  removeTextEditor();
  const input = document.createElement("input");
  input.type = opts.type ?? "text";
  input.value = opts.value;
  if (opts.maxLength !== undefined) input.maxLength = opts.maxLength;
  if (opts.inputMode) input.inputMode = opts.inputMode;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", opts.ariaLabel ?? opts.placeholder ?? opts.id);
  input.tabIndex = -1;
  input.dataset.minimotorUi = "true";
  Object.assign(input.style, {
    position: "fixed",
    left: "-1000px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  const editor: TextEditor = {
    id: opts.id,
    input,
    value: opts.value,
    changed: false,
    submitted: false,
  };
  input.addEventListener("input", () => {
    editor.value = input.value;
    editor.changed = true;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      editor.submitted = true;
      if (opts.blurOnSubmit ?? true) input.blur();
    } else if (event.key === "Escape") {
      input.blur();
    }
  });
  document.body.appendChild(input);
  textEditor = editor;
  input.focus({ preventScroll: true });
  // Selection APIs throw for some valid input types (notably number/email).
  try {
    input.setSelectionRange?.(input.value.length, input.value.length);
  } catch {
    // Native control still works; it simply chooses its own caret position.
  }
}

/** Canvas-rendered single-line input backed by a hidden native `<input>` for
 * keyboard, clipboard, IME and mobile-keyboard behavior. Returns controlled
 * value plus one-frame `changed`/`submitted` flags. */
export function textInput(opts: TextInputOptions): TextInputResult;
export function textInput(ctx: CanvasRenderingContext2D, opts: TextInputOptions): TextInputResult;
export function textInput(
  a: CanvasRenderingContext2D | TextInputOptions,
  b?: TextInputOptions,
): TextInputResult {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  const id = requiredWidgetId(opts.id, "textInput");
  const resolvedOpts = { ...opts, id };
  textInputSeen = id;
  const rect = place(opts, opts.w ?? 180, opts.h ?? 32);
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    native: true,
    focus: () => {
      if (textEditor?.id === id) textEditor.input.focus({ preventScroll: true });
      else openTextEditor(resolvedOpts);
    },
    blur: () => {
      if (textEditor?.id === id) textEditor.input.blur();
    },
  });
  const p = uiPointer();
  const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
  if (hovered) hoverCursor(true);
  if (hovered && p.released) {
    focusFromPointer(ctx, id);
    if (textEditor?.id === id) textEditor.input.focus({ preventScroll: true });
    else openTextEditor(resolvedOpts);
  } else if (p.released && textEditor?.id === id && !hovered) textEditor.input.blur();

  const active = textEditor?.id === id ? textEditor : null;
  if (active) {
    active.input.disabled = opts.disabled ?? false;
    if (opts.maxLength !== undefined) active.input.maxLength = opts.maxLength;
    if (document.activeElement !== active.input && opts.value !== active.value) {
      active.value = opts.value;
      active.input.value = opts.value;
    }
  }
  const value = active?.value ?? opts.value;
  const focused = !!active && document.activeElement === active.input;
  const shown = value
    ? opts.type === "password"
      ? "•".repeat(value.length)
      : value
    : focused
      ? ""
      : (opts.placeholder ?? "");

  ctx.save();
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: opts.disabled ? theme.bgActive : theme.bg,
    stroke: focused ? theme.accent : hovered ? theme.accentSoft : theme.border,
  });
  ctx.beginPath();
  ctx.rect(rect.x + 7, rect.y + 2, Math.max(0, rect.w - 14), Math.max(0, rect.h - 4));
  ctx.clip();
  ctx.font = uiFont();
  ctx.fillStyle = value ? theme.text : theme.textDim;
  ctx.textAlign = "left";
  centeredText(ctx, shown, rect.x + 9, rect.y + rect.h / 2, rect.w - 18);
  if (focused && Math.floor(performance.now() / 500) % 2 === 0) {
    const caretX = Math.min(rect.x + rect.w - 9, rect.x + 9 + ctx.measureText(shown).width + 1);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(caretX, rect.y + 7, 1, Math.max(4, rect.h - 14));
  }
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);

  const changed = active?.changed ?? false;
  const submitted = active?.submitted ?? false;
  if (active) {
    active.changed = false;
    active.submitted = false;
  }
  return { value, changed, submitted, focused };
}

// ---------- Select dropdown ----------

export interface SelectOption<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface SelectOptions<T> {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  value: T;
  options: readonly SelectOption<T>[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  at?: Stack;
  disabled?: boolean;
  placeholder?: string;
  maxVisible?: number;
  ariaLabel?: string;
  /** Keyboard traversal order. Negative values exclude the select. */
  tabIndex?: number;
}

export interface SelectResult<T> {
  value: T;
  changed: boolean;
  open: boolean;
}

export function removeSelectEditor(): void {
  selectEditor?.select.remove();
  selectEditor = null;
}

export function openSelectEditor<T>(
  opts: SelectOptions<T> & { id: string },
  index: number,
  menuOpen = true,
): void {
  removeSelectEditor();
  const select = document.createElement("select");
  select.setAttribute("aria-label", opts.ariaLabel ?? opts.id);
  select.tabIndex = -1;
  select.dataset.minimotorUi = "true";
  Object.assign(select.style, {
    position: "fixed",
    left: "-1000px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  for (let i = 0; i < opts.options.length; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = opts.options[i].label;
    option.disabled = opts.options[i].disabled ?? false;
    select.appendChild(option);
  }
  select.value = index >= 0 ? String(index) : "";
  const editor: SelectEditor = {
    id: opts.id,
    select,
    index,
    changed: false,
    open: menuOpen,
    justOpened: menuOpen,
  };
  select.addEventListener("change", () => {
    editor.index = Number(select.value);
    editor.changed = true;
  });
  select.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      editor.open = !editor.open;
      editor.justOpened = editor.open;
    } else if (event.key === "Escape") {
      editor.open = false;
      select.blur();
    }
  });
  document.body.appendChild(select);
  selectEditor = editor;
  select.focus({ preventScroll: true });
}

/** Themed dropdown backed by a hidden native `<select>`. Clicking opens a
 * canvas option list; focused native arrow-key navigation updates the same
 * controlled value. */
export function select<T>(opts: SelectOptions<T>): SelectResult<T>;
export function select<T>(ctx: CanvasRenderingContext2D, opts: SelectOptions<T>): SelectResult<T>;
export function select<T>(
  a: CanvasRenderingContext2D | SelectOptions<T>,
  b?: SelectOptions<T>,
): SelectResult<T> {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  const id = requiredWidgetId(opts.id, "select");
  const resolvedOpts = { ...opts, id };
  selectSeen = id;
  const rect = place(opts, opts.w ?? 180, opts.h ?? 32);
  const currentIndex = opts.options.findIndex((option) => Object.is(option.value, opts.value));
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    native: true,
    focus: () => {
      if (selectEditor?.id === id) selectEditor.select.focus({ preventScroll: true });
      else openSelectEditor(resolvedOpts, currentIndex, false);
    },
    blur: () => {
      if (selectEditor?.id === id) {
        selectEditor.open = false;
        selectEditor.select.blur();
      }
    },
  });
  const p = selectEditor?.id === id ? rawPointer() : uiPointer();
  const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
  if (hovered) hoverCursor(true);

  if (hovered && p.released && !opts.disabled) {
    focusFromPointer(ctx, id);
    if (selectEditor?.id === id) {
      selectEditor.open = !selectEditor.open;
      selectEditor.justOpened = selectEditor.open;
      selectEditor.select.focus({ preventScroll: true });
    } else openSelectEditor(resolvedOpts, currentIndex);
  }
  let editor = selectEditor?.id === id ? selectEditor : null;
  const committed = selectCommit?.id === id ? selectCommit.index : -1;
  if (committed >= 0) selectCommit = null;
  let value =
    committed >= 0
      ? (opts.options[committed]?.value ?? opts.value)
      : editor && editor.index >= 0
        ? (opts.options[editor.index]?.value ?? opts.value)
        : opts.value;
  let changed = committed >= 0 || (editor?.changed ?? false);
  const selected = opts.options.find((option) => Object.is(option.value, value));

  ctx.save();
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: opts.disabled ? theme.bgActive : theme.bg,
    stroke: editor ? theme.accent : hovered ? theme.accentSoft : theme.border,
  });
  ctx.font = uiFont();
  ctx.fillStyle = selected ? theme.text : theme.textDim;
  ctx.textAlign = "left";
  centeredText(
    ctx,
    selected?.label ?? opts.placeholder ?? "Select…",
    rect.x + 10,
    rect.y + rect.h / 2,
    rect.w - 36,
  );
  ctx.fillStyle = theme.textDim;
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.w - 20, rect.y + rect.h / 2 - 3);
  ctx.lineTo(rect.x + rect.w - 10, rect.y + rect.h / 2 - 3);
  ctx.lineTo(rect.x + rect.w - 15, rect.y + rect.h / 2 + 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);

  if (editor?.open) {
    markFocusableOverlay(id);
    // Defer the menu until frame-end so siblings drawn later in the callback
    // layout cannot paint over it. Input is still captured immediately.
    overlaySeen = true;
    inOverlayPass = true;
    selectOverlayRequest = { ctx, opts: resolvedOpts, rect } as SelectOverlayRequest;
    editor.changed = false;
  }
  return { value, changed, open: !!editor?.open };
}

export function drawSelectOverlay(): void {
  const request = selectOverlayRequest;
  selectOverlayRequest = null;
  if (!request || !selectEditor?.open || selectEditor.id !== request.opts.id) return;
  const { ctx, opts, rect } = request;
  const editor = selectEditor;
  const p = rawPointer();
  const value = editor.index >= 0 ? opts.options[editor.index]?.value : opts.value;
  const visible = Math.max(1, Math.min(opts.options.length, opts.maxVisible ?? 8));
  const itemH = 30;
  const menuH = visible * itemH + 4;
  const vp = Stage.viewport;
  const menuY = rect.y + rect.h + menuH <= vp.h - 4 ? rect.y + rect.h + 2 : rect.y - menuH - 2;
  const menu = { x: rect.x, y: menuY, w: rect.w, h: menuH };

  ctx.save();
  ctx.fillStyle = theme.bgActive;
  ctx.fillRect(menu.x, menu.y, menu.w, menu.h);
  ctx.restore();
  panel(ctx, { ...menu, bg: theme.bgActive });
  const start = Math.max(
    0,
    Math.min(opts.options.length - visible, editor.index - Math.floor(visible / 2)),
  );
  for (let i = start; i < Math.min(opts.options.length, start + visible); i++) {
    const option = opts.options[i];
    if (
      button(ctx, {
        x: menu.x + 2,
        y: menu.y + 2 + (i - start) * itemH,
        w: menu.w - 4,
        h: itemH,
        label: option.label,
        disabled: option.disabled,
        variant: Object.is(option.value, value) ? "primary" : "ghost",
      })
    ) {
      editor.index = i;
      editor.select.value = String(i);
      editor.index = i;
      editor.select.value = String(i);
      editor.open = false;
      selectCommit = { id: opts.id, index: i }; // observed by select() next draw
      return;
    }
  }
  if (
    !editor.justOpened &&
    p.released &&
    !pointInRect(p.x, p.y, rect) &&
    !pointInRect(p.x, p.y, menu)
  ) {
    removeSelectEditor();
    return;
  }
  editor.justOpened = false;
}

// ---------- Tooltip ----------

export let tipRequest: string | null = null; // asked for this frame

export let tipShown: { text: string; since: number } | null = null; // hover-stable

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms. */
export function tooltip(msg: string): void {
  ensureWired();
  tipRequest = msg;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloats`, after any modal) so it sits on top. */
export function drawTips(maybeCtx?: CanvasRenderingContext2D): void {
  const ctx = maybeCtx ?? uiCtx();
  if (!tipShown || performance.now() - tipShown.since < 350) return;
  const msg = tipShown.text;
  const vp = Stage.viewport;
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  const w = ctx.measureText(msg).width + 16;
  const h = 24;
  let x = Pointer.x + 14;
  let y = Pointer.y + 20;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = Pointer.y - 8 - h;
  drawBox(ctx, x, y, w, h, {
    fill: theme.panelBg,
    stroke: theme.border,
    border: 1,
    radius: Math.min(theme.radius, 6),
  });
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, msg, x + 8, y + h / 2);
  ctx.restore();
}

// ---------- Default facade (aged by the default Loop's fixed step) ----------

export let floats = createFloats();

export let spinAngle = 0;

export let wired = false;

export function ensureWired(): void {
  if (!focusKeyboardWired && typeof window !== "undefined") {
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
  if (wired) return;
  // Registering the loop hooks needs the default game; without one
  // (headless/tests) the calls throw — stay unwired and retry next call.
  try {
    Loop.onStep(() => {
      floats.advance(Loop.step);
      spinAngle += 0.12; // ~7 rad/s at 60 steps
    });
    // Frame-end housekeeping for the immediate-mode state machines.
    Loop.onFrame(() => {
      // Deferred overlays render above every ordinary widget in the user's
      // draw callback (and still see frame-scoped pointer release edges).
      drawSelectOverlay();
      setBegunCtx(null); // re-begin() each frame when overriding the ctx
      // Complete this frame's keyboard registry after every widget (including
      // deferred overlays) has had a chance to register.
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
      // Overlay capture: what was drawn this frame gates input next frame.
      overlayActive = overlaySeen;
      overlaySeen = false;
      focusTrapSeen = false;
      inOverlayPass = false;
      // Tooltip hover-stability: same text keeps its timer; a change restarts.
      if (tipRequest) {
        if (tipShown?.text !== tipRequest) {
          tipShown = { text: tipRequest, since: performance.now() };
        }
      } else {
        tipShown = null;
      }
      tipRequest = null;
      // Native editing bridges only live while their immediate-mode widget is
      // still submitted every frame.
      if (textEditor && textInputSeen !== textEditor.id) removeTextEditor();
      if (selectEditor && selectSeen !== selectEditor.id) removeSelectEditor();
      textInputSeen = null;
      selectSeen = null;
      // A release not consumed by any drop target cancels the drag.
      try {
        if (activeDrag && Pointer.frameReleased) activeDrag = null;
      } catch {
        activeDrag = null;
      }
    });
    wired = true;
  } catch {
    // no default game yet
  }
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloats`. */
export function float(str: string, x: number, y: number, opts?: FloatOptions): void {
  ensureWired();
  floats.spawn(str, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloats(ctx?: CanvasRenderingContext2D): void {
  floats.draw(ctx ?? uiCtx());
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloats(): void {
  floats.clear();
}

/** Reset floats, theme and Loop wiring — for tests. */
export function _reset(): void {
  floats = createFloats();
  setTheme({});
  tipRequest = null;
  tipShown = null;
  overlaySeen = false;
  overlayActive = false;
  inOverlayPass = false;
  activeDrag = null;
  removeTextEditor();
  removeSelectEditor();
  textInputSeen = null;
  selectSeen = null;
  selectOverlayRequest = null;
  selectCommit = null;
  focusFrame = [];
  focusRegistry = [];
  focusedWidget = null;
  focusVisible = false;
  focusTrapSeen = false;
  focusOverlayActive = false;
  focusBeforeOverlay = null;
  keyboardActivation = null;
  keyboardCommand = null;
  idScopes.length = 0;
  setBegunCtx(null);
  wired = false;
}
