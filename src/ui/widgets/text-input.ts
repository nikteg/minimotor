// ---------- Text input ----------
// The themed text field: a canvas control backed by a hidden native <input> /
// <textarea>, mirroring the element's live caret/selection so the canvas text is
// selectable and Cmd/Ctrl+C copies it. A widget on the kernel — it evicts its
// native editor and clears its per-frame seen-set via the lifecycle hooks
// (onFrameEnd / onReset), so core never imports it back.
import {
  Flowable,
  activeClip,
  centeredText,
  claimPointerGesture,
  currentRuntime,
  dragPointer,
  drawBox,
  drawFocusRing,
  ensureWired,
  focusFromPointer,
  isInOverlayPass,
  isOverlayActive,
  measureWidth,
  onFrameEnd,
  onReset,
  place,
  rawPointer,
  registerFocusable,
  requiredWidgetId,
  runtimeSlot,
  setCursor,
  theme,
  uiCtx,
  uiFont,
  uiPointer,
  uiToScreen,
  withRuntime,
  wrapLines,
} from "../core/index.js";
import { pointInRect } from "../../collision.js";

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

/** A drawn field's hit target for the native press listener: its screen-space
 *  rect (plus the clip it was drawn under), the resolved opts to open an editor
 *  with, and whether it was input-dead behind an overlay when it drew. */
interface PressTarget {
  rect: { x: number; y: number; w: number; h: number };
  clip: { x: number; y: number; w: number; h: number } | undefined;
  opts: TextInputOptions & { id: string };
  dead: boolean;
}

interface TextInputState {
  editor: TextEditor | null;
  /** Ids of every text input drawn THIS frame. A Set, not a single id: with
   *  more than one field on screen, a single "last seen" id let a later-drawn
   *  field's id evict an earlier focused field's editor at frame-end (you
   *  couldn't focus any field but the last one). Cleared each frame. */
  seen: Set<string>;
  /** Hit targets accumulating THIS frame — swapped into `pressTargets` at
   *  frame end. */
  drawnTargets: Map<string, PressTarget>;
  /** Last completed frame's hit targets — what the native pointerdown listener
   *  tests. Mobile browsers only show the keyboard when `focus()` runs INSIDE
   *  a user-gesture event handler; the immediate-mode press detection runs a
   *  frame later (in rAF), which iOS ignores. So the canvas gets a real
   *  pointerdown listener that hit-tests these rects and opens/focuses the
   *  hidden editor synchronously. */
  pressTargets: Map<string, PressTarget>;
}
const st = runtimeSlot<TextInputState>(() => ({
  editor: null,
  seen: new Set(),
  drawnTargets: new Map(),
  pressTargets: new Map(),
}));

// Canvases with the native press listener attached (one per canvas).
const pressWired = new WeakSet<HTMLCanvasElement>();

function ensureNativePress(ctx: CanvasRenderingContext2D): void {
  const canvas = ctx.canvas;
  if (pressWired.has(canvas)) return;
  pressWired.add(canvas);
  const rt = currentRuntime();
  // The engine's own pointerdown listener registered first (at game build), so
  // the pointer's screen-logical coords are already updated when this runs.
  canvas.addEventListener("pointerdown", () => {
    withRuntime(rt, () => {
      const s = st();
      const p = rawPointer();
      for (const t of s.pressTargets.values()) {
        if (t.dead || t.opts.disabled) continue;
        if (!pointInRect(p.x, p.y, t.rect)) continue;
        if (t.clip && !pointInRect(p.x, p.y, t.clip)) continue;
        if (s.editor?.id === t.opts.id) s.editor.input.focus({ preventScroll: true });
        else openTextEditor(t.opts);
        return;
      }
    });
  });
}

/** Inputs to `textInput`: the controlled `value`, geometry, and native
 *  `<input>` hints. */
export interface TextInputOptions extends Flowable {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  /** Current text — controlled; pass your state in, assign the result's
   *  `value` back. */
  value: string;
  /** Field width in px. Default `180`. */
  w?: number;
  /** Field height in px. Default `32`. */
  h?: number;
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
  const s = st();
  s.editor?.input.remove();
  s.editor = null;
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
    const w = measureWidth(ctx, str.slice(0, i));
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
  st().editor = editor;
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
 * the controlled value plus one-frame `changed`/`submitted` flags:
 *
 *     const r = UI.textInput({ id: "chat", value: draft, placeholder: "Say something" });
 *     draft = r.value;
 *     if (r.submitted) { send(draft); draft = ""; } // Enter pressed this frame
 */
export function textInput(opts: TextInputOptions): TextInputResult {
  const ctx = uiCtx();
  ensureWired();
  ensureTextInputHooks();
  const id = requiredWidgetId(opts.id, "textInput");
  const s = st();
  s.seen.add(id);
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
  const rect = place({ ...opts, h: boxH }, opts.w ?? 180, boxH, "textInput");
  // Register this field with the native press listener (mobile keyboards need
  // a synchronous in-gesture focus — see `pressTargets`). Rect + clip stored in
  // SCREEN space so the raw pointer can hit-test them next frame.
  ensureNativePress(ctx);
  {
    const tl = uiToScreen(rect.x, rect.y);
    const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
    s.drawnTargets.set(id, {
      rect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
      clip: activeClip(),
      opts: resolvedOpts,
      dead: isOverlayActive() && !isInOverlayPass(),
    });
  }
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    native: true,
    rect,
    focus: () => {
      if (s.editor?.id === id) s.editor.input.focus({ preventScroll: true });
      else openTextEditor(resolvedOpts);
    },
    blur: () => {
      if (s.editor?.id === id) s.editor.input.blur();
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
    if (s.editor?.id === id) s.editor.input.focus({ preventScroll: true });
    else openTextEditor(resolvedOpts);
  } else if (p.pressed && !hovered && s.editor?.id === id) s.editor.input.blur();

  const active = s.editor?.id === id ? s.editor : null;
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
    // A live drag-selection owns the pointer (no body scroll while selecting).
    if (active.dragAnchor !== null) claimPointerGesture();
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
    } else if (active.dragAnchor !== null && rawPointer().down) {
      // Extend through `dragPointer` (mapped, never clip-gated) and hold the
      // drag on the RAW pointer — a selection drag that strays outside the
      // field's clip region must keep extending, not freeze mid-gesture.
      const dp = dragPointer();
      const idx = caretIndexAt(
        ctx,
        shown,
        active.scrollX,
        active.multiline,
        rect,
        innerX,
        innerW,
        lineH,
        dp.x,
        dp.y,
      );
      const a = Math.min(active.dragAnchor, idx);
      const b = Math.max(active.dragAnchor, idx);
      setNativeSelection(active.input, a, b, idx < active.dragAnchor ? "backward" : "forward");
    }
    if (!rawPointer().down) active.dragAnchor = null;
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
          const ax = innerX + measureWidth(ctx, shown.slice(ls, a));
          const bx = innerX + measureWidth(ctx, shown.slice(ls, b));
          ctx.fillRect(ax, top + i * lineH + 2, bx - ax, lineH - 4);
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = textColor;
      lines.forEach((line, i) => centeredText(ctx, line.text, innerX, top + i * lineH + lineH / 2));
      if (blink && lines.length > 0) {
        const line = lines[caretLine];
        const caretX = innerX + measureWidth(ctx, shown.slice(line.start, caretIdx));
        ctx.fillStyle = theme.accent;
        ctx.fillRect(caretX, top + caretLine * lineH + 3, 1, lineH - 6);
      }
    } else {
      // Single line: scroll horizontally so the caret stays inside the clip.
      const caretLocalX = measureWidth(ctx, shown.slice(0, caretIdx));
      let scroll = active.scrollX;
      if (caretLocalX - scroll > innerW) scroll = caretLocalX - innerW;
      if (caretLocalX - scroll < 0) scroll = caretLocalX;
      const maxScroll = Math.max(0, measureWidth(ctx, shown) - innerW);
      scroll = Math.max(0, Math.min(scroll, maxScroll));
      active.scrollX = scroll;
      const baseX = innerX - scroll;

      if (sel.start !== sel.end) {
        const a = baseX + measureWidth(ctx, shown.slice(0, sel.start));
        const b = baseX + measureWidth(ctx, shown.slice(0, sel.end));
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

// Native editing bridges only live while their immediate-mode widget is still
// submitted every frame; drop the editor when its field stops drawing.
function textInputEndFrame(): void {
  const s = st();
  if (s.editor && !s.seen.has(s.editor.id)) removeTextEditor();
  s.seen.clear();
  // Publish this frame's hit targets for the native press listener and start
  // collecting the next frame's into the (reused) old map.
  const drawn = s.drawnTargets;
  s.drawnTargets = s.pressTargets;
  s.drawnTargets.clear();
  s.pressTargets = drawn;
}

/** Reset text-input state — for tests (run via the kernel's onReset). */
function resetTextInput(): void {
  const s = st();
  removeTextEditor();
  s.seen.clear();
  s.drawnTargets.clear();
  s.pressTargets.clear();
}

// Register the frame-end eviction + reset with the lifecycle the first time a
// field is drawn, so core never has to import this widget.
let hooksRegistered = false;
function ensureTextInputHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onFrameEnd(textInputEndFrame);
  onReset(resetTextInput);
}
