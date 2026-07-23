import {
  drawFocusRing,
  focusEndFrame,
  focusFromPointer,
  markFocusTrap,
  markFocusableOverlay,
  padNav,
  registerFocusable,
  resetFocus,
  wireFocusKeyboard,
} from "./focus.js";
import { setBegunCtx, uiCtx, withCtx } from "./context.js";
import { idScopes, requiredWidgetId } from "./identity.js";
import { hoverCursor, rawPointer, setCursor, uiPointer } from "./input.js";
import { Stack, place } from "./stack.js";
import { centeredText, drawBox, setTheme, theme, uiFont } from "./theme.js";
import { wrapLines } from "./text.js";
import { button, panel } from "../controls.js";
import { pointInRect } from "../../collision.js";
import { clamp } from "../../mathf.js";
import { Loop, Pointer, Stage } from "../../engine/index.js";

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
  markFocusTrap();
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
  /** A `<textarea>` when the field is multiline, else an `<input>`. Both expose
   *  the same value/selection API the canvas mirrors. */
  input: HTMLInputElement | HTMLTextAreaElement;
  value: string;
  changed: boolean;
  submitted: boolean;
  /** `true` when backed by a `<textarea>` (Enter inserts a newline). */
  multiline: boolean;
  /** Horizontal scroll offset (single-line only), so the caret stays inside the
   *  clip rect when the text is wider than the box. Recomputed each frame from
   *  the caret x and persisted so a resting caret doesn't snap the view about. */
  scrollX: number;
  /** Char index where a pointer drag-selection started, or `null` when not
   *  dragging. While set, pointer moves extend the native selection so the
   *  canvas text is mouse-selectable (and Cmd/Ctrl+C copies it). */
  dragAnchor: number | null;
  /** The value returned to the caller last frame. Lets a controlled value the
   *  app sets EXTERNALLY (one that isn't just echoing our last output — e.g.
   *  clearing a chat box after send) apply even while focused, without a
   *  keystroke-lagged echo clobbering what the user is typing. */
  lastReturned: string;
}

export let textEditor: TextEditor | null = null;

// Ids of every text input drawn THIS frame. A Set, not a single id: with more
// than one field on screen, a single "last seen" id let a later-drawn field's
// id evict an earlier focused field's editor at frame-end (you couldn't focus
// any field but the last one). Same shape as `selectSeen`. Cleared each frame.
export const textInputSeen = new Set<string>();

export interface SelectEditor {
  id: string;
  select: HTMLSelectElement;
  index: number;
  changed: boolean;
  open: boolean;
  justOpened: boolean;
}

export let selectEditor: SelectEditor | null = null;

// Ids of every select drawn THIS frame. A Set, not a single id: with more than
// one select on screen, a single "last seen" id let a later-drawn select's id
// evict an earlier open select at frame-end (its menu vanished on the click
// that opened it). Cleared each frame.
export const selectSeen = new Set<string>();

export interface SelectOverlayRequest<T = unknown> {
  ctx: CanvasRenderingContext2D;
  opts: SelectOptions<T> & { id: string };
  rect: { x: number; y: number; w: number; h: number };
}

export let selectOverlayRequest: SelectOverlayRequest | null = null;

export let selectCommit: { id: string; index: number } | null = null;

// ---------- Floating text ----------

/** Options for a floating text. */
export interface FloatTextOptions {
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
export interface FloatTextManager {
  /** Spawn a rising text at `(x, y)`; `opts` tunes drift/lifetime/color/font. */
  spawn(text: string, x: number, y: number, opts?: FloatTextOptions): void;
  /** Age every text by `dt` ms; expired ones are removed. */
  advance(dt: number): void;
  /** Draw all live texts, centered on their (drifting) position. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Remove every text at once. */
  clear(): void;
  /** Number of live texts currently in the pool. */
  readonly size: number;
}

/** Create a fresh, empty `FloatTextManager` pool. The `UI` facade keeps a
 *  shared one (`UI.floatText`); make your own for an isolated set of texts. */
export function createFloatText(): FloatTextManager {
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

/** Inputs to `textInput`: the controlled `value`, geometry, and native
 *  `<input>` hints. */
export interface TextInputOptions {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  /** Current text — controlled; pass your state in, assign the result's
   *  `value` back. */
  value: string;
  /** Top-left x in logical px. */
  x?: number;
  /** Top-left y in logical px. */
  y?: number;
  /** Field width in px. Default `180`. */
  w?: number;
  /** Field height in px. Default `32`. */
  h?: number;
  /** Place in this layout stack — supplies x/y (and h). */
  at?: Stack;
  /** Muted text shown while empty and unfocused. */
  placeholder?: string;
  /** Grayed out; ignores input. */
  disabled?: boolean;
  /** Max character count (native `maxLength`). */
  maxLength?: number;
  /** Native input `type` — `"password"` masks with bullets; the rest steer
   *  mobile keyboards/validation. Default `"text"`. */
  type?: "text" | "password" | "email" | "number" | "search";
  /** Native `inputmode` hint for the on-screen keyboard (e.g. `"numeric"`,
   *  `"decimal"`). */
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
  /** Accessible name for the hidden `<input>`. Falls back to `placeholder`,
   *  then `id`. */
  ariaLabel?: string;
  /** Keyboard traversal order. Negative values exclude the field. */
  tabIndex?: number;
  /** Blur after Enter. Default true. */
  blurOnSubmit?: boolean;
  /** Multi-line field: backs the control with a `<textarea>` and wraps the text
   *  top-aligned inside the box. Enter inserts a newline (only Cmd/Ctrl+Enter
   *  submits); `maxLength` still applies. Implied when `rows > 1`. */
  multiline?: boolean;
  /** Visible line count. `1` (default) is a single-line input; anything larger
   *  makes it multi-line (implies `multiline`) and sizes the box to that many
   *  rows unless an explicit `h` overrides. Pair this with — or instead of —
   *  `multiline`; `rows: 4` and `multiline: true` are equivalent. */
  rows?: number;
}

/** What `textInput` returns this frame: current `value` plus changed/submitted/
 *  focused flags. */
export interface TextInputResult {
  /** The field's current text — assign it back to your state. */
  value: string;
  /** `true` for the one frame the text changed. */
  changed: boolean;
  /** `true` for the one frame Enter was pressed. */
  submitted: boolean;
  /** `true` while the field holds keyboard focus. */
  focused: boolean;
}

export function removeTextEditor(): void {
  textEditor?.input.remove();
  textEditor = null;
}

/** Read the live caret/selection from the native element. The selection APIs
 *  throw for some input types (notably number/email) — fall back to a collapsed
 *  caret at the end so those still render sanely. */
function readSelection(el: HTMLInputElement | HTMLTextAreaElement): {
  start: number;
  end: number;
  dir: "forward" | "backward" | "none";
} {
  const len = el.value.length;
  try {
    return {
      start: el.selectionStart ?? len,
      end: el.selectionEnd ?? len,
      dir: el.selectionDirection ?? "none",
    };
  } catch {
    return { start: len, end: len, dir: "none" };
  }
}

/** Wrap `str` into visual lines top-to-bottom, honoring hard newlines and
 *  recording where each line starts in `str` (so the caret/selection can be
 *  placed in 2D). Hard lines are split on `"\n"`, then greedy-wrapped with the
 *  shared `wrapLines` helper; the char offsets are recovered by walking the
 *  original text (which `wrapLines` trims and collapses). */
function layoutLines(
  ctx: CanvasRenderingContext2D,
  str: string,
  maxW: number,
): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let base = 0; // offset of the current hard line in `str`
  for (const para of str.split("\n")) {
    let pos = 0; // scan cursor within `para`
    for (const sub of wrapLines(ctx, para, maxW)) {
      while (pos < para.length && /\s/.test(para[pos])) pos++;
      out.push({ text: sub, start: base + pos });
      // Consume this line's glyphs, absorbing collapsed whitespace runs so the
      // next line's start lands on its first real character.
      for (let si = 0; si < sub.length && pos < para.length;) {
        if (sub[si] === " ") {
          while (pos < para.length && /\s/.test(para[pos])) pos++;
          si++;
        } else {
          pos++;
          si++;
        }
      }
    }
    base += para.length + 1; // + the "\n"
  }
  return out;
}

/** Char index in `str` whose boundary is nearest local x `xLocal` (measured
 *  from the text's left edge). Picks by glyph midpoint so a click lands on the
 *  closer side of a character. `ctx.font` must already be set. */
function indexAtLocalX(ctx: CanvasRenderingContext2D, str: string, xLocal: number): number {
  if (xLocal <= 0) return 0;
  let prev = 0;
  for (let i = 1; i <= str.length; i++) {
    const w = ctx.measureText(str.slice(0, i)).width;
    if (xLocal < (prev + w) / 2) return i - 1;
    prev = w;
  }
  return str.length;
}

/** Map a pointer position to a caret index in `shown`, honoring the field's
 *  horizontal scroll (single-line) or wrapped lines (multiline). */
function caretIndexAt(
  ctx: CanvasRenderingContext2D,
  shown: string,
  scrollX: number,
  multiline: boolean,
  rect: { x: number; y: number },
  innerX: number,
  innerW: number,
  lineH: number,
  px: number,
  py: number,
): number {
  ctx.save();
  ctx.font = uiFont();
  ctx.textAlign = "left";
  let idx: number;
  if (multiline) {
    const lines = layoutLines(ctx, shown, innerW);
    if (lines.length === 0) {
      ctx.restore();
      return 0;
    }
    const top = rect.y + 4;
    const li = Math.max(0, Math.min(lines.length - 1, Math.floor((py - top) / lineH)));
    idx = lines[li].start + indexAtLocalX(ctx, lines[li].text, px - innerX);
  } else {
    idx = indexAtLocalX(ctx, shown, px - (innerX - scrollX));
  }
  ctx.restore();
  return idx;
}

/** The word spanning `idx` (`[start, end]`), for double-click select. Collapses
 *  to `[idx, idx]` when the click isn't on/next to a word character. */
function wordRangeAt(str: string, idx: number): [number, number] {
  const word = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let anchor = idx;
  if (word(str[idx])) anchor = idx;
  else if (word(str[idx - 1])) anchor = idx - 1;
  else return [idx, idx];
  let s = anchor;
  let e = anchor + 1;
  while (s > 0 && word(str[s - 1])) s--;
  while (e < str.length && word(str[e])) e++;
  return [s, e];
}

/** Set the native element's selection so the canvas mirror updates and Cmd/Ctrl+C
 *  copies it. The selection API throws for some input types (number/email) — a
 *  failed set just leaves the control's own caret. */
function setNativeSelection(
  el: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  dir: "forward" | "backward" | "none",
): void {
  try {
    el.setSelectionRange(start, end, dir);
  } catch {
    // Native control still works; it keeps its own caret.
  }
}

export function openTextEditor(opts: TextInputOptions & { id: string }): void {
  removeTextEditor();
  const multiline = opts.multiline ?? false;
  // A <textarea> owns real newline/wrap behavior for multiline; a plain <input>
  // otherwise. Both share the value/selection API the canvas mirrors.
  const input: HTMLInputElement | HTMLTextAreaElement = document.createElement(
    multiline ? "textarea" : "input",
  );
  if (!multiline) (input as HTMLInputElement).type = opts.type ?? "text";
  else (input as HTMLTextAreaElement).rows = opts.rows ?? 4;
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
    multiline,
    scrollX: 0,
    dragAnchor: null,
    lastReturned: opts.value,
  };
  input.addEventListener("input", () => {
    editor.value = input.value;
    editor.changed = true;
  });
  input.addEventListener("keydown", (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if (event.key === "Enter") {
      // Single-line: Enter submits. Multiline: Enter inserts a newline (the
      // native textarea default — don't preventDefault), and only Cmd/Ctrl+Enter
      // submits.
      if (!multiline || event.metaKey || event.ctrlKey) {
        editor.submitted = true;
        if (opts.blurOnSubmit ?? true) input.blur();
      }
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

/** Canvas-rendered text input backed by a hidden native `<input>` (or a
 * `<textarea>` when `multiline`) for keyboard, clipboard, IME and mobile-keyboard
 * behavior. The canvas mirrors the element's live caret and selection. Returns
 * the controlled value plus one-frame `changed`/`submitted` flags. */
export function textInput(opts: TextInputOptions): TextInputResult;
export function textInput(ctx: CanvasRenderingContext2D, opts: TextInputOptions): TextInputResult;
export function textInput(
  a: CanvasRenderingContext2D | TextInputOptions,
  b?: TextInputOptions,
): TextInputResult {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  const id = requiredWidgetId(opts.id, "textInput");
  textInputSeen.add(id);
  // `rows` sets the visible line count. rows > 1 (or an explicit `multiline`)
  // backs the field with a <textarea>; a single row stays a one-line <input>.
  // The box height derives from the row count unless `h` is given.
  const rows = Math.max(1, Math.round(opts.rows ?? (opts.multiline ? 4 : 1)));
  const multiline = rows > 1 || (opts.multiline ?? false);
  const resolvedOpts = { ...opts, id, multiline, rows };
  // Fold the row-derived height into `opts.h` before laying out: a column slot
  // takes its size from `h`, not the widget's default arg, so without this a
  // multiline field would collapse to the column's default row height and never
  // show its rows.
  const boxH = opts.h ?? (multiline ? rows * (theme.fontSize + 6) + 12 : 32);
  const rect = place({ ...opts, h: boxH }, opts.w ?? 180, boxH);
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
  // An I-beam over a text field reads "you can select here" (vs the hand a
  // button asks for). The engine resets it every frame.
  if (hovered) setCursor("text");
  // Focus + begin selecting on PRESS (native mousedown behavior — a press-then-
  // drag selects). A press outside a focused field commits + blurs it.
  if (hovered && p.pressed && !opts.disabled) {
    focusFromPointer(ctx, id);
    if (textEditor?.id === id) textEditor.input.focus({ preventScroll: true });
    else openTextEditor(resolvedOpts);
  } else if (p.pressed && !hovered && textEditor?.id === id) textEditor.input.blur();

  const active = textEditor?.id === id ? textEditor : null;
  if (active) {
    active.input.disabled = opts.disabled ?? false;
    if (opts.maxLength !== undefined) active.input.maxLength = opts.maxLength;
    // Honor a controlled value the app set EXTERNALLY — one that differs from
    // what we handed back last frame — even while focused, so a chat box can
    // clear itself after send. Skip it on a frame the user just typed, so their
    // (not-yet-echoed) keystroke isn't clobbered.
    if (opts.value !== active.lastReturned && !active.changed) {
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
  const innerX = rect.x + 9; // left text edge (matches the 9px inset used below)
  const innerW = Math.max(0, rect.w - 18);
  const lineH = theme.fontSize + 6;

  // Mouse selection: place the caret on press, extend it on drag, select a word
  // on double-press. Writing the native selection keeps the canvas mirror and
  // the clipboard (Cmd/Ctrl+C) in sync. Keyboard selection (Shift+arrows, Cmd+A)
  // already works — those keys pass straight through to the focused element.
  if (active && focused) {
    if (p.doublePressed && hovered) {
      // Native double-click → select the word under the pointer. Handled apart
      // from the press edge: `dblclick` fires on the second release, not down.
      const idx = caretIndexAt(
        ctx,
        shown,
        active.scrollX,
        active.multiline,
        rect,
        innerX,
        innerW,
        lineH,
        p.x,
        p.y,
      );
      const [ws, we] = wordRangeAt(shown, idx);
      setNativeSelection(active.input, ws, we, "forward");
      active.dragAnchor = null; // a word select isn't a drag
    } else if (hovered && p.pressed) {
      const idx = caretIndexAt(
        ctx,
        shown,
        active.scrollX,
        active.multiline,
        rect,
        innerX,
        innerW,
        lineH,
        p.x,
        p.y,
      );
      setNativeSelection(active.input, idx, idx, "none");
      active.dragAnchor = idx;
    } else if (active.dragAnchor !== null && p.down) {
      const idx = caretIndexAt(
        ctx,
        shown,
        active.scrollX,
        active.multiline,
        rect,
        innerX,
        innerW,
        lineH,
        p.x,
        p.y,
      );
      const a = Math.min(active.dragAnchor, idx);
      const b = Math.max(active.dragAnchor, idx);
      setNativeSelection(active.input, a, b, idx < active.dragAnchor ? "backward" : "forward");
    }
    if (p.released) active.dragAnchor = null;
  }

  ctx.save();
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: opts.disabled ? theme.bgActive : theme.bg,
    stroke: focused ? theme.accent : hovered ? theme.accentSoft : theme.border,
  });
  ctx.beginPath();
  ctx.rect(rect.x + 7, rect.y + 2, Math.max(0, rect.w - 14), Math.max(0, rect.h - 4));
  ctx.clip();
  ctx.font = uiFont();
  ctx.textAlign = "left";
  const textColor = value ? theme.text : theme.textDim;
  const blink = Math.floor(performance.now() / 500) % 2 === 0;

  if (focused && active) {
    // Mirror the native element's live caret/selection. Indices are into
    // `shown`, whose length matches the value (the password mask is 1:1).
    const sel = readSelection(active.input);
    const caretIdx = sel.dir === "backward" ? sel.start : sel.end;

    if (multiline) {
      // Wrap top-aligned, then locate the caret's line + x within it.
      const lines = layoutLines(ctx, shown, innerW);
      const top = rect.y + 4;
      // The caret's line: the last line whose start is at or before it (a caret
      // at the very end sits on the final line).
      let caretLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].start <= caretIdx) caretLine = i;
      }
      // Selection highlight, clipped to each line's span.
      if (sel.start !== sel.end) {
        ctx.fillStyle = theme.accentSoft;
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < lines.length; i++) {
          const ls = lines[i].start;
          const le = ls + lines[i].text.length;
          const a = Math.max(sel.start, ls);
          const b = Math.min(sel.end, le);
          if (b <= a) continue;
          const ax = innerX + ctx.measureText(shown.slice(ls, a)).width;
          const bx = innerX + ctx.measureText(shown.slice(ls, b)).width;
          ctx.fillRect(ax, top + i * lineH + 2, bx - ax, lineH - 4);
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = textColor;
      lines.forEach((line, i) => centeredText(ctx, line.text, innerX, top + i * lineH + lineH / 2));
      if (blink && lines.length > 0) {
        const line = lines[caretLine];
        const caretX = innerX + ctx.measureText(shown.slice(line.start, caretIdx)).width;
        ctx.fillStyle = theme.accent;
        ctx.fillRect(caretX, top + caretLine * lineH + 3, 1, lineH - 6);
      }
    } else {
      // Single line: scroll horizontally so the caret stays inside the clip.
      const caretLocalX = ctx.measureText(shown.slice(0, caretIdx)).width;
      let scroll = active.scrollX;
      if (caretLocalX - scroll > innerW) scroll = caretLocalX - innerW;
      if (caretLocalX - scroll < 0) scroll = caretLocalX;
      const maxScroll = Math.max(0, ctx.measureText(shown).width - innerW);
      scroll = Math.max(0, Math.min(scroll, maxScroll));
      active.scrollX = scroll;
      const baseX = innerX - scroll;

      if (sel.start !== sel.end) {
        const a = baseX + ctx.measureText(shown.slice(0, sel.start)).width;
        const b = baseX + ctx.measureText(shown.slice(0, sel.end)).width;
        ctx.fillStyle = theme.accentSoft;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(a, rect.y + 6, b - a, Math.max(4, rect.h - 12));
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = textColor;
      centeredText(ctx, shown, baseX, rect.y + rect.h / 2);
      if (blink) {
        const caretX = baseX + caretLocalX;
        ctx.fillStyle = theme.accent;
        ctx.fillRect(caretX, rect.y + 7, 1, Math.max(4, rect.h - 14));
      }
    }
  } else {
    // Resting (unfocused): no caret/selection. Single line ellipsizes; multiline
    // wraps top-aligned. Both are clipped to the box.
    ctx.fillStyle = textColor;
    if (multiline) {
      const top = rect.y + 4;
      shown
        .split("\n")
        .flatMap((para) => wrapLines(ctx, para, innerW))
        .forEach((line, i) => centeredText(ctx, line, innerX, top + i * lineH + lineH / 2));
    } else {
      centeredText(ctx, shown, innerX, rect.y + rect.h / 2, innerW);
    }
  }
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);

  const changed = active?.changed ?? false;
  const submitted = active?.submitted ?? false;
  if (active) {
    active.lastReturned = value;
    active.changed = false;
    active.submitted = false;
  }
  return { value, changed, submitted, focused };
}

// ---------- Select dropdown ----------

/** One entry in a `select` dropdown: a `label` and the `value` it yields. */
export interface SelectOption<T> {
  /** Text shown for this option. */
  label: string;
  /** Value returned when this option is chosen. */
  value: T;
  /** Non-selectable (grayed in the list). */
  disabled?: boolean;
}

/** Inputs to `select`: the controlled `value`, the `options` list, geometry,
 *  and native `<select>` hints. */
export interface SelectOptions<T> {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  /** Current value — controlled; matched against `options` by `Object.is`.
   *  Assign the result's `value` back. */
  value: T;
  /** The selectable options (label + value). */
  options: readonly SelectOption<T>[];
  /** Top-left x in logical px. */
  x?: number;
  /** Top-left y in logical px. */
  y?: number;
  /** Control width in px. Default `180`; the drop menu matches it. */
  w?: number;
  /** Control height in px. Default `32`. */
  h?: number;
  /** Place in this layout stack — supplies x/y (and h). */
  at?: Stack;
  /** Grayed out; won't open. */
  disabled?: boolean;
  /** Shown when no option matches `value`. Default `"Select…"`. */
  placeholder?: string;
  /** Max option rows shown at once; the list windows around the current
   *  selection. Default `8`. */
  maxVisible?: number;
  /** Accessible name for the hidden `<select>`. Falls back to `id`. */
  ariaLabel?: string;
  /** Keyboard traversal order. Negative values exclude the select. */
  tabIndex?: number;
}

/** What `select` returns this frame: the selected `value` plus changed/open
 *  flags. */
export interface SelectResult<T> {
  /** Currently selected value — assign it back to your state. */
  value: T;
  /** `true` for the one frame the selection changed. */
  changed: boolean;
  /** `true` while the drop menu is open. */
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
  selectSeen.add(id);
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
  // Clamp the upper bound to ≥ 1 so an empty option list still yields 1 row of
  // space (a plain clamp then works — the lower bound wins on an empty list).
  const visible = clamp(opts.maxVisible ?? 8, 1, Math.max(1, opts.options.length));
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
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
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

export let floats = createFloatText();

export let spinAngle = 0;

export let wired = false;

export function ensureWired(): void {
  wireFocusKeyboard();
  if (wired) return;
  // Registering the loop hooks needs the default game; without one
  // (headless/tests) the calls throw — stay unwired and retry next call.
  try {
    Loop.onStep(() => {
      floats.advance(Loop.step);
      spinAngle += 0.12; // ~7 rad/s at 60 steps
      padNav();
    });
    // Frame-end housekeeping for the immediate-mode state machines.
    Loop.onFrame(() => {
      // Deferred overlays render above every ordinary widget in the user's
      // draw callback (and still see frame-scoped pointer release edges).
      drawSelectOverlay();
      setBegunCtx(null); // re-begin() each frame when overriding the ctx
      // Complete this frame's keyboard registry (after every widget, including
      // deferred overlays, registered) and run the overlay focus trap.
      focusEndFrame();
      // Overlay capture: what was drawn this frame gates input next frame.
      overlayActive = overlaySeen;
      overlaySeen = false;
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
      if (textEditor && !textInputSeen.has(textEditor.id)) removeTextEditor();
      if (selectEditor && !selectSeen.has(selectEditor.id)) removeSelectEditor();
      textInputSeen.clear();
      selectSeen.clear();
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
 *  pickup labels. Aged on the fixed step; draw with `drawFloatText`. */
export function floatText(str: string, x: number, y: number, opts?: FloatTextOptions): void {
  ensureWired();
  floats.spawn(str, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloatText(ctx?: CanvasRenderingContext2D): void {
  floats.draw(ctx ?? uiCtx());
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloatText(): void {
  floats.clear();
}

/** Reset floats, theme and Loop wiring — for tests. */
export function _reset(): void {
  floats = createFloatText();
  setTheme({});
  tipRequest = null;
  tipShown = null;
  overlaySeen = false;
  overlayActive = false;
  inOverlayPass = false;
  activeDrag = null;
  removeTextEditor();
  removeSelectEditor();
  textInputSeen.clear();
  selectSeen.clear();
  selectOverlayRequest = null;
  selectCommit = null;
  resetFocus();
  idScopes.length = 0;
  setBegunCtx(null);
  wired = false;
}
