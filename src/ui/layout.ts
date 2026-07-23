import { panel } from "./controls.js";
import {
  LayoutChildren,
  LayoutOptions,
  containerRect,
  currentLayout,
  layoutArgs,
  roundRectPath,
  runContainer,
  theme,
  uiCtx,
} from "./core/index.js";

/** Lay children out left-to-right. Root call needs an explicit rect; nested
 *  calls reserve a slot from the enclosing container (full parent height, a
 *  declared width, or `h` as the row's own height in a column parent). The
 *  callback receives the cursor and returns whatever you return — a nested
 *  button's `clicked` bubbles straight out:
 *
 *    UI.row(() => {
 *      if (UI.button({ label: "Play" })) start();   // auto-flows, auto-width
 *      UI.button({ label: "Options" });
 *    }); */
export function row<R>(children: LayoutChildren<R>): R;
export function row<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
export function row<R>(a: LayoutOptions | LayoutChildren<R>, b?: LayoutChildren<R>): R {
  const [opts, children] = layoutArgs(a, b);
  const rect = containerRect("row", opts);
  return runContainer("row", rect, opts.gap ?? 8, opts.pad ?? 0, opts.align ?? "start", children);
}

/** Lay children out top-to-bottom. See `row`. */
export function col<R>(children: LayoutChildren<R>): R;
export function col<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
export function col<R>(a: LayoutOptions | LayoutChildren<R>, b?: LayoutChildren<R>): R {
  const [opts, children] = layoutArgs(a, b);
  const rect = containerRect("col", opts);
  return runContainer("col", rect, opts.gap ?? 8, opts.pad ?? 0, opts.align ?? "start", children);
}

/** A `group` is a bordered/optionally-titled box that also lays its children
 *  out (a column by default). Combines `panel` + `col` in one call. */
export interface GroupOptions extends LayoutOptions {
  /** Optional title, drawn in the panel's title strip. */
  title?: string;
  /** Body layout axis. Default `"col"`. */
  dir?: "row" | "col";
  /** Panel fill color — passes through to `panel`. */
  bg?: string;
  /** Panel border color — passes through to `panel`. */
  border?: string;
}

/** Draw a `panel` and lay its children out inside the body — a `col` by
 *  default, or a `row` via `dir`. `title`/`bg`/`border` pass through to the
 *  panel; the body is inset below the title strip and padded by `theme.pad`. */
export function group<R>(opts: GroupOptions, children: LayoutChildren<R>): R {
  const dir = opts.dir ?? "col";
  const rect = containerRect(dir, opts);
  panel({
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    title: opts.title,
    bg: opts.bg,
    border: opts.border,
  });
  // The title strip is 2px top border + 30px band = 32px. Reserve a matching
  // 2px below for the bottom border so body content centers in the visible gap
  // under the strip, not biased low by the unaccounted-for bottom border.
  const top = opts.title ? 32 : 0;
  const body = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top - (opts.title ? 2 : 0) };
  return runContainer(
    dir,
    body,
    opts.gap ?? 8,
    opts.pad ?? theme.pad,
    opts.align ?? "start",
    children,
  );
}

/** Insert extra spacing before the next child in the current layout. */
export function spacer(px: number): void {
  currentLayout()?.gap(px);
}

/** Clip drawing to `rect` for the duration of `children` — for scrollable
 *  lists and masked regions, so a screen never hand-rolls save/clip/restore.
 *  Returns the callback's value. */
export function clip<R>(
  rect: { x: number; y: number; w: number; h: number },
  children: () => R,
): R {
  const ctx = uiCtx();
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 0);
  ctx.clip();
  try {
    return children();
  } finally {
    ctx.restore();
  }
}
