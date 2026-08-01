// ---------- Select dropdown ----------
// The themed <select>: a canvas control backed by a hidden native <select>
// (for accessibility + native keyboard), whose drop menu is a deferred canvas
// overlay. A widget on the kernel — it drives the shared focus machine and hangs
// its deferred menu draw + editor cleanup off the frame loop via the kernel's
// lifecycle hooks (onOverlayPass / onFrameEnd / onReset), so core never imports
// it back.
import {
  Flowable,
  captureOverlay,
  centeredText,
  consumeKeyboardActivation,
  consumeKeyboardCommand,
  buttonState,
  drawBox,
  currentUiTransform,
  dragPointer,
  drawFocusRing,
  drawThemeSprite,
  ensureWired,
  enterOverlay,
  focusFromPointer,
  hoverCursor,
  lifecycleOnce,
  layoutCaptureActive,
  recordLayout,
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
  fitAnchored,
  theme,
  uiCtx,
  uiFont,
  uiHeight,
  uiPointer,
  uiWidth,
  ellipsize,
  resolveThemeTextPadding,
  wrapLines,
  withTheme,
} from "@src/ui/core/index.js";
import { dismissedByOutsideRelease, list, scrollGestureActive } from "./lists.js";
import { listMetrics } from "./list-metrics.js";
import { evictUnseenEditor, mountHiddenEditor, type NativeEditorHost } from "./native-editor.js";
import { paintFrame } from "./panel.js";
import { pointInRect } from "@src/collision/index.js";
import { clamp } from "@src/math/mathf.js";
import type { ThemePadding, ThemeTextPadding } from "@src/ui/theme.js";

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
  opts: ResolvedSelectOptions<T>;
  /** The control's rect in the coords it was DRAWN in (reference coords inside
   *  a `UI.scaled` block). The overlay pass re-applies `transform` before
   *  drawing, so the menu anchors under the control and zooms with it. */
  rect: { x: number; y: number; w: number; h: number };
  /** The UI transform in force when the select drew, or `null` at the root —
   *  the overlay pass runs after every `UI.scaled` block has popped, so the
   *  menu has to restore it itself. `w`/`h` are the reference-space size. */
  transform: { scale: number; ox: number; oy: number; w: number; h: number } | null;
  /** Theme scope captured where the control was drawn. Deferred overlays run
   *  after lexical layout scopes have unwound, so restore it explicitly. */
  theme: import("@src/ui/theme.js").Theme;
}

// All select state, per UI runtime (each game owns its editor/menu). The
// editor + `seen` half is the shared native-editor host — see `native-editor.ts`
// for why `seen` is a Set.
interface SelectState extends NativeEditorHost<SelectEditor> {
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

/** A labeled section in a grouped select menu. Group headers are visual and
 *  non-selectable; their options keep the same value/keyboard semantics as a
 *  flat `options` list. */
export interface SelectGroup<T> {
  label: string;
  options: readonly SelectOption<T>[];
}

/** Inputs to `select`: the controlled `value`, the `options` list, geometry,
 *  and native `<select>` hints. */
export interface SelectOptions<T> extends Flowable {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  /** Current value — controlled; matched against `options` by `Object.is`.
   *  Assign the result's `value` back. */
  value: T;
  /** The selectable options (label + value). Omit when using `groups`. */
  options?: readonly SelectOption<T>[];
  /** Optional labeled sections. When present, these are flattened for the
   *  controlled value but rendered with non-selectable group headers. */
  groups?: readonly SelectGroup<T>[];
  /** Control width in px. Default `180`; the drop menu matches it. */
  w?: number;
  /** Control height in px. Default `32`. */
  h?: number;
  /** Additional inset for the selected label inside the closed control. A
   *  scalar applies to both axes; an object can separate x/y. Defaults to the
   *  theme's `textPad`. */
  textPad?: ThemeTextPadding;
  /** Grayed out; won't open. */
  disabled?: boolean;
  /** Shown when no option matches `value`. Default `"Select…"`. */
  placeholder?: string;
  /** Max option rows shown at once; the list windows around the current
   *  selection. Default `8`. */
  maxVisible?: number;
  /** Inner padding between the dropdown frame and its option list. Defaults
   *  to `theme.pad`, so tiled frames keep their fixed border slices clear. */
  menuPad?: ThemePadding;
  /** Wrap long option labels onto as many lines as they need. Default `false`. */
  wrapItems?: boolean;
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

type ResolvedSelectOptions<T> = SelectOptions<T> & {
  id: string;
  options: readonly SelectOption<T>[];
};

type SelectMenuEntry<T> =
  | { kind: "group"; label: string }
  | { kind: "option"; optionIndex: number; option: SelectOption<T> };

function flattenOptions<T>(opts: SelectOptions<T>): readonly SelectOption<T>[] {
  if (opts.groups) return opts.groups.flatMap((group) => group.options);
  return opts.options ?? [];
}

function menuEntries<T>(opts: ResolvedSelectOptions<T>): SelectMenuEntry<T>[] {
  if (!opts.groups) {
    return opts.options.map((option, optionIndex) => ({ kind: "option", optionIndex, option }));
  }
  const entries: SelectMenuEntry<T>[] = [];
  let optionIndex = 0;
  for (const group of opts.groups) {
    entries.push({ kind: "group", label: group.label });
    for (const option of group.options) {
      entries.push({ kind: "option", optionIndex, option });
      optionIndex++;
    }
  }
  return entries;
}

// The select hangs a deferred menu draw + editor cleanup off the frame loop.
// Register those with the lifecycle the first time a select is drawn, so core
// never has to import this widget.
const ensureSelectHooks = lifecycleOnce(() => {
  onOverlayPass(drawSelectOverlay);
  onFrameEnd(selectEndFrame);
  onReset(resetSelect);
});

export function removeSelectEditor(): void {
  const s = st();
  s.editor?.select.remove();
  s.editor = null;
}

export function openSelectEditor<T>(
  opts: ResolvedSelectOptions<T>,
  index: number,
  menuOpen = true,
): void {
  removeSelectEditor();
  const select = document.createElement("select");
  if (opts.groups) {
    let optionIndex = 0;
    for (const group of opts.groups) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const option of group.options) {
        const nativeOption = document.createElement("option");
        nativeOption.value = String(optionIndex++);
        nativeOption.textContent = option.label;
        nativeOption.disabled = option.disabled ?? false;
        optgroup.appendChild(nativeOption);
      }
      select.appendChild(optgroup);
    }
  } else {
    for (let i = 0; i < opts.options.length; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = opts.options[i].label;
      option.disabled = opts.options[i].disabled ?? false;
      select.appendChild(option);
    }
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
  mountHiddenEditor(select, opts.ariaLabel ?? opts.id);
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
function handleSelectCommand<T>(opts: ResolvedSelectOptions<T>, currentIndex: number): void {
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
  const options = flattenOptions(opts);
  const resolvedOpts: ResolvedSelectOptions<T> = { ...opts, id, options };
  const s = st();
  s.seen.add(id);
  const rect = place(opts, opts.w ?? 180, opts.h ?? theme.inputH, "select", true);
  const currentIndex = options.findIndex((option) => Object.is(option.value, opts.value));
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
  const focusHover = keyboardFocused && theme.focusStyle === "hover";
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
      ? (options[committed]?.value ?? opts.value)
      : editor && editor.index >= 0
        ? (options[editor.index]?.value ?? opts.value)
        : opts.value;
  let changed = committed >= 0 || (editor?.changed ?? false);
  const selected = options.find((option) => Object.is(option.value, value));

  ctx.save();
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: opts.disabled ? theme.bgActive : focusHover ? theme.bgHover : theme.bg,
    stroke: focusHover
      ? theme.accentSoft
      : editor
        ? theme.accent
        : hovered
          ? theme.accentSoft
          : theme.border,
    // A select is an input control, not a button: themed skins often provide
    // different nine-slice art and native dimensions for the two surfaces.
    role: "input",
    state: opts.disabled
      ? "disabled"
      : focusHover
        ? "hover"
        : editor
          ? "active"
          : hovered
            ? "hover"
            : "default",
  });
  ctx.font = uiFont();
  ctx.fillStyle = selected ? theme.text : theme.textDim;
  ctx.textAlign = "left";
  const textPad = resolveThemeTextPadding(opts.textPad, theme.textPad);
  const baseTextX = theme.spacing.lg - 2;
  const arrowSpace = theme.spacing.lg * 2 + theme.spacing.md;
  centeredText(
    ctx,
    selected?.label ?? opts.placeholder ?? "Select…",
    rect.x + baseTextX + textPad.x,
    rect.y + textPad.y + (rect.h - textPad.y * 2) / 2,
    Math.max(1, rect.w - arrowSpace - textPad.x * 2),
  );
  const arrow = theme.skin?.sprites.icons?.selectArrow;
  if (arrow) {
    const arrowH = Math.min(rect.h - 8, arrow.region.sh);
    const arrowW = Math.min(theme.spacing.xl, (arrow.region.sw / arrow.region.sh) * arrowH);
    drawThemeSprite(
      ctx,
      "selectArrow",
      rect.x + rect.w - arrowW - theme.spacing.sm,
      rect.y + (rect.h - arrowH) / 2,
      arrowW,
      arrowH,
    );
  } else {
    ctx.fillStyle = theme.textDim;
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w - 20, rect.y + rect.h / 2 - 3);
    ctx.lineTo(rect.x + rect.w - 10, rect.y + rect.h / 2 - 3);
    ctx.lineTo(rect.x + rect.w - 15, rect.y + rect.h / 2 + 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  if (keyboardFocused && !focusHover) drawFocusRing(ctx, rect);

  if (editor?.open) {
    markFocusableOverlay(id);
    // Defer the menu until frame-end so siblings drawn later in the callback
    // layout cannot paint over it. Input is still captured immediately.
    // The overlay pass runs AFTER any enclosing `UI.scaled` block has popped,
    // so snapshot the transform alongside the rect and let the pass restore
    // it: the menu then anchors under the control AND zooms with it (rows,
    // labels and hit-testing all in the control's own space).
    captureOverlay();
    const t = currentUiTransform();
    s.request = {
      ctx,
      opts: resolvedOpts,
      rect,
      transform: t ? { ...t, w: uiWidth(), h: uiHeight() } : null,
      theme,
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
  // The normal draw pass captured the background already; only now does the
  // deferred menu become the live side of the overlay boundary.
  enterOverlay();
  // The overlay pass runs inside this runtime's frame end, so the ambient
  // context already points at the canvas the select was drawn on — but every
  // `UI.scaled` block has popped by now, canvas-side and pointer-side. Restore
  // the transform the control drew under so the menu matches it.
  const t = request.transform;
  const ctx = request.ctx;
  if (!t) {
    withTheme(request.theme, () => drawSelectMenu(ctx, request.opts, request.rect));
    return;
  }
  ctx.save();
  ctx.translate(t.ox, t.oy);
  ctx.scale(t.scale, t.scale);
  // The overlay pass is at the root (no enclosing transform to compose with),
  // so the snapshot's absolute offset goes in as-is.
  pushUiTransform(t.scale, t.ox, t.oy, t.w, t.h);
  try {
    withTheme(request.theme, () => drawSelectMenu(ctx, request.opts, request.rect));
  } finally {
    popUiTransform();
    ctx.restore();
  }
}

/** The `theme.select` label color for one row state. Shared by the plain and
 *  the wrapped painter so a wrapped menu can't drift from a normal one. */
function selectRowLabelColor(disabled: boolean | undefined, selected: boolean): string {
  if (disabled) return theme.select.textDisabled;
  return selected ? theme.select.textSelected : theme.select.text;
}

/** Paint one option row and report a click on it.
 *
 *  Deliberately NOT a `button()`: menu rows only ever looked like buttons
 *  because that was the nearest widget to hand, which left them wearing the
 *  primary/ghost variants — so restyling a call-to-action moved the dropdown
 *  highlight, and `button`'s hard-wired disabled fill and hover border ring
 *  were unreachable from a theme. Rows now read `theme.select` directly. They
 *  are also not focusable: the open menu is driven by the native `<select>`
 *  behind it, so putting every row in the tab order would fight it. */
function selectRow(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  disabled: boolean | undefined,
  selected: boolean,
): boolean {
  // Rows used to appear in the layout tree as `button`s, because they used to
  // BE buttons. They are their own kind now — the menu is windowed by `list`,
  // so no `place()` call records them.
  if (layoutCaptureActive) recordLayout("selectOption", undefined, rect);
  const s = theme.select;
  const state = disabled
    ? { hover: false, active: false, clicked: false }
    : buttonState(rect, uiPointer());
  hoverCursor(state.hover);
  const fill = disabled
    ? s.bgDisabled
    : selected
      ? state.active
        ? s.bgSelectedActive
        : state.hover
          ? s.bgSelectedHover
          : s.bgSelected
      : state.active
        ? s.bgActive
        : state.hover
          ? s.bgHover
          : s.bg;
  if (fill !== "transparent") {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
  if (label) {
    ctx.save();
    ctx.font = uiFont(theme.fontSize + 2, true);
    ctx.fillStyle = selectRowLabelColor(disabled, selected);
    ctx.textAlign = "center";
    centeredText(
      ctx,
      label,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2 + (state.active ? 1 : 0),
      rect.w - 12, // labels squeeze rather than spill
    );
    ctx.restore();
  }
  return state.clicked;
}

function drawWrappedSelectLabel(
  ctx: CanvasRenderingContext2D,
  option: SelectOption<unknown>,
  rect: { x: number; y: number; w: number; h: number },
  selected: boolean,
): void {
  ctx.save();
  ctx.font = uiFont(theme.fontSize + 2, true);
  ctx.fillStyle = selectRowLabelColor(option.disabled, selected);
  ctx.textAlign = "center";
  const maxW = Math.max(1, rect.w - 12);
  const lineH = theme.fontSize + 8;
  const maxLines = Math.max(1, Math.floor((rect.h - 4) / lineH));
  const lines = wrapLines(ctx, option.label, maxW);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = ellipsize(ctx, `${lines[maxLines - 1]}…`, maxW);
  }
  const blockH = lines.length * lineH;
  const top = rect.y + (rect.h - blockH) / 2;
  for (let i = 0; i < lines.length; i++) {
    centeredText(ctx, lines[i], rect.x + rect.w / 2, top + i * lineH + lineH / 2, maxW);
  }
  ctx.restore();
}

function drawSelectMenu(
  ctx: CanvasRenderingContext2D,
  opts: ResolvedSelectOptions<unknown>,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const editor = st().editor!;
  // Ungated (we own the overlay) but mapped through the restored transform, so
  // it compares against `rect`/`menu` in the coords they're laid out in.
  const p = dragPointer();
  const value = editor.index >= 0 ? opts.options[editor.index]?.value : opts.value;
  const entries = menuEntries(opts);
  const count = entries.length;
  // Group headers count toward the visible window, while `maxVisible` still
  // means selectable option rows. Each entry's height is measured below, so a
  // short label occupies one line and a wrapped label gets only the space it
  // actually needs.
  const requestedPad = opts.menuPad ?? theme.pad;
  // Keep a tiny usable body for unusually narrow controls instead of allowing
  // negative list dimensions when a theme's frame padding is larger than the
  // select width.
  const padX = Math.min(Math.max(0, requestedPad.x), Math.max(0, (rect.w - 1) / 2));
  const padY = Math.max(0, requestedPad.y);
  const lineH = theme.fontSize + 8;
  // A skinned group header is a decorative STRIP, and strips are usually fixed-
  // height plates: their whole height is the nine-slice's repeating band (top
  // and bottom insets of 0), so a row taller than the art tiles a second copy
  // of the plate under the first — Tiny RPG's 24px alt title strip in a 32px
  // row shows 8px of a second plate, complete with its end caps. Give the row
  // the art's own height, floored at the text height so a short strip still
  // clears its label. Without a skin the header is plain text and keeps the
  // roomier `lineH + 8`.
  const groupArtH = theme.skin?.frames.menuGroup?.sh;
  const groupH = groupArtH === undefined ? lineH + 8 : Math.max(lineH, groupArtH);
  const itemHeights = (() => {
    ctx.save();
    ctx.font = uiFont(theme.fontSize + 2, true);
    const maxW = Math.max(1, rect.w - padX * 2 - 26);
    const heights = entries.map((entry) => {
      if (entry.kind === "group") return groupH;
      if (!opts.wrapItems) return lineH + 8;
      return Math.max(lineH + 8, wrapLines(ctx, entry.option.label, maxW).length * lineH + 8);
    });
    ctx.restore();
    return heights;
  })();
  const metrics = listMetrics(count, (index) => itemHeights[index]);
  const visibleOptions = Math.max(1, opts.maxVisible ?? 8);
  let visibleEntries = 0;
  let visibleOptionCount = 0;
  while (visibleEntries < count) {
    const entry = entries[visibleEntries];
    if (entry.kind === "option" && visibleOptionCount >= visibleOptions) break;
    visibleEntries++;
    if (entry.kind === "option") visibleOptionCount++;
  }
  let listH = metrics.tops[visibleEntries] ?? 0;
  if (listH <= 0) listH = lineH + 8;
  const menuH = listH + padY * 2;
  const gap = 2;
  const menuPos = fitAnchored(
    { x: rect.x, y: rect.y + rect.h + gap, w: rect.w, h: menuH },
    rect.y - menuH - gap,
    4,
  );
  const menu = { x: menuPos.x, y: menuPos.y, w: rect.w, h: menuH };

  ctx.save();
  ctx.fillStyle = theme.bgActive;
  ctx.fillRect(menu.x, menu.y, menu.w, menu.h);
  ctx.restore();
  paintFrame(ctx, { ...menu, bg: theme.bgActive });

  // Keep the highlighted option in view: center it when the menu just opened,
  // and snap to it when the keyboard (native <select>) moved the selection.
  // Otherwise leave the offset alone so wheel/drag scrolling isn't fought.
  const selectedEntry = entries.findIndex(
    (entry) => entry.kind === "option" && entry.optionIndex === editor.index,
  );
  const max = Math.max(0, metrics.content - listH);
  if (editor.justOpened) {
    const selectedTop = selectedEntry >= 0 ? metrics.tops[selectedEntry] : 0;
    const selectedH = selectedEntry >= 0 ? itemHeights[selectedEntry] : lineH + 8;
    editor.scroll = clamp(selectedTop - (listH - selectedH) / 2, 0, max);
  } else if (editor.index !== editor.lastIndex && editor.index >= 0) {
    const top = selectedEntry >= 0 ? metrics.tops[selectedEntry] : 0;
    const selectedH = selectedEntry >= 0 ? itemHeights[selectedEntry] : lineH + 8;
    if (top < editor.scroll) editor.scroll = top;
    else if (top + selectedH > editor.scroll + listH) editor.scroll = top + selectedH - listH;
    editor.scroll = clamp(editor.scroll, 0, max);
  }
  editor.lastIndex = editor.index;

  // The menu is a windowed `list` scroll region: scrollbar + wheel + swipe, only
  // the visible options drawn. The row callback paints one option row.
  let picked = -1;
  editor.scroll = list(
    {
      x: menu.x + padX,
      y: menu.y + padY,
      w: menu.w - padX * 2,
      h: listH,
      rowH: (index) => itemHeights[index],
      count,
      offset: editor.scroll,
      id: `${opts.id}:menu`,
    },
    (i, r) => {
      const entry = entries[i];
      if (entry.kind === "group") {
        // A skin that names `menuGroup` gets its strip drawn behind the label;
        // without one the header stays plain text, as it always was.
        if (theme.skin?.frames.menuGroup) {
          drawBox(ctx, r.x, r.y, r.w, r.h, { role: "menuGroup" });
        }
        ctx.save();
        ctx.font = uiFont(theme.fontSize, true);
        ctx.fillStyle = theme.select.groupLabel;
        ctx.textAlign = "center";
        centeredText(ctx, entry.label, r.x + r.w / 2, r.y + r.h / 2, r.w - 4);
        ctx.restore();
        return;
      }
      const option = entry.option;
      const selectedOption = Object.is(option.value, value);
      // Wrapped labels are drawn below, after the row paints its fill.
      const clicked = selectRow(
        ctx,
        r,
        opts.wrapItems ? "" : option.label,
        option.disabled,
        selectedOption,
      );
      if (opts.wrapItems) drawWrappedSelectLabel(ctx, option, r, selectedOption);
      if (clicked) picked = entry.optionIndex;
    },
  );

  if (picked >= 0) {
    editor.index = picked;
    editor.select.value = String(picked);
    editor.open = false;
    st().commit = { id: opts.id, index: picked }; // observed by select() next draw
    return;
  }

  // Close on a click outside the menu AND the control that opened it. (The
  // frame the menu opens is exempt: that press is what opened it.)
  if (!editor.justOpened && dismissedByOutsideRelease(p, rect, menu)) {
    removeSelectEditor();
    return;
  }
  editor.justOpened = false;
}

// Called by frame's onFrame housekeeping.
export function selectEndFrame(): void {
  evictUnseenEditor(st(), removeSelectEditor);
}

/** Reset all select state — for tests (see frame `_reset`). */
export function resetSelect(): void {
  const s = st();
  removeSelectEditor();
  s.seen.clear();
  s.request = null;
  s.commit = null;
}
