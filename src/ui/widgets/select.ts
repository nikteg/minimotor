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
  currentUiTransform,
  dragPointer,
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
  pointerGestureOwned,
  popUiTransform,
  pushUiTransform,
  registerFocusable,
  requiredWidgetId,
  uiSlot,
  anchorViewport,
  theme,
  uiCtx,
  uiFont,
  uiHeight,
  uiPointer,
  uiWidth,
} from "@src/ui/core/index.js";
import { button } from "./button.js";
import { list, scrollGestureActive } from "./lists.js";
import { paintFrame } from "./panel.js";
import { pointInRect } from "@src/collision/index.js";
import { clamp } from "@src/math/mathf.js";

export interface SelectEditor {
  id: string;
  select: HTMLSelectElement;
  index: number;
  changed: boolean;
  open: boolean;
  justOpened: boolean;
  /** Drop-menu scroll offset (px) — the menu is a `list` scroll region. */
  scroll: number;
  /** `index` as of last frame, to detect keyboard moves and scroll to them. */
  lastIndex: number;
}

export interface SelectOverlayRequest<T = unknown> {
  ctx: CanvasRenderingContext2D;
  opts: SelectOptions<T> & { id: string };
  /** The control's rect in the coords it was DRAWN in (reference coords inside
   *  a `UI.scaled` block). The overlay pass re-applies `transform` before
   *  drawing, so the menu anchors under the control and zooms with it. */
  rect: { x: number; y: number; w: number; h: number };
  /** The UI transform in force when the select drew, or `null` at the root —
   *  the overlay pass runs after every `UI.scaled` block has popped, so the
   *  menu has to restore it itself. `w`/`h` are the reference-space size. */
  transform: { scale: number; ox: number; oy: number; w: number; h: number } | null;
}

// All select state, per UI runtime (each game owns its editor/menu). `seen` is
// the ids of every select drawn THIS frame — a Set, not a single id: with more
// than one select on screen, a single "last seen" id let a later-drawn
// select's id evict an earlier open select at frame-end (its menu vanished on
// the click that opened it). Cleared each frame.
interface SelectState {
  editor: SelectEditor | null;
  seen: Set<string>;
  request: SelectOverlayRequest | null;
  commit: { id: string; index: number } | null;
}

const st = uiSlot<SelectState>(() => ({
  editor: null,
  seen: new Set(),
  request: null,
  commit: null,
}));

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
  const s = st();
  s.editor?.select.remove();
  s.editor = null;
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
    scroll: 0,
    lastIndex: index,
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
  st().editor = editor;
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
  const s = st();
  if (s.editor?.id !== opts.id) openSelectEditor(opts, currentIndex, vertical);
  else if (vertical && !s.editor.open) {
    s.editor.open = true;
    s.editor.justOpened = true;
  }
  const editor = st().editor;
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
 * (via the focus machine) update the same controlled value. Controlled: pass
 * `value` in, assign the result's `value` back:
 *
 *     mode = UI.select({
 *       id: "mode",
 *       value: mode,
 *       options: [{ label: "Easy", value: "easy" }, { label: "Hard", value: "hard" }],
 *     }).value;
 */
export function select<T>(opts: SelectOptions<T>): SelectResult<T> {
  const ctx = uiCtx();
  ensureWired();
  ensureSelectHooks();
  const id = requiredWidgetId(opts.id, "select");
  const resolvedOpts = { ...opts, id };
  const s = st();
  s.seen.add(id);
  const rect = place(opts, opts.w ?? 180, opts.h ?? 32, "select");
  const currentIndex = opts.options.findIndex((option) => Object.is(option.value, opts.value));
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    native: true,
    rect,
    focus: () => {
      if (s.editor?.id === id) s.editor.select.focus({ preventScroll: true });
      else openSelectEditor(resolvedOpts, currentIndex, false);
    },
    blur: () => {
      if (s.editor?.id === id) {
        s.editor.open = false;
        s.editor.select.blur();
      }
    },
  });
  // With our menu open the ordinary `uiPointer` is dead (we're the overlay's
  // background), so read the ungated `dragPointer` instead — still mapped into
  // the active UI transform's reference coords, which is the space `rect` is
  // in. (The RAW pointer would be in screen coords and miss the control by the
  // UI scale — clicking the control then couldn't close its own menu.)
  const p = s.editor?.id === id ? dragPointer() : uiPointer();
  const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
  if (hovered) hoverCursor(true);

  // Toggle on release — but never on the release that merely ENDS a scroll
  // drag or a widget drag (`p` is the raw pointer while our menu is open, so
  // it ignores edge suppression): a swipe in the drop menu that lifts over the
  // control must not close the menu it just scrolled.
  if (hovered && p.released && !opts.disabled && !scrollGestureActive() && !pointerGestureOwned()) {
    focusFromPointer(ctx, id);
    if (s.editor?.id === id) {
      s.editor.open = !s.editor.open;
      s.editor.justOpened = s.editor.open;
      s.editor.select.focus({ preventScroll: true });
    } else openSelectEditor(resolvedOpts, currentIndex);
  }

  // Gamepad navigation (keyboard runs through the native <select>): padNav feeds
  // A → activation and d-pad/stick → arrow commands to the focused widget.
  if (!opts.disabled) {
    if (consumeKeyboardActivation(id)) {
      if (s.editor?.id === id) {
        s.editor.open = !s.editor.open;
        s.editor.justOpened = s.editor.open;
      } else openSelectEditor(resolvedOpts, currentIndex, true);
    }
    handleSelectCommand(resolvedOpts, currentIndex);
  }

  let editor = s.editor?.id === id ? s.editor : null;
  const committed = s.commit?.id === id ? s.commit.index : -1;
  if (committed >= 0) s.commit = null;
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
    // The overlay pass runs AFTER any enclosing `UI.scaled` block has popped,
    // so snapshot the transform alongside the rect and let the pass restore
    // it: the menu then anchors under the control AND zooms with it (rows,
    // labels and hit-testing all in the control's own space).
    enterOverlay();
    const t = currentUiTransform();
    s.request = {
      ctx,
      opts: resolvedOpts,
      rect,
      transform: t ? { ...t, w: uiWidth(), h: uiHeight() } : null,
    } as SelectOverlayRequest;
    editor.changed = false;
  }
  return { value, changed, open: !!editor?.open };
}

export function drawSelectOverlay(): void {
  const s = st();
  const request = s.request;
  s.request = null;
  if (!request || !s.editor?.open || s.editor.id !== request.opts.id) return;
  // The overlay pass runs inside this runtime's frame end, so the ambient
  // context already points at the canvas the select was drawn on — but every
  // `UI.scaled` block has popped by now, canvas-side and pointer-side. Restore
  // the transform the control drew under so the menu matches it.
  const t = request.transform;
  const ctx = request.ctx;
  if (!t) {
    drawSelectMenu(ctx, request.opts, request.rect);
    return;
  }
  ctx.save();
  ctx.translate(t.ox, t.oy);
  ctx.scale(t.scale, t.scale);
  // The overlay pass is at the root (no enclosing transform to compose with),
  // so the snapshot's absolute offset goes in as-is.
  pushUiTransform(t.scale, t.ox, t.oy, t.w, t.h);
  try {
    drawSelectMenu(ctx, request.opts, request.rect);
  } finally {
    popUiTransform();
    ctx.restore();
  }
}

function drawSelectMenu(
  ctx: CanvasRenderingContext2D,
  opts: SelectOptions<unknown> & { id: string },
  rect: { x: number; y: number; w: number; h: number },
): void {
  const editor = st().editor!;
  // Ungated (we own the overlay) but mapped through the restored transform, so
  // it compares against `rect`/`menu` in the coords they're laid out in.
  const p = dragPointer();
  const value = editor.index >= 0 ? opts.options[editor.index]?.value : opts.value;
  const count = opts.options.length;
  // Clamp the upper bound to ≥ 1 so an empty option list still yields 1 row of
  // space (a plain clamp then works — the lower bound wins on an empty list).
  const visible = clamp(opts.maxVisible ?? 8, 1, Math.max(1, count));
  const itemH = 30;
  const pad = 2;
  const listH = visible * itemH; // the visible window; the list scrolls the rest
  const menuH = listH + pad * 2;
  const vp = anchorViewport();
  const menuY = rect.y + rect.h + menuH <= vp.h - 4 ? rect.y + rect.h + 2 : rect.y - menuH - 2;
  const menu = { x: rect.x, y: menuY, w: rect.w, h: menuH };

  ctx.save();
  ctx.fillStyle = theme.bgActive;
  ctx.fillRect(menu.x, menu.y, menu.w, menu.h);
  ctx.restore();
  paintFrame(ctx, { ...menu, bg: theme.bgActive });

  // Keep the highlighted option in view: center it when the menu just opened,
  // and snap to it when the keyboard (native <select>) moved the selection.
  // Otherwise leave the offset alone so wheel/drag scrolling isn't fought.
  const max = Math.max(0, count * itemH - listH);
  if (editor.justOpened) {
    editor.scroll = clamp(editor.index * itemH - (listH - itemH) / 2, 0, max);
  } else if (editor.index !== editor.lastIndex && editor.index >= 0) {
    const top = editor.index * itemH;
    if (top < editor.scroll) editor.scroll = top;
    else if (top + itemH > editor.scroll + listH) editor.scroll = top + itemH - listH;
    editor.scroll = clamp(editor.scroll, 0, max);
  }
  editor.lastIndex = editor.index;

  // The menu is a windowed `list` scroll region: scrollbar + wheel + swipe, only
  // the visible options drawn. The row callback paints one option button.
  let picked = -1;
  editor.scroll = list(
    {
      x: menu.x + pad,
      y: menu.y + pad,
      w: menu.w - pad * 2,
      h: listH,
      rowH: itemH,
      count,
      offset: editor.scroll,
      id: `${opts.id}:menu`,
    },
    (i, r) => {
      const option = opts.options[i];
      if (
        button({
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          label: option.label,
          disabled: option.disabled,
          variant: Object.is(option.value, value) ? "primary" : "ghost",
        })
      ) {
        picked = i;
      }
    },
  );

  if (picked >= 0) {
    editor.index = picked;
    editor.select.value = String(picked);
    editor.open = false;
    st().commit = { id: opts.id, index: picked }; // observed by select() next draw
    return;
  }

  // Close on a click outside — but never on the release that merely ends a
  // scroll gesture or a widget drag (e.g. a swipe that started inside the menu
  // and lifted outside it must not dismiss the menu).
  if (
    !editor.justOpened &&
    p.released &&
    !pointInRect(p.x, p.y, rect) &&
    !pointInRect(p.x, p.y, menu) &&
    !scrollGestureActive() &&
    !pointerGestureOwned()
  ) {
    removeSelectEditor();
    return;
  }
  editor.justOpened = false;
}

// Frame-end: drop a native editor whose immediate-mode select stopped drawing,
// then clear the per-frame seen set. Called by frame's onFrame housekeeping.
export function selectEndFrame(): void {
  const s = st();
  if (s.editor && !s.seen.has(s.editor.id)) removeSelectEditor();
  s.seen.clear();
}

/** Reset all select state — for tests (see frame `_reset`). */
export function resetSelect(): void {
  const s = st();
  removeSelectEditor();
  s.seen.clear();
  s.request = null;
  s.commit = null;
}
