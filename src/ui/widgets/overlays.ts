import { ButtonVariant, button } from "./button.js";
import { PanelFrame, paintFrame } from "./panel.js";
import { panel, row } from "./layout.js";
import { dismissedByOutsideRelease } from "./lists.js";
import {
  LayoutChildren,
  cachedContentSize,
  consumeDismissRequest,
  ensureWired,
  enterOverlay,
  flow,
  hasActiveNavPad,
  lastContainerRect,
  lastWidgetRect,
  measureWidth,
  rawPointer,
  runAutoSized,
  sweptCache,
  text,
  theme,
  uiCtx,
  uiFont,
  uiToScreen,
} from "@src/ui/core/index.js";
import { anchorViewport, fitAnchored } from "@src/ui/core/index.js";

// Scale is LEXICAL: an overlay is scaled by the `UI.scaled` block it's drawn
// in, like any other widget — it just has to be drawn LATE (so it paints over
// the screen and deadens what's behind it), which is ordering, not scoping.
// Draw them at the end of the same block as the rest of the UI. Widgets that
// paint in a DEFERRED pass (the select drop menu, tooltips, float text) can't
// do that — they snapshot the block they were requested in and replay it.

// ---------- Popover ----------

/** An anchored floating panel (dropdown, filter flyout). */
export interface PopoverOptions extends Omit<PanelFrame, "x" | "y" | "w" | "h"> {
  /** Open state — pass yours in, assign the return value back. */
  open: boolean;
  /** Identity across frames. Defaults to the position. */
  id?: string;
  /** Left edge in px. OMIT (with `y`) to ANCHOR to the last placed widget —
   *  the popover opens under it (flipping above when out of room, clamped to
   *  the viewport), so a trigger button in a flowing layout needs no
   *  coordinates at all. */
  x?: number;
  /** Top edge in px (see `x`). */
  y?: number;
  /** Explicit width. Omit in the `children` form to auto-size to its content. */
  w?: number;
  /** Explicit height. OMIT when using the `children` form — the box then
   *  AUTO-SIZES to its content (measured last frame, à la `group`). */
  h?: number;
  /** Gap between children (children form). Default 8. */
  gap?: number;
  /** Inner padding (children form). Default 12. */
  pad?: number;
}

// Whether each popover was open LAST frame — the click that opens one lands
// outside its rect and must not immediately close it again. Swept, so
// position-keyed entries from moved popovers don't accumulate.
const popoverWasOpen = sweptCache<boolean>();

/** A floating panel that closes on a click anywhere outside (the click is
 *  swallowed — it can't also activate whatever sits underneath). While open,
 *  the popover is an overlay: every widget drawn BEFORE it in the frame goes
 *  input-dead; widgets drawn after (its contents) work normally. The VALUE
 *  form draws a fixed box (`h` required) you fill yourself; the CHILDREN form
 *  (`popover(opts, () => {...})`) lays widgets out inside and AUTO-SIZES its
 *  height to them (omit `h`). Returns the new open state — assign it back. A
 *  close button inside the closure can't override that return, so set your own
 *  flag: `if (closed) open = false;`.
 *
 *    if (UI.button(trigger)) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover({ x, y, w: 240, h: 120, open: filtersOpen });
 *    if (filtersOpen) { ...toggles/sliders at x/y... }
 *
 *  Or ANCHORED — omit `x`/`y` right after the trigger and it opens under it:
 *
 *    if (UI.button("Filters…")) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover({ w: 240, open: filtersOpen }, () => { ... }); */
export function popover(opts: PopoverOptions): boolean;
export function popover(opts: PopoverOptions, children: () => void): boolean;
export function popover(opts: PopoverOptions, children?: () => void): boolean {
  const ctx = uiCtx();
  ensureWired();
  // Anchored form: no x/y → attach under the last placed widget (the trigger
  // drawn just before this call), flipping above it when the viewport bottom
  // would clip, and clamped inside the viewport horizontally.
  const anchor = opts.x === undefined && opts.y === undefined ? lastWidgetRect() : null;
  const id = opts.id ?? (anchor ? `@${anchor.x}:${anchor.y}` : `${opts.x}:${opts.y}`);
  // Share the one auto-size cache (`containerKey`-style key) — no popover-only
  // height map. The children form auto-sizes height from last frame's measured
  // content; the value form keeps the explicit `h`.
  const key = `popover:${id}`;
  const pad = opts.pad ?? theme.spacing.lg;
  const top = opts.title ? 32 : 0;
  const cached = cachedContentSize(key);
  const w = opts.w ?? (children ? (cached?.w ?? 220) : 0);
  const h = opts.h ?? (children ? (cached?.h ?? 72) : 0);
  let x = opts.x ?? 0;
  let y = opts.y ?? 0;
  if (anchor) {
    const gap = 4;
    ({ x, y } = fitAnchored(
      { x: anchor.x, y: anchor.y + anchor.h + gap, w, h },
      anchor.y - h - gap,
      4,
    ));
  }
  const rect = { x, y, w, h };

  const was = popoverWasOpen.get(id) ?? false;
  let open = opts.open;
  // Raw pointer: while open we're the overlay — uiPointer would be dead.
  // A release that merely ends a scroll gesture or a widget drag (started
  // inside, lifted outside) is not a click-outside close. The raw pointer is
  // in SCREEN coords, but `rect` is in the CURRENT space (reference coords
  // inside a `UI.scaled` block) — map it out before the outside test.
  const p = rawPointer();
  const tl = uiToScreen(rect.x, rect.y);
  const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
  const screenRect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  if (open && was && dismissedByOutsideRelease(p, screenRect)) open = false;
  popoverWasOpen.set(id, open);
  if (!open) return false;

  enterOverlay();
  paintFrame(ctx, {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    title: opts.title,
    bg: opts.bg,
    border: opts.border,
  });
  if (children) {
    const body = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top };
    runAutoSized(
      key,
      rect,
      body,
      "col",
      opts.gap ?? theme.spacing.md,
      pad,
      "start",
      false,
      false,
      children,
    );
  }
  return true;
}

// ---------- Modal ----------

/** A centered dialog over a dimmed backdrop. */
export interface ModalOptions {
  /** Preferred dialog width in px. Clamped inside the viewport. Default 360. */
  w?: number;
  /** Dialog height in px. REQUIRED in the value form; omit it in the children
   *  form and the dialog auto-sizes to its content (measured last frame). */
  h?: number;
  /** Optional title, drawn in the panel's title strip. */
  title?: string;
  /** Stable identity for the auto-size cache (children form). Defaults to the
   *  title; give one when several modals share a title. */
  id?: string;
  /** Body layout axis (children form). Default `"col"`. */
  dir?: "row" | "col";
  /** Gap between children (children form). Default 8. */
  gap?: number;
  /** Inner padding (children form). Default `theme.panel.padding`. */
  pad?: number;
  /** Space kept from every viewport edge while clamping. Default 12. */
  margin?: number;
  /** Close action for the conventional gamepad B / keyboard Escape gesture.
   * Omit for a non-dismissible modal. */
  onDismiss?: () => void;
  /** Fired when a click is RELEASED on the dimmed backdrop rather than on the
   *  dialog — the "click away to close" gesture. Omit and the backdrop simply
   *  swallows clicks, which is right for a dialog that demands an answer.
   *
   *  Separate from `onDismiss` on purpose: this one is caused by a real click,
   *  so it still carries the browser's transient activation. That is the
   *  difference between a handler that may call `requestPointerLock`,
   *  `play()` on an audio element or open a window, and one that may not —
   *  Escape grants no activation, so `onDismiss` cannot do any of it.
   *
   *  A release that began INSIDE the dialog (a slider dragged past its edge,
   *  a scroll gesture) is not a click away and does not fire this, and neither
   *  does the very click that opened the modal. */
  onClickOutside?: () => void;
  /** Show focus on the first enabled control when the modal opens. By default
   * the control is focused logically, but its ring is shown only when a
   * gamepad is active. Set explicitly to override that behavior. */
  showFocus?: boolean;
}

/** Dim the whole screen and open a centered panel. Two forms:
 *
 *  VALUE — returns the panel rect and you draw into it (`h` required):
 *
 *    const r = UI.modal({ w: 340, h: 150, title: "CONFIRM" });
 *    if (UI.button({ x: r.x + 12, y: r.y + 100, label: "OK" })) { ... }
 *
 *  CHILDREN — the dialog is a `panel`, so its contents LAY THEMSELVES OUT and
 *  its height shrink-wraps them (omit `h`). Returns the callback's value:
 *
 *    const hit = UI.modal({ w: 340, title: "CONFIRM" }, () => {
 *      UI.text("Delete this save?");
 *      return UI.row({ justify: "end", gap: 8 }, () => UI.button({ label: "OK" }));
 *    });
 *
 *  While a modal is up, every widget drawn BEFORE it in the frame ignores the
 *  pointer, so clicks can't land through the backdrop; widgets drawn after (the
 *  dialog's own) work normally. Call it LAST in your draw. For the common
 *  title/lines/buttons dialog, `confirm()` does all of this for you.
 *
 *  `onClickOutside` turns the backdrop into a close button; `onDismiss` handles
 *  Escape and gamepad B. They are separate because only the first is caused by
 *  a real click, and so only the first may do the things a browser allows only
 *  from one — see its own note. */
export function modal(opts: ModalOptions): { x: number; y: number; w: number; h: number };
export function modal<R>(opts: ModalOptions, children: LayoutChildren<R>): R;
export function modal<R>(
  opts: ModalOptions,
  children?: LayoutChildren<R>,
): R | { x: number; y: number; w: number; h: number } {
  const ctx = uiCtx();
  ensureWired();
  if (opts.onDismiss && consumeDismissRequest()) opts.onDismiss();
  enterOverlay(opts.showFocus ?? hasActiveNavPad());
  const vp = anchorViewport();
  ctx.save();
  ctx.fillStyle = theme.dim;
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.restore();
  const id = opts.id ?? `modal:${opts.title ?? ""}`;
  if (children) {
    // The dialog IS a panel: centered by the anchor, auto-sized on the axis
    // left unspecified, and laying its children out like any container.
    const margin = opts.margin ?? 12;
    const result = panel(
      {
        anchor: "center",
        w: opts.w ?? 360,
        h: opts.h,
        margin,
        title: opts.title,
        id,
        dir: opts.dir,
        gap: opts.gap,
        pad: opts.pad,
      },
      children,
    );
    // AFTER the panel: an auto-sized dialog does not know its own height until
    // its children have run, and clicking just below a shrink-wrapped dialog
    // must not count as clicking away from it.
    clickAway(opts, id, lastContainerRect());
    return result;
  }
  const h = opts.h ?? 0;
  const margin = opts.margin ?? 12;
  const w = Math.min(opts.w ?? 360, vp.w - margin * 2);
  const clampedH = Math.min(h, vp.h - margin * 2);
  const x = Math.round((vp.w - w) / 2);
  const y = Math.round((vp.h - clampedH) / 2);
  paintFrame(ctx, { x, y, w, h: clampedH, title: opts.title });
  const rect = { x, y, w, h: clampedH };
  clickAway(opts, id, rect);
  return rect;
}

// Whether each modal was up LAST frame. The release that OPENS a modal lands
// on the backdrop of the modal it just opened, and would close it again on the
// same click. Swept, so a modal that stops being drawn drops out by itself.
const modalWasOpen = sweptCache<boolean>();

function clickAway(
  opts: ModalOptions,
  id: string,
  dialog: { x: number; y: number; w: number; h: number } | null,
): void {
  if (!opts.onClickOutside) return;
  const was = modalWasOpen.get(id) ?? false;
  modalWasOpen.set(id, true);
  if (!was || !dialog) return;
  // Raw pointer: the modal IS the overlay, so `uiPointer` is dead everywhere
  // outside the dialog — which is precisely the region being tested. The raw
  // one is in SCREEN coords and `dialog` is in the current space, so map it out
  // before comparing (the dialog may be inside a `UI.scaled` block).
  const tl = uiToScreen(dialog.x, dialog.y);
  const br = uiToScreen(dialog.x + dialog.w, dialog.y + dialog.h);
  const screenRect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  if (dismissedByOutsideRelease(rawPointer(), screenRect)) opts.onClickOutside();
}

// ---------- Confirm (declarative dialog) ----------

/** A whole dialog in one call. */
export interface ConfirmOptions {
  /** Stable prefix for keyboard-focusable action buttons. */
  id?: string;
  /** Dialog title, drawn in the panel's title strip. */
  title?: string;
  /** Body lines. The first is drawn in the primary text color, the rest
   *  dimmed — lead + detail. */
  lines?: string[];
  /** Button labels, left to right (the last one sits at the right edge —
   *  put the primary action last). Default `["OK"]`. */
  buttons?: string[];
  /** Per-button variants, aligned with `buttons`. Omit an entry for the
   *  default look. E.g. `["default", "danger"]` for a Cancel/Delete pair.
   *  When omitted entirely, the LAST button defaults to `"primary"`. */
  variants?: ButtonVariant[];
  /** Minimum dialog width; it grows to fit the content. Default 300. */
  minW?: number;
}

/** The declarative modal: title, body lines and buttons in one call, sized
 *  to its content. Returns the clicked button's label, or `null`:
 *
 *    if (confirming) {
 *      const hit = UI.confirm({
 *        title: "JOIN SERVER",
 *        lines: [server.name, details],
 *        buttons: ["CANCEL", "JOIN"],
 *      });
 *      if (hit === "JOIN") join(server);
 *      if (hit) confirming = null;
 *    } */
export function confirm(text: string): "yes" | "no" | null;
export function confirm(opts: ConfirmOptions): string | null;
export function confirm(optsOrTitle: ConfirmOptions | string): string | null {
  // Question sugar (API_PLAN #47): a yes/no dialog in one call. Draw it every
  // frame the question is open; the answer arrives as the return value.
  if (typeof optsOrTitle === "string") {
    const title = optsOrTitle;
    const hit = confirm({ id: `confirm:${title}`, title, buttons: ["No", "Yes"] });
    return hit === "Yes" ? "yes" : hit === "No" ? "no" : null;
  }
  const opts = optsOrTitle;
  const ctx = uiCtx();
  const lines = opts.lines ?? [];
  const buttons = opts.buttons ?? ["OK"];
  const lineH = theme.fontSize + 8;

  // Width still sizes to content: widest of title, lines, and the button row.
  // (The HEIGHT is the panel's job now — it shrink-wraps what we lay out.)
  ctx.save();
  ctx.font = uiFont(theme.fontSize + 2, true);
  const buttonsW = buttons.reduce((sum, l) => sum + Math.ceil(measureWidth(ctx, l)) + 28 + 8, 0);
  ctx.font = uiFont(theme.fontSize + 1, true);
  const titleW = opts.title ? Math.ceil(measureWidth(ctx, opts.title)) : 0;
  ctx.font = uiFont();
  const lineW = Math.ceil(Math.max(0, ...lines.map((l) => measureWidth(ctx, l))));
  ctx.restore();
  const w = Math.max(opts.minW ?? 300, lineW + 32, buttonsW + 24, titleW + 24);

  // Buttons right-aligned; array order reads left → right. Without explicit
  // variants, the last (rightmost, primary-action) button goes accent.
  const variantFor = (i: number): ButtonVariant =>
    opts.variants?.[i] ?? (i === buttons.length - 1 ? "primary" : "default");
  const idPrefix = opts.id ?? opts.title ?? "confirm";
  return modal({ w, title: opts.title, id: `confirm:${idPrefix}`, gap: 6 }, () => {
    for (const [i, line] of lines.entries()) {
      text(line, { h: lineH, color: i === 0 ? undefined : "dim" });
    }
    let hit: string | null = null;
    row({ justify: "end", gap: 8, h: 34, id: `${idPrefix}:buttons` }, () => {
      for (const [i, label] of buttons.entries()) {
        if (
          button({
            id: `${idPrefix}:button:${i}`,
            tabIndex: i,
            label,
            variant: variantFor(i),
            h: 34,
          })
        ) {
          hit = label;
        }
      }
    });
    return hit;
  });
}

// ---------- Dialogue box ----------

/** Bottom-screen dialogue used by RPGs, adventures, visual novels and tutorial
 * conversations. Rendering is immediate-mode; the game owns conversation state. */
export interface DialogOptions {
  /** Stable prefix for keyboard-focusable choices. */
  id?: string;
  /** Speaker name, drawn in the box's title strip. */
  speaker?: string;
  /** Body text, one entry per line. */
  lines: string[];
  /** Optional response/action labels. Returns the clicked label. */
  choices?: string[];
  /** Box left. Default centers the box horizontally. */
  x?: number;
  /** Box top. Default pins the box near the bottom of the viewport. */
  y?: number;
  /** Box width. Default `min(680, viewport width - 24)`. */
  w?: number;
  /** Box height. Default sizes to the lines (plus choices row). */
  h?: number;
  /** Optional portrait drawn on the left. */
  portrait?: CanvasImageSource;
  /** Portrait square size in px. Default `72`. Ignored without `portrait`. */
  portraitSize?: number;
  /** Small footer hint when there are no explicit choices. */
  hint?: string;
}

/** Draw a themed dialogue box and return the clicked choice, or `null`.
 *
 * ```ts
 * const answer = UI.dialog({
 *   speaker: "BLACKSMITH",
 *   lines: ["The old bridge is unsafe."],
 *   choices: ["REPAIR IT", "LEAVE"],
 * });
 * ``` */
export function dialog(opts: DialogOptions): string | null {
  const ctx = uiCtx();
  const vp = anchorViewport();
  const choices = opts.choices ?? [];
  const portraitSize = opts.portrait ? (opts.portraitSize ?? 72) : 0;
  const lineH = theme.fontSize + 8;
  const choicesH = choices.length ? 42 : 0;
  const h = opts.h ?? Math.max(104, 34 + opts.lines.length * lineH + choicesH + 16);
  const w = opts.w ?? Math.min(680, vp.w - 24);
  const x = opts.x ?? Math.round((vp.w - w) / 2);
  const y = opts.y ?? vp.h - h - 12;
  paintFrame(ctx, { x, y, w, h, title: opts.speaker });

  let textX = x + 14;
  if (opts.portrait) {
    const py = y + (opts.speaker ? 34 : 12);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(opts.portrait, x + 12, py, portraitSize, portraitSize);
    ctx.restore();
    textX += portraitSize + 12;
  }
  let ty = y + (opts.speaker ? 35 : 13);
  for (const line of opts.lines) {
    text(line, {
      x: textX,
      y: ty,
      w: x + w - 14 - textX,
      h: lineH,
      maxWidth: x + w - 14 - textX,
    });
    ty += lineH;
  }

  let hit: string | null = null;
  if (choices.length) {
    const bar = flow({ x: x + w - 12, y: y + h - 44, h: 32, gap: 8, align: "end" });
    for (let i = choices.length - 1; i >= 0; i--) {
      if (
        button({
          id: `${opts.id ?? opts.speaker ?? "dialog"}:choice:${i}`,
          tabIndex: i,
          at: bar,
          label: choices[i],
          variant: i === 0 ? "primary" : "default",
          h: 32,
        })
      ) {
        hit = choices[i];
      }
    }
  } else if (opts.hint) {
    text(opts.hint, {
      x: x + 12,
      y: y + h - 28,
      w: w - 24,
      h: 18,
      align: "right",
      color: "dim",
    });
  }
  return hit;
}
