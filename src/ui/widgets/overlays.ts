import { ButtonVariant, button } from "./button.js";
import { PanelFrame, paintFrame } from "./panel.js";
import {
  cachedContentSize,
  centeredText,
  enterOverlay,
  ensureWired,
  rawPointer,
  runAutoSized,
  flow,
  text,
  theme,
  uiCtx,
  uiFont,
  withCtx,
} from "../core/index.js";
import { pointInRect } from "../../collision.js";
import { Stage } from "../../engine/index.js";

// ---------- Popover ----------

/** An anchored floating panel (dropdown, filter flyout). */
export interface PopoverOptions extends Omit<PanelFrame, "h"> {
  /** Open state — pass yours in, assign the return value back. */
  open: boolean;
  /** Identity across frames. Defaults to the position. */
  id?: string;
  /** Explicit height. OMIT when using the `children` form — the box then
   *  AUTO-SIZES to its content (measured last frame, à la `group`). */
  h?: number;
  /** Gap between children (children form). Default 8. */
  gap?: number;
  /** Inner padding (children form). Default 12. */
  pad?: number;
}

// Whether each popover was open LAST frame — the click that opens one lands
// outside its rect and must not immediately close it again.
const popoverWasOpen = new Map<string, boolean>();

/** Draw a popover panel while open; a click anywhere outside closes it (and
 *  is swallowed — it can't also activate whatever sits underneath). While
 *  open, the popover is an overlay: every widget drawn BEFORE it in the
 *  frame goes input-dead; widgets drawn after (its contents) work normally.
 *  Returns the new open state:
 *
 *    if (UI.button(trigger)) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover({ x, y, w: 240, h: 120, open: filtersOpen });
 *    if (filtersOpen) { ...toggles/sliders at x/y... } */
/** A floating panel that closes on an outside click. The VALUE form draws a
 *  fixed box (`h` required) you fill yourself; the CHILDREN form
 *  (`popover(opts, () => {...})`) lays widgets out inside and AUTO-SIZES its
 *  height to them (omit `h`). Returns the open state — assign it back. A close
 *  button inside the closure can't override that return, so set your own flag:
 *  `if (closed) open = false;`. */
export function popover(opts: PopoverOptions): boolean;
export function popover(ctx: CanvasRenderingContext2D, opts: PopoverOptions): boolean;
export function popover(opts: PopoverOptions, children: () => void): boolean;
export function popover(
  ctx: CanvasRenderingContext2D,
  opts: PopoverOptions,
  children: () => void,
): boolean;
export function popover(
  ctxOrOpts: CanvasRenderingContext2D | PopoverOptions,
  optsOrChildren?: PopoverOptions | (() => void),
  maybeChildren?: () => void,
): boolean {
  const firstIsCtx = typeof (ctxOrOpts as CanvasRenderingContext2D)?.fillRect === "function";
  const ctx = firstIsCtx ? (ctxOrOpts as CanvasRenderingContext2D) : uiCtx();
  const opts = (firstIsCtx ? optsOrChildren : ctxOrOpts) as PopoverOptions;
  const children = (firstIsCtx ? maybeChildren : (optsOrChildren as (() => void) | undefined)) as
    | (() => void)
    | undefined;
  ensureWired();
  const id = opts.id ?? `${opts.x}:${opts.y}`;
  // Share the one auto-size cache (`containerKey`-style key) — no popover-only
  // height map. The children form auto-sizes height from last frame's measured
  // content; the value form keeps the explicit `h`.
  const key = `popover:${id}`;
  const pad = opts.pad ?? 12;
  const top = opts.title ? 32 : 0;
  const h = opts.h ?? (children ? (cachedContentSize(key)?.h ?? 72) : 0);
  const rect = { x: opts.x, y: opts.y, w: opts.w, h };

  const was = popoverWasOpen.get(id) ?? false;
  let open = opts.open;
  // Raw pointer: while open we're the overlay — uiPointer would be dead.
  const p = rawPointer();
  if (open && was && p.released && !pointInRect(p.x, p.y, rect)) open = false;
  popoverWasOpen.set(id, open);
  if (!open) return false;

  enterOverlay();
  paintFrame(ctx, {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: rect.h,
    title: opts.title,
    bg: opts.bg,
    border: opts.border,
  });
  if (children) {
    const body = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top };
    runAutoSized(key, rect, body, "col", opts.gap ?? 8, pad, "start", false, false, children);
  }
  return true;
}

// ---------- Modal ----------

/** A centered dialog over a dimmed backdrop. */
export interface ModalOptions {
  /** Dialog width in px. */
  w: number;
  /** Dialog height in px. */
  h: number;
  /** Optional title, drawn in the panel's title strip. */
  title?: string;
}

/** Dim the whole screen and open a centered panel. Returns the panel rect —
 *  draw the dialog contents (text, buttons) inside it after the call. While
 *  a modal is up, every widget drawn BEFORE it in the frame ignores the
 *  pointer, so clicks can't land through the backdrop; widgets drawn after
 *  (the dialog's own) work normally. Call it LAST in your draw. For the
 *  common title/lines/buttons dialog, `confirm()` does all of this for you:
 *
 *    if (confirming) {
 *      const r = UI.modal({ w: 340, h: 150, title: "CONFIRM" });
 *      if (UI.button({ x: r.x + 12, ... label: "OK" })) { ... }
 *    } */
export function modal(opts: ModalOptions): { x: number; y: number; w: number; h: number };
export function modal(
  ctx: CanvasRenderingContext2D,
  opts: ModalOptions,
): { x: number; y: number; w: number; h: number };
export function modal(
  ctxOrOpts: CanvasRenderingContext2D | ModalOptions,
  maybeOpts?: ModalOptions,
): { x: number; y: number; w: number; h: number } {
  const [ctx, opts] = withCtx(ctxOrOpts, maybeOpts);
  ensureWired();
  enterOverlay();
  const vp = Stage.viewport;
  ctx.save();
  ctx.fillStyle = theme.dim;
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.restore();
  const x = Math.round((vp.w - opts.w) / 2);
  const y = Math.round((vp.h - opts.h) / 2);
  paintFrame(ctx, { x, y, w: opts.w, h: opts.h, title: opts.title });
  return { x, y, w: opts.w, h: opts.h };
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
export function confirm(ctx: CanvasRenderingContext2D, opts: ConfirmOptions): string | null;
export function confirm(
  ctxOrOptsOrTitle: CanvasRenderingContext2D | ConfirmOptions | string,
  maybeOpts?: ConfirmOptions,
): string | null {
  // Question sugar (API_PLAN #47): a yes/no dialog in one call. Draw it every
  // frame the question is open; the answer arrives as the return value.
  if (typeof ctxOrOptsOrTitle === "string") {
    const title = ctxOrOptsOrTitle;
    const hit = confirm({ id: `confirm:${title}`, title, buttons: ["No", "Yes"] });
    return hit === "Yes" ? "yes" : hit === "No" ? "no" : null;
  }
  const [ctx, opts] = withCtx(ctxOrOptsOrTitle, maybeOpts);
  const lines = opts.lines ?? [];
  const buttons = opts.buttons ?? ["OK"];
  const lineH = theme.fontSize + 8;

  // Size to content: widest of title, lines, and the button row.
  ctx.save();
  ctx.font = uiFont(theme.fontSize + 2, true);
  const buttonsW = buttons.reduce(
    (sum, l) => sum + Math.ceil(ctx.measureText(l).width) + 28 + 8,
    0,
  );
  ctx.font = uiFont(theme.fontSize + 1, true);
  const titleW = opts.title ? Math.ceil(ctx.measureText(opts.title).width) : 0;
  ctx.font = uiFont();
  const lineW = Math.ceil(Math.max(0, ...lines.map((l) => ctx.measureText(l).width)));
  ctx.restore();
  const w = Math.max(opts.minW ?? 300, lineW + 32, buttonsW + 24, titleW + 24);
  const h = (opts.title ? 30 : 0) + 16 + lines.length * lineH + 16 + 34 + 12;

  const r = modal(ctx, { w, h, title: opts.title });

  ctx.save();
  ctx.font = uiFont();
  ctx.textAlign = "left";
  let ty = r.y + (opts.title ? 30 : 0) + 16 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? theme.text : theme.textDim;
    centeredText(ctx, line, r.x + 16, ty);
    ty += lineH;
  });
  ctx.restore();

  // Buttons right-aligned; array order reads left → right. Without explicit
  // variants, the last (rightmost, primary-action) button goes accent.
  const variantFor = (i: number): ButtonVariant =>
    opts.variants?.[i] ?? (i === buttons.length - 1 ? "primary" : "default");
  const btnBar = flow({ x: r.x + r.w - 12, y: r.y + r.h - 46, gap: 8, h: 34, align: "end" });
  let hit: string | null = null;
  for (let i = buttons.length - 1; i >= 0; i--) {
    if (
      button(ctx, {
        id: `${opts.id ?? opts.title ?? "confirm"}:button:${i}`,
        tabIndex: i,
        at: btnBar,
        label: buttons[i],
        variant: variantFor(i),
        h: 34,
      })
    ) {
      hit = buttons[i];
    }
  }
  return hit;
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
export function dialog(opts: DialogOptions): string | null;
export function dialog(ctx: CanvasRenderingContext2D, opts: DialogOptions): string | null;
export function dialog(
  ctxOrOpts: CanvasRenderingContext2D | DialogOptions,
  maybeOpts?: DialogOptions,
): string | null {
  const [ctx, opts] = withCtx(ctxOrOpts, maybeOpts);
  const vp = Stage.viewport;
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
    text(ctx, line, {
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
        button(ctx, {
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
    text(ctx, opts.hint, {
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
