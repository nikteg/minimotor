// ---------- Select dropdown ----------
// The themed <select>: a canvas control backed by a hidden native <select>
// (for accessibility + native keyboard), whose drop menu is a deferred canvas
// overlay. A widget on the kernel — it drives the shared focus machine and hangs
// its deferred menu draw + editor cleanup off the frame loop via the kernel's
// lifecycle hooks (onOverlayPass / onFrameEnd / onReset), so core never imports
// it back.
import {
  Flowable,
  centeredText,
  consumeKeyboardActivation,
  consumeKeyboardCommand,
  drawBox,
  drawFocusRing,
  ensureWired,
  enterOverlay,
  focusFromPointer,
  hoverCursor,
  markFocusableOverlay,
  onFrameEnd,
  onOverlayPass,
  onReset,
  place,
  rawPointer,
  registerFocusable,
  requiredWidgetId,
  theme,
  uiFont,
  uiPointer,
  withCtx,
} from "../core/index.js";
import { button } from "./button.js";
import { paintFrame } from "./panel.js";
import { pointInRect } from "../../collision.js";
import { clamp } from "../../mathf.js";
import { Stage } from "../../engine/index.js";

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
export interface SelectOptions<T> extends Flowable {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  /** Current value — controlled; matched against `options` by `Object.is`.
   *  Assign the result's `value` back. */
  value: T;
  /** The selectable options (label + value). */
  options: readonly SelectOption<T>[];
  /** Control width in px. Default `180`; the drop menu matches it. */
  w?: number;
  /** Control height in px. Default `32`. */
  h?: number;
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

// The select hangs a deferred menu draw + editor cleanup off the frame loop.
// Register those with the lifecycle the first time a select is drawn, so core
// never has to import this widget.
let hooksRegistered = false;
function ensureSelectHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onOverlayPass(drawSelectOverlay);
  onFrameEnd(selectEndFrame);
  onReset(resetSelect);
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

// Step `index` to the next non-disabled option in `dir`, clamped at the ends.
function nextEnabled<T>(options: readonly SelectOption<T>[], index: number, dir: 1 | -1): number {
  let i = index;
  for (let step = 0; step < options.length; step++) {
    const candidate = i + dir;
    if (candidate < 0 || candidate >= options.length) break;
    i = candidate;
    if (!options[i].disabled) return i;
  }
  return index >= 0 ? index : dir > 0 ? Math.min(0, options.length - 1) : options.length - 1;
}

// Feed a focus-machine command (from padNav's dpad, or a keyboard fallback) to
// the focused select: move the highlighted option by one, opening a closed
// select on a vertical nudge so the change is visible. Returns whether the
// command was ours.
function handleSelectCommand<T>(
  opts: SelectOptions<T> & { id: string },
  currentIndex: number,
): void {
  const cmd = consumeKeyboardCommand(opts.id);
  if (!cmd) return;
  const dir: 1 | -1 = cmd === "ArrowDown" || cmd === "ArrowRight" ? 1 : -1;
  const vertical = cmd === "ArrowDown" || cmd === "ArrowUp";
  if (selectEditor?.id !== opts.id) openSelectEditor(opts, currentIndex, vertical);
  else if (vertical && !selectEditor.open) {
    selectEditor.open = true;
    selectEditor.justOpened = true;
  }
  const editor = selectEditor;
  if (!editor) return;
  const from = editor.index >= 0 ? editor.index : currentIndex;
  const next = nextEnabled(opts.options, from, dir);
  if (next !== editor.index) {
    editor.index = next;
    editor.select.value = String(next);
    editor.changed = true;
  }
}

/** Themed dropdown backed by a hidden native `<select>`. Clicking opens a
 * canvas option list; focused keyboard arrows (native) and gamepad d-pad/stick
 * (via the focus machine) update the same controlled value. */
export function select<T>(opts: SelectOptions<T>): SelectResult<T>;
export function select<T>(ctx: CanvasRenderingContext2D, opts: SelectOptions<T>): SelectResult<T>;
export function select<T>(
  ctxOrOpts: CanvasRenderingContext2D | SelectOptions<T>,
  maybeOpts?: SelectOptions<T>,
): SelectResult<T> {
  const [ctx, opts] = withCtx(ctxOrOpts, maybeOpts);
  ensureWired();
  ensureSelectHooks();
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

  // Gamepad navigation (keyboard runs through the native <select>): padNav feeds
  // A → activation and d-pad/stick → arrow commands to the focused widget.
  if (!opts.disabled) {
    if (consumeKeyboardActivation(id)) {
      if (selectEditor?.id === id) {
        selectEditor.open = !selectEditor.open;
        selectEditor.justOpened = selectEditor.open;
      } else openSelectEditor(resolvedOpts, currentIndex, true);
    }
    handleSelectCommand(resolvedOpts, currentIndex);
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
    enterOverlay();
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
  paintFrame(ctx, { ...menu, bg: theme.bgActive });
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

// Frame-end: drop a native editor whose immediate-mode select stopped drawing,
// then clear the per-frame seen set. Called by frame's onFrame housekeeping.
export function selectEndFrame(): void {
  if (selectEditor && !selectSeen.has(selectEditor.id)) removeSelectEditor();
  selectSeen.clear();
}

/** Reset all select state — for tests (see frame `_reset`). */
export function resetSelect(): void {
  removeSelectEditor();
  selectSeen.clear();
  selectOverlayRequest = null;
  selectCommit = null;
}
