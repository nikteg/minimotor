import { paintFrame } from "./panel.js";
import {
  AutoContainerConfig,
  LayoutChildren,
  LayoutOptions,
  autoContainer,
  cachedContentSize,
  containerKey,
  containerRect,
  currentLayout,
  getBaseSize,
  getUiScaleSetting,
  layoutArgs,
  popPointerClip,
  popUiTransform,
  pushPointerClip,
  pushUiTransform,
  roundRectPath,
  runAutoSized,
  storeContentSize,
  theme,
  uiCtx,
  uiHeight,
  uiPointer,
  uiWidth,
} from "../core/index.js";
import { scrollbar } from "./lists.js";
import { pointInRect } from "../../collision.js";
import { Stage } from "../../engine/index.js";
import { clamp } from "../../mathf.js";

// Persisted scroll offset + a scrollbar fade alpha per scrolling container,
// keyed by its scrollbar id.
const scrollOffsets = new Map<string, number>();
const scrollAlphas = new Map<string, number>();

/** The `overflow: auto/scroll/hidden` path for the containers: a box bounded on
 *  its scroll axis (a `col` scrolls vertically, a `row` horizontally) whose body
 *  is clipped and scrolled. The bound is `h`/`w` if given, else the room to the
 *  viewport edge, capped to the content. Reuses `runAutoSized` for layout +
 *  measurement, then `scrollbar` (vertical or horizontal) for wheel/thumb/track.
 *  A titled box keeps its title (drawn by `cfg.box`) fixed and scrolls the body. */
function scrollable<R>(
  kind: string,
  dir: "row" | "col",
  opts: LayoutOptions,
  cfg: AutoContainerConfig,
  children: LayoutChildren<R>,
): R {
  // Scroll axis follows the stack direction: a `col` overflows/scrolls
  // vertically, a `row` horizontally. "main" = scroll axis, "cross" = the other.
  const horiz = dir === "row";
  const key = containerKey(opts, kind);
  const bodyKey = key ? `${key}:body` : undefined;
  const top = cfg.top ?? 0;
  const bottom = cfg.bottom ?? 0;
  const clipOnly = opts.overflow === "hidden";
  // Content extent measured last frame. The MAIN (scroll) axis is bounded
  // (explicit size, else the room to the viewport edge, capped to content); the
  // CROSS axis shrink-wraps to the content PLUS the scrollbar gutter. The cross
  // is measured intrinsically (children take their natural cross size — see the
  // `horiz` fitCross below) so it never feeds back on the clip height/width.
  const body = cachedContentSize(bodyKey);
  const cachedBox = cachedContentSize(key);
  const contentMain = horiz ? body?.w : body?.h;
  const contentCross = horiz ? body?.h : body?.w;
  const naturalMain = (horiz ? 0 : top + bottom) + (contentMain ?? 0);
  const avail = horiz
    ? Math.max(60, Stage.viewport.w - (opts.x ?? 0) - 12)
    : Math.max(60, Stage.viewport.h - (opts.y ?? 0) - 12);
  // Main-axis (scroll) bound. Explicit `w` (row) / `h` (col) wins; otherwise a
  // NESTED region fills its parent slot (its real size is only known after
  // `containerRect`, so `estMain` — last frame's box — stands in for this
  // frame's gutter/cross math), and a ROOT one takes the room to the viewport
  // edge capped to content.
  const explicitMain = horiz ? opts.w : opts.h;
  const fitMain =
    contentMain === undefined ? avail : clipOnly ? naturalMain : Math.min(naturalMain, avail);
  const estMain = explicitMain ?? (horiz ? cachedBox?.w : cachedBox?.h) ?? fitMain;
  const estView = horiz ? estMain : estMain - top - bottom;
  const barThick = !clipOnly && (contentMain ?? estView) - estView > 0.5 ? 10 : 0;
  const gutter = barThick ? barThick + 4 : 0; // room reserved for the bar

  // Cross box size = intrinsic content cross + title band + gutter. Explicit
  // `w` (vertical) / `h` (horizontal) wins, so a vertical column keeps its
  // declared width and never derives it from content.
  const naturalCross = (horiz ? top + bottom : 0) + (contentCross ?? 0) + gutter;
  const boxCross =
    (horiz ? opts.h : opts.w) ?? (contentCross !== undefined ? naturalCross : undefined);
  // Main size for the box: explicit, else `undefined` so a nested parent fills
  // it (a root falls back to the fit estimate).
  const mainForRect = explicitMain ?? (isRootContainer(opts) ? fitMain : undefined);
  const rect = containerRect(
    dir,
    horiz ? { ...opts, w: mainForRect, h: boxCross } : { ...opts, w: boxCross, h: mainForRect },
    cachedBox,
  );
  cfg.box?.(rect);
  storeContentSize(key, { w: rect.w, h: rect.h, ew: rect.w, eh: rect.h });

  // The bar sits on the CROSS edge (right for vertical, bottom for horizontal)
  // and steals from the cross extent, never from the scroll axis. `viewMain` is
  // the real visible scroll length, taken from the reserved box.
  const bodyRect = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top - bottom };
  const viewMain = horiz ? bodyRect.w : bodyRect.h;
  const contentVal = contentMain ?? viewMain;
  const max = clipOnly ? 0 : Math.max(0, contentVal - viewMain);
  const innerW = horiz ? bodyRect.w : bodyRect.w - gutter;
  const innerH = horiz ? bodyRect.h - gutter : bodyRect.h;
  const sbId = `${key ?? `scroll@${rect.x}:${rect.y}`}:sb`;
  let offset = clamp(scrollOffsets.get(sbId) ?? 0, 0, max);

  // Fade the scrollbar to full while the pointer is inside the region and back
  // to a faint resting level when it leaves (so there's always a hint that the
  // area scrolls). The offset math runs at any alpha, so a faded bar stays
  // usable. No overflow → fully hidden.
  const FAINT = 0.28;
  const p = uiPointer();
  const prevAlpha = scrollAlphas.get(sbId) ?? 0;
  const target = max <= 0 ? 0 : pointInRect(p.x, p.y, bodyRect) ? 1 : FAINT;
  const alpha = prevAlpha + (target - prevAlpha) * 0.2;
  scrollAlphas.set(sbId, alpha < 0.01 ? 0 : alpha);

  const originX = bodyRect.x - (horiz ? offset : 0);
  const originY = bodyRect.y - (horiz ? 0 : offset);
  let result!: R;
  clip({ x: bodyRect.x, y: bodyRect.y, w: innerW, h: innerH }, () => {
    result = runAutoSized(
      bodyKey,
      { x: originX, y: originY },
      { x: originX, y: originY, w: horiz ? contentVal : innerW, h: horiz ? innerH : contentVal },
      dir,
      cfg.gap,
      cfg.pad,
      cfg.justify,
      cfg.reverse,
      // Horizontal: children take natural HEIGHT (intrinsic cross) so the box
      // height is stable. Vertical: they fill the WIDTH as usual.
      horiz,
      children,
    );
  });
  if (barThick) {
    offset = scrollbar({
      x: horiz ? bodyRect.x : rect.x + rect.w - barThick,
      y: horiz ? rect.y + rect.h - barThick : bodyRect.y,
      w: horiz ? bodyRect.w : barThick,
      h: horiz ? barThick : bodyRect.h,
      axis: horiz ? "x" : "y",
      view: viewMain,
      content: contentVal,
      offset,
      wheelArea: bodyRect,
      id: sbId,
      opacity: alpha,
    });
  }
  scrollOffsets.set(sbId, offset);
  return result;
}

// A ROOT container (pinned x/y) shrink-wraps any axis the caller omits; the
// cross axis (a col's width, a row's height) is shrink-wrapped via `fitCross`
// so children take their natural cross size instead of filling.
const isRootContainer = (opts: LayoutOptions): boolean =>
  opts.x !== undefined && opts.y !== undefined;

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
export function row<R>(
  optsOrChildren: LayoutOptions | LayoutChildren<R>,
  maybeChildren?: LayoutChildren<R>,
): R {
  const [opts, children] = layoutArgs(optsOrChildren, maybeChildren);
  const wrap = opts.wrap ?? false;
  // a row's cross is height; wrapping children take their natural height so lines
  // measure correctly.
  const fitCross = wrap || (isRootContainer(opts) && opts.h === undefined);
  const cfg = {
    pad: opts.pad ?? 0,
    gap: opts.gap ?? 8,
    justify: opts.justify ?? "start",
    reverse: opts.reverse ?? false,
    fitCross,
    wrap,
  };
  if (opts.overflow && opts.overflow !== "visible")
    return scrollable("row", "row", opts, cfg, children);
  return autoContainer("row", "row", opts, cfg, children);
}

/** Lay children out top-to-bottom. See `row`. */
export function col<R>(children: LayoutChildren<R>): R;
export function col<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
export function col<R>(
  optsOrChildren: LayoutOptions | LayoutChildren<R>,
  maybeChildren?: LayoutChildren<R>,
): R {
  const [opts, children] = layoutArgs(optsOrChildren, maybeChildren);
  const wrap = opts.wrap ?? false;
  // a col's cross is width; wrapping children take their natural width.
  const fitCross = wrap || (isRootContainer(opts) && opts.w === undefined);
  const cfg = {
    pad: opts.pad ?? 0,
    gap: opts.gap ?? 8,
    justify: opts.justify ?? "start",
    reverse: opts.reverse ?? false,
    fitCross,
    wrap,
  };
  if (opts.overflow && opts.overflow !== "visible")
    return scrollable("col", "col", opts, cfg, children);
  return autoContainer("col", "col", opts, cfg, children);
}

/** A bordered/optionally-titled box that also LAYS OUT its children (a column by
 *  default, a row via `dir`) — the framed container. */
export interface PanelOptions extends LayoutOptions {
  /** Optional title, drawn in the frame's title strip. */
  title?: string;
  /** Body layout axis. Default `"col"`. */
  dir?: "row" | "col";
  /** Frame fill color. Default `theme.panelBg`. */
  bg?: string;
  /** Frame border color. Default `theme.border`. */
  border?: string;
}

/** A framed, optionally-titled box that lays its children out — the workhorse
 *  container for menus, dialogs and HUD clusters (`panel` + `col`/`row` in one).
 *  The body is inset below the title strip and padded by `theme.pad`; a bare
 *  frame is just `UI.panel(opts, () => {})` positioning content absolutely
 *  inside. `title`/`bg`/`border` style the frame; the rest is `LayoutOptions`
 *  (`justify`/`anchor`/`overflow`/`dir`/nesting):
 *
 *    UI.panel({ anchor: "center", w: 260, title: "PAUSED" }, () => {
 *      if (UI.button({ label: "Resume" })) resume();
 *    }); */
export function panel<R>(opts: PanelOptions, children: LayoutChildren<R>): R {
  const dir = opts.dir ?? "col";
  const fitCross =
    isRootContainer(opts) && (dir === "col" ? opts.w === undefined : opts.h === undefined);
  // The title strip is 2px top border + 30px band = 32px. Reserve a matching
  // 2px below for the bottom border so body content centers in the visible gap
  // under the strip, not biased low by the unaccounted-for bottom border.
  const cfg: AutoContainerConfig = {
    pad: opts.pad ?? theme.pad,
    gap: opts.gap ?? 8,
    justify: opts.justify ?? "start",
    reverse: opts.reverse ?? false,
    fitCross,
    top: opts.title ? 32 : 0,
    bottom: opts.title ? 2 : 0,
    box: (rect) =>
      paintFrame(uiCtx(), {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        title: opts.title,
        bg: opts.bg,
        border: opts.border,
      }),
  };
  // With overflow the frame + title stay fixed and only the body scrolls.
  if (opts.overflow && opts.overflow !== "visible")
    return scrollable("panel", dir, opts, cfg, children);
  return autoContainer("panel", dir, opts, cfg, children);
}

/** Insert extra spacing before the next child in the current layout. */
export function spacer(px: number): void {
  currentLayout()?.gap(px);
}

/** Clip drawing to `rect` for the duration of `children` — for scrollable
 *  lists and masked regions, so a screen never hand-rolls save/clip/restore.
 *  Also gates the pointer to `rect`, so a widget clipped out of view (e.g.
 *  scrolled past a region's edge) can't be clicked through the empty space it
 *  was drawn into. Returns the callback's value. */
export function clip<R>(
  rect: { x: number; y: number; w: number; h: number },
  children: () => R,
): R {
  const ctx = uiCtx();
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 0);
  ctx.clip();
  pushPointerClip(rect);
  try {
    return children();
  } finally {
    popPointerClip();
    ctx.restore();
  }
}

/** Options for the fit form of `scaled`: a reference size the UI is laid out in,
 *  uniformly scaled and positioned to fit the current UI space. */
export interface ScaledOptions {
  /** Reference width — position/size widgets as if the space were this wide. */
  w: number;
  /** Reference height (see `w`). */
  h: number;
  /** Extra multiplier on the fit scale — a UI-scale knob (accessibility /
   *  preference). Default 1. */
  scale?: number;
  /** Where the scaled box sits. Default "center"; "top-left" pins it to origin. */
  align?: "center" | "top-left";
}

// Scale by a raw factor around the top-left origin.
function scaledByFactor<R>(factor: number, children: () => R): R {
  const ctx = uiCtx();
  ctx.save();
  ctx.scale(factor, factor);
  pushUiTransform(factor, 0, 0, uiWidth() / factor, uiHeight() / factor);
  try {
    return children();
  } finally {
    popUiTransform();
    ctx.restore();
  }
}

// Fit a w×h reference box (uniform scale + align) into the current UI space.
function scaledToFit<R>(
  w: number,
  h: number,
  scaleMult: number,
  align: "center" | "top-left",
  children: () => R,
): R {
  const availW = uiWidth();
  const availH = uiHeight();
  const fit = Math.min(availW / w, availH / h) * scaleMult;
  const ox = align === "top-left" ? 0 : (availW - w * fit) / 2;
  const oy = align === "top-left" ? 0 : (availH - h * fit) / 2;
  const ctx = uiCtx();
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(fit, fit);
  pushUiTransform(fit, ox, oy, w, h);
  try {
    return children();
  } finally {
    popUiTransform();
    ctx.restore();
  }
}

/** Scale a UI region — the draw AND the pointer, so hit-testing stays correct;
 *  nests; returns the callback's value. Three forms:
 *  - `UI.scaled(() => …)` — fit the global reference size (`UI.setBaseSize`) into
 *    the viewport, times `UI.setScale`. A no-op until a base size is set.
 *  - `UI.scaled({ w, h, scale?, align? }, () => …)` — fit an explicit w×h
 *    reference box (forces the aspect ratio, keeps sizing consistent).
 *  - `UI.scaled(factor, () => …)` — a raw uniform multiplier.
 *  Inside, lay out with `row`/`col`/absolute coords in reference units; read the
 *  space with `UI.width`/`UI.height`.
 *
 *    UI.setBaseSize({ w: 1280, h: 720 });     // once
 *    UI.scaled(() => { if (UI.button({ x: 40, y: 40, label: "PLAY" })) start(); }); */
export function scaled<R>(children: () => R): R;
export function scaled<R>(factor: number, children: () => R): R;
export function scaled<R>(opts: ScaledOptions, children: () => R): R;
export function scaled<R>(
  factorOrOptsOrBody: number | ScaledOptions | (() => R),
  maybeChildren?: () => R,
): R {
  if (typeof factorOrOptsOrBody === "function") {
    // No-arg form: fit the global reference size (if any) times the global scale.
    const base = getBaseSize();
    if (!base) return factorOrOptsOrBody();
    return scaledToFit(base.w, base.h, getUiScaleSetting(), "center", factorOrOptsOrBody);
  }
  const children = maybeChildren as () => R;
  if (typeof factorOrOptsOrBody === "number") return scaledByFactor(factorOrOptsOrBody, children);
  const opts = factorOrOptsOrBody;
  return scaledToFit(opts.w, opts.h, opts.scale ?? 1, opts.align ?? "center", children);
}
