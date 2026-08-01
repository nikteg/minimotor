import { paintFrame, panelTitleBodyOffset } from "./panel.js";
import {
  AutoContainerConfig,
  LayoutChildren,
  LayoutOptions,
  autoContainer,
  cachedContentSize,
  containerKey,
  containerRect,
  currentLayout,
  currentUiScale,
  focusReveal,
  getBaseSize,
  getUiScaleSetting,
  layoutArgs,
  layoutCaptureActive,
  popLayoutParent,
  pushLayoutParent,
  recordLayout,
  popPointerClip,
  popUiTransform,
  pushPointerClip,
  pushUiTransform,
  roundRectPath,
  runAutoSized,
  storeContentSize,
  sweptCache,
  theme,
  uiCtx,
  uiHeight,
  uiPointer,
  uiToScreen,
  uiWidth,
  withTheme,
} from "@src/ui/core/index.js";
import { dragScroll, scrollbar, scrollbarFade, wheelScroll } from "./lists.js";
import { anchorViewport } from "@src/ui/core/index.js";
import { pointInRect } from "@src/collision/index.js";
import { clamp } from "@src/math/mathf.js";

// Persisted scroll offset per scrolling container, keyed by its scrollbar id.
// Swept, so position-keyed entries from containers that move or stop being
// drawn age out instead of accumulating. (The bar's fade alpha is kept next to
// `scrollbar` itself — every scroll region fades through `scrollbarFade`.)
const scrollOffsets = sweptCache<number>();
// The focus-reveal epoch each region last scrolled for — so one Tab produces
// one scroll, and the user can wheel away afterwards without being dragged back.
const revealSeen = sweptCache<number>();

/** How far this scroll region must move to bring the keyboard-focused widget
 *  into `bodyRect` (0 when it's already visible, nothing is focused, or this
 *  region already handled the current focus move). Both rects are compared in
 *  SCREEN coords — the focus registry stores them that way, so it works the
 *  same inside a `UI.scaled` block — and the result is converted back into the
 *  region's own units. */
function revealOffset(
  sbId: string,
  bodyRect: { x: number; y: number; w: number; h: number },
  horiz: boolean,
): number {
  const reveal = focusReveal(revealSeen.get(sbId) ?? -1);
  if (!reveal) return 0;
  const scale = currentUiScale();
  const tl = uiToScreen(bodyRect.x, bodyRect.y);
  const view = {
    near: horiz ? tl.x : tl.y,
    far: (horiz ? tl.x : tl.y) + (horiz ? bodyRect.w : bodyRect.h) * scale,
  };
  const near = horiz ? reveal.rect.x : reveal.rect.y;
  const far = near + (horiz ? reveal.rect.w : reveal.rect.h);
  // Outside the region entirely (a widget in some other container) — not ours
  // to reveal. The cross axis is the cheap test for that.
  const crossNear = horiz ? reveal.rect.y : reveal.rect.x;
  const crossTl = horiz ? tl.y : tl.x;
  const crossSize = (horiz ? bodyRect.h : bodyRect.w) * scale;
  if (crossNear + (horiz ? reveal.rect.h : reveal.rect.w) < crossTl) return 0;
  if (crossNear > crossTl + crossSize) return 0;
  // Nudge by the smaller edge overshoot, with a little breathing room, and
  // claim the epoch so this doesn't repeat while the focus stays put.
  const PAD = 8 * scale;
  let delta = 0;
  if (near < view.near + PAD) delta = near - view.near - PAD;
  else if (far > view.far - PAD) delta = Math.min(far - view.far + PAD, near - view.near - PAD);
  if (delta === 0) {
    revealSeen.set(sbId, reveal.epoch); // already visible — nothing owed
    return 0;
  }
  revealSeen.set(sbId, reveal.epoch);
  return delta / scale;
}

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
  const vp = anchorViewport();
  const avail = horiz
    ? Math.max(60, vp.w - (opts.x ?? 0) - 12)
    : Math.max(60, vp.h - (opts.y ?? 0) - 12);
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
  // `clips`: this region masks its children, so content extending past the box
  // is the point, not a layout fault (see `layoutIssues`).
  if (layoutCaptureActive) recordLayout(kind, opts.id, rect, { clips: true });
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

  // Swipe / body-drag runs BEFORE the children (so the offset applies to this
  // frame's draw and the press-claim beats child widgets). On the press frame
  // the innermost region overwrites the claim, so a swipe inside a nested region
  // scrolls that region. (Wheel is handled AFTER the children — see below — so a
  // nested region claims it first: inner-first chaining.)
  offset = dragScroll(
    sbId,
    { x: bodyRect.x, y: bodyRect.y, w: innerW, h: innerH },
    horiz ? "x" : "y",
    offset,
    max,
  );

  // The pointer at the REGION'S ENTRY — `wheelScroll` below needs this read, not
  // a fresh one (see its doc).
  const p = uiPointer();

  // The offset math runs at any alpha, so a faded bar stays usable.
  const alpha = scrollbarFade(sbId, pointInRect(p.x, p.y, bodyRect), max > 0);

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

  offset = wheelScroll(p, bodyRect, offset, max);

  // Follow the keyboard: Tab can move focus to a widget scrolled out of sight,
  // and a focus ring nobody can see is a dead end. The children have drawn by
  // now, so the focused widget's rect is known — scroll just far enough to put
  // it inside the visible body. Also runs after the children so a NESTED region
  // reveals first and the outer one then reveals the (already-adjusted) inner
  // region. The new offset lands next frame; only pointer focus is ignored
  // (clicking a widget proves it was already visible).
  offset = clamp(offset + revealOffset(sbId, bodyRect, horiz), 0, max);

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
  return withTheme(opts.theme, () => {
    const wrap = opts.wrap ?? false;
    // a row's cross is height; wrapping children take their natural height so lines
    // measure correctly.
    const fitCross = wrap || (isRootContainer(opts) && opts.h === undefined);
    const cfg = {
      pad: opts.pad ?? 0,
      gap: opts.gap ?? theme.spacing.md,
      justify: opts.justify ?? "start",
      reverse: opts.reverse ?? false,
      fitCross,
      wrap,
    };
    if (opts.overflow && opts.overflow !== "visible")
      return scrollable("row", "row", opts, cfg, children);
    return autoContainer("row", "row", opts, cfg, children);
  });
}

/** Lay children out top-to-bottom. See `row`. */
export function col<R>(children: LayoutChildren<R>): R;
export function col<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
export function col<R>(
  optsOrChildren: LayoutOptions | LayoutChildren<R>,
  maybeChildren?: LayoutChildren<R>,
): R {
  const [opts, children] = layoutArgs(optsOrChildren, maybeChildren);
  return withTheme(opts.theme, () => {
    const wrap = opts.wrap ?? false;
    // a col's cross is width; wrapping children take their natural width.
    const fitCross = wrap || (isRootContainer(opts) && opts.w === undefined);
    const cfg = {
      pad: opts.pad ?? 0,
      gap: opts.gap ?? theme.spacing.md,
      justify: opts.justify ?? "start",
      reverse: opts.reverse ?? false,
      fitCross,
      wrap,
    };
    if (opts.overflow && opts.overflow !== "visible")
      return scrollable("col", "col", opts, cfg, children);
    return autoContainer("col", "col", opts, cfg, children);
  });
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

/** Keep an explicitly sized titled pixel panel from placing its first standard
 *  control inside the skin's fixed bottom edge. Auto-sized panels already get
 *  this space from their measured children. */
function panelWithSafeMinimumHeight(opts: PanelOptions): PanelOptions {
  const frameBottom = theme.skin?.frames.panel?.insets.bottom ?? 0;
  if (!opts.title || !frameBottom) return opts;
  const padY = typeof opts.pad === "number" ? opts.pad : theme.pad.y;
  // Panel top inset + title band + 2px title border + padded default control
  // + frame edge.
  const minimum = panelTitleBodyOffset() + 2 + padY + theme.buttonH + frameBottom;
  return { ...opts, minH: Math.max(opts.minH ?? 0, minimum) };
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
  return withTheme(opts.theme, () => {
    const safeOpts = panelWithSafeMinimumHeight(opts);
    const dir = safeOpts.dir ?? "col";
    const fitCross =
      isRootContainer(safeOpts) &&
      (dir === "col" ? safeOpts.w === undefined : safeOpts.h === undefined);
    // The title area includes the panel's top frame inset plus the theme's
    // title band. Reserve a matching 2px below for the bottom border.
    const cfg: AutoContainerConfig = {
      pad: safeOpts.pad ?? theme.pad,
      gap: safeOpts.gap ?? theme.spacing.md,
      justify: safeOpts.justify ?? "start",
      reverse: safeOpts.reverse ?? false,
      fitCross,
      top: safeOpts.title ? panelTitleBodyOffset() : 0,
      bottom: safeOpts.title ? 2 : 0,
      box: (rect) =>
        paintFrame(uiCtx(), {
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          title: safeOpts.title,
          bg: safeOpts.bg,
          border: safeOpts.border,
        }),
    };
    // With overflow the frame + title stay fixed and only the body scrolls.
    if (safeOpts.overflow && safeOpts.overflow !== "visible")
      return scrollable("panel", dir, safeOpts, cfg, children);
    return autoContainer("panel", dir, safeOpts, cfg, children);
  });
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
  // Captured as a clipping container, so the verification harness treats what's
  // drawn inside as legitimately maskable rather than as escaped layout.
  if (layoutCaptureActive) {
    recordLayout("clip", undefined, rect, { clips: true });
    pushLayoutParent();
  }
  try {
    return children();
  } finally {
    if (layoutCaptureActive) popLayoutParent();
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
 *  - `UI.scaled(() => …)` — the global settings: fit the reference size
 *    (`UI.setBaseSize`) into the viewport if one is set, times `UI.setScale`.
 *    With no base size it's just the `UI.setScale` factor (a no-op at 1).
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
    // No-arg form: fit the global reference size (if any) times the global
    // scale. Without a base size there's nothing to fit, but the scale
    // preference still applies — that's the whole UI zoomed by the setting.
    const base = getBaseSize();
    const factor = getUiScaleSetting();
    if (base) return scaledToFit(base.w, base.h, factor, "center", factorOrOptsOrBody);
    return factor === 1 ? factorOrOptsOrBody() : scaledByFactor(factor, factorOrOptsOrBody);
  }
  const children = maybeChildren as () => R;
  if (typeof factorOrOptsOrBody === "number") return scaledByFactor(factorOrOptsOrBody, children);
  const opts = factorOrOptsOrBody;
  return scaledToFit(opts.w, opts.h, opts.scale ?? 1, opts.align ?? "center", children);
}
