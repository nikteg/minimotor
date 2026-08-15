import { paintFrame, panelTitleBodyOffset } from "./panel.js";
import { autoContainer, bound, cachedContentSize, containerKey, containerRect, currentLayout, currentUiScale, focusReveal, getBaseSize, getUiScaleSetting, layoutArgs, layoutCaptureActive, popLayoutParent, pushLayoutParent, recordLayout, popPointerClip, popUiTransform, pushPointerClip, pushUiTransform, roundRectPath, resolveThemePadding, runAutoSized, storeContentSize, sweptCache, theme, uiCtx, uiHeight, markPointerOverUi, uiPointer, uiToScreen, uiWidth, withTheme, } from "../../ui/core/index.js";
import { dragScroll, scrollbar, scrollbarFade, wheelScroll } from "./lists.js";
import { dropTarget } from "./dragdrop.js";
import { anchorViewport } from "../../ui/core/index.js";
import { pointInRect } from "../../collision/index.js";
import { clamp } from "../../math/mathf.js";
// Persisted scroll offset per scrolling container, keyed by its scrollbar id.
// Swept, so position-keyed entries from containers that move or stop being
// drawn age out instead of accumulating. (The bar's fade alpha is kept next to
// `scrollbar` itself — every scroll region fades through `scrollbarFade`.)
const scrollOffsets = sweptCache();
// The focus-reveal epoch each region last scrolled for — so one Tab produces
// one scroll, and the user can wheel away afterwards without being dragged back.
const revealSeen = sweptCache();
// The furthest each `stickToEnd` region could scroll last frame. Comparing this
// frame's offset against LAST frame's max is the whole trick: the moment new
// content arrives the max grows, and a reader who was at the old end is still
// sitting on it, which is what marks them as following the tail.
const stickMax = sweptCache();
/** How far this scroll region must move to bring the keyboard-focused widget
 *  into `bodyRect` (0 when it's already visible, nothing is focused, or this
 *  region already handled the current focus move). Both rects are compared in
 *  SCREEN coords — the focus registry stores them that way, so it works the
 *  same inside a `UI.scaled` block — and the result is converted back into the
 *  region's own units. */
function revealOffset(sbId, bodyRect, horiz) {
    const reveal = focusReveal(revealSeen.get(sbId) ?? -1);
    if (!reveal)
        return 0;
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
    if (crossNear + (horiz ? reveal.rect.h : reveal.rect.w) < crossTl)
        return 0;
    if (crossNear > crossTl + crossSize)
        return 0;
    // Nudge by the smaller edge overshoot, with a little breathing room, and
    // claim the epoch so this doesn't repeat while the focus stays put.
    const PAD = 8 * scale;
    let delta = 0;
    if (near < view.near + PAD)
        delta = near - view.near - PAD;
    else if (far > view.far - PAD)
        delta = Math.min(far - view.far + PAD, near - view.near - PAD);
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
function scrollable(kind, dir, opts, cfg, children) {
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
    const fitMain = contentMain === undefined ? avail : clipOnly ? naturalMain : Math.min(naturalMain, avail);
    // `maxH`/`maxW` on the SCROLL axis is what makes a nested region shrink-wrap
    // and then clip, which is the whole point of a capped scroll box: it takes
    // its content's size until the content passes the cap. Without it a nested
    // region has no main size of its own — `mainForRect` below is `undefined` so
    // the parent's slot decides — and the only way to bound one was `h`, which
    // pins it to that height whether the content needs it or not.
    const maxMain = horiz ? opts.maxW : opts.maxH;
    const cappedMain = maxMain === undefined ? undefined : bound(naturalMain, horiz ? opts.minW : opts.minH, maxMain);
    const estMain = explicitMain ?? cappedMain ?? (horiz ? cachedBox?.w : cachedBox?.h) ?? fitMain;
    const estView = horiz ? estMain : estMain - top - bottom;
    const barThick = !clipOnly && (contentMain ?? estView) - estView > 0.5 ? theme.scrollbarW : 0;
    const gutter = barThick ? barThick + theme.scrollbarGap : 0; // room reserved for the bar
    // Cross box size = intrinsic content cross + title band + gutter. Explicit
    // `w` (vertical) / `h` (horizontal) wins, so a vertical column keeps its
    // declared width and never derives it from content.
    const naturalCross = (horiz ? top + bottom : 0) + (contentCross ?? 0) + gutter;
    // A nested vertical viewport fills its parent's horizontal cross axis so its
    // content can reflow to the available width. Shrink-wrapping that axis to
    // last frame's content makes a scaled wrapping row keep the old wide width.
    // Horizontal viewports retain their content-derived height, and root
    // vertical viewports still shrink-wrap when no width was supplied.
    const crossExplicit = horiz ? opts.h : opts.w;
    const boxCross = crossExplicit ??
        (dir === "col" && !isRootContainer(opts)
            ? undefined
            : contentCross !== undefined
                ? naturalCross
                : undefined);
    // Main size for the box: explicit, else the capped content size, else
    // `undefined` so a nested parent fills it (a root falls back to the fit
    // estimate).
    const mainForRect = explicitMain ?? cappedMain ?? (isRootContainer(opts) ? fitMain : undefined);
    const rect = containerRect(dir, horiz ? { ...opts, w: mainForRect, h: boxCross } : { ...opts, w: boxCross, h: mainForRect }, cachedBox);
    // `clips`: this region masks its children, so content extending past the box
    // is the point, not a layout fault (see `layoutIssues`).
    //
    // ...and OPENED as a parent, which it was not before item 196. A scrolling
    // panel recorded its box and then let the `clip` below — and everything drawn
    // inside it — land as its SIBLINGS, under whatever container held the panel.
    // The tree therefore said a scroll region's own content was not its content,
    // which reads as a lie in a debug overlay and made `paintIssues` report a
    // scrolling panel's frame under every line of its own text.
    const capturedRegion = layoutCaptureActive;
    if (capturedRegion) {
        recordLayout(kind, opts.id, rect, { clips: true });
        pushLayoutParent();
    }
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
    // Follow the tail, but only for a reader who is already at it. A region seen
    // for the first time counts as at the end, so a log that opens with a backlog
    // opens on the newest line rather than the oldest.
    if (opts.stickToEnd && !clipOnly) {
        const previous = stickMax.get(sbId);
        if (previous === undefined || offset >= previous - 0.5)
            offset = max;
        stickMax.set(sbId, max);
    }
    // Swipe / body-drag runs BEFORE the children (so the offset applies to this
    // frame's draw and the press-claim beats child widgets). On the press frame
    // the innermost region overwrites the claim, so a swipe inside a nested region
    // scrolls that region. (Wheel is handled AFTER the children — see below — so a
    // nested region claims it first: inner-first chaining.)
    offset = dragScroll(sbId, { x: bodyRect.x, y: bodyRect.y, w: innerW, h: innerH }, horiz ? "x" : "y", offset, max);
    // The pointer at the REGION'S ENTRY — `wheelScroll` below needs this read, not
    // a fresh one (see its doc).
    const p = uiPointer();
    // The offset math runs at any alpha, so a faded bar stays usable.
    const alpha = scrollbarFade(sbId, pointInRect(p.x, p.y, bodyRect), max > 0);
    const originX = bodyRect.x - (horiz ? offset : 0);
    const originY = bodyRect.y - (horiz ? 0 : offset);
    let result;
    clip({ x: bodyRect.x, y: bodyRect.y, w: innerW, h: innerH }, () => {
        result = runAutoSized(bodyKey, { x: originX, y: originY }, { x: originX, y: originY, w: horiz ? contentVal : innerW, h: horiz ? innerH : contentVal }, dir, cfg.gap, cfg.pad, cfg.justify, cfg.reverse, 
        // Horizontal: children take natural HEIGHT (intrinsic cross) so the box
        // height is stable. Vertical: they fill the WIDTH as usual.
        horiz, children);
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
    if (capturedRegion)
        popLayoutParent();
    return result;
}
// Auto containers shrink-wrap omitted axes by default. `fitCross` remains the
// explicit opt-out/opt-in switch for callers that need the flex-style stretch
// behavior, while `flex: "fill"` always wins for a deliberate fill slot.
const isRootContainer = (opts) => opts.x !== undefined && opts.y !== undefined;
export function row(optsOrChildren, maybeChildren) {
    const [opts, children] = layoutArgs(optsOrChildren, maybeChildren);
    return withTheme(opts.theme, () => {
        const wrap = opts.wrap ?? false;
        // A row's cross axis is height. Wrapping children take their natural height
        // so lines measure correctly; ordinary auto rows do the same by default.
        const fitCross = opts.fitCross ?? (wrap || (opts.h === undefined && opts.flex !== "fill"));
        const cfg = {
            pad: opts.pad ?? 0,
            gap: opts.gap ?? theme.spacing.md,
            justify: opts.justify ?? "start",
            reverse: opts.reverse ?? false,
            fitCross,
            stretchCross: opts.stretchCross,
            alignCross: opts.alignCross,
            wrap,
        };
        if (opts.overflow && opts.overflow !== "visible")
            return scrollable("row", "row", opts, cfg, children);
        return autoContainer("row", "row", opts, cfg, children);
    });
}
export function col(optsOrChildren, maybeChildren) {
    const [opts, children] = layoutArgs(optsOrChildren, maybeChildren);
    return withTheme(opts.theme, () => {
        const wrap = opts.wrap ?? false;
        // A col's cross axis is width. Wrapping children take their natural width;
        // ordinary auto columns do the same by default.
        const fitCross = opts.fitCross ?? (wrap || (opts.w === undefined && opts.flex !== "fill"));
        const cfg = {
            pad: opts.pad ?? 0,
            gap: opts.gap ?? theme.spacing.md,
            justify: opts.justify ?? "start",
            reverse: opts.reverse ?? false,
            fitCross,
            stretchCross: opts.stretchCross,
            alignCross: opts.alignCross,
            wrap,
        };
        if (opts.overflow && opts.overflow !== "visible")
            return scrollable("col", "col", opts, cfg, children);
        return autoContainer("col", "col", opts, cfg, children);
    });
}
/** Keep an explicitly sized titled pixel panel from placing its first standard
 *  control inside the skin's fixed bottom edge. Auto-sized panels already get
 *  this space from their measured children. */
function panelWithSafeMinimumHeight(opts) {
    const frameBottom = theme.skin?.frames.panel?.insets.bottom ?? 0;
    if (!opts.title || !frameBottom)
        return opts;
    // Panel top inset + title band + 2px title border + the theme's own body
    // inset on both edges + padded default control + frame edge. `panelPadding`
    // rather than a second reading of `opts.pad` keeps partial edge values
    // consistent between the measured minimum and the actual body flow.
    const inset = resolveThemePadding(theme.panel.frameInset);
    const padding = resolveThemePadding(panelPadding(opts));
    const minimum = panelTitleBodyOffset() +
        2 +
        inset.top +
        inset.bottom +
        padding.top +
        theme.button.height +
        frameBottom;
    return { ...opts, minH: Math.max(opts.minH ?? 0, minimum) };
}
/** The panel's own padding: the caller's (or the theme's) `pad`, plus the
 *  theme's `panel.frameInset` on the horizontal edges. Vertical inset is spent on
 *  `cfg.top` / `cfg.bottom`, so it stacks with the title band instead of being
 *  mirrored around the whole body. */
function panelPadding(opts) {
    const base = resolveThemePadding(opts.pad, theme.panel.padding);
    const inset = resolveThemePadding(theme.panel.frameInset);
    return {
        top: base.top,
        right: base.right + inset.right,
        bottom: base.bottom,
        left: base.left + inset.left,
    };
}
/** A framed, optionally-titled box that lays its children out — the workhorse
 *  container for menus, dialogs and HUD clusters (`panel` + `col`/`row` in one).
 *  The body is inset below the title strip and padded by `theme.panel.padding`; a bare
 *  frame is just `UI.panel(opts, () => {})` positioning content absolutely
 *  inside. `title`/`bg`/`border` style the frame; the rest is `LayoutOptions`
 *  (`justify`/`anchor`/`overflow`/`dir`/nesting):
 *
 *    UI.panel({ anchor: "center", w: 260, title: "PAUSED" }, () => {
 *      if (UI.button({ label: "Resume" })) resume();
 *    }); */
export function panel(opts, children) {
    return withTheme(opts.theme, () => {
        const safeOpts = panelWithSafeMinimumHeight(opts);
        const dir = safeOpts.dir ?? "col";
        const fitCross = safeOpts.fitCross ??
            (dir === "col"
                ? safeOpts.w === undefined && safeOpts.flex !== "fill"
                : safeOpts.h === undefined && safeOpts.flex !== "fill");
        // The title area includes the panel's top frame inset plus the theme's
        // title band. Reserve a matching 2px below for the bottom border.
        // The panel inset is the gap a skin needs between its frame art and any
        // content, and it applies with or without a title.
        const panelInset = resolveThemePadding(theme.panel.frameInset);
        const cfg = {
            pad: panelPadding(safeOpts),
            gap: safeOpts.gap ?? theme.spacing.md,
            justify: safeOpts.justify ?? "start",
            reverse: safeOpts.reverse ?? false,
            fitCross,
            stretchCross: safeOpts.stretchCross,
            alignCross: safeOpts.alignCross,
            top: (safeOpts.title ? panelTitleBodyOffset() : 0) + panelInset.top,
            bottom: (safeOpts.title ? 2 : 0) + panelInset.bottom,
            box: (rect) => {
                const target = safeOpts.dropTarget
                    ? dropTarget({ ...safeOpts.dropTarget, ...rect })
                    : null;
                // A panel is a surface, not a hole: a drag started on the empty part
                // of a HUD drawer belongs to the drawer, not to whatever the game is
                // drawing behind it. See `pointerOverUi`.
                const p = uiPointer();
                if (pointInRect(p.x, p.y, rect))
                    markPointerOverUi();
                paintFrame(uiCtx(), {
                    x: rect.x,
                    y: rect.y,
                    w: rect.w,
                    h: rect.h,
                    title: safeOpts.title,
                    bg: safeOpts.bg,
                    border: safeOpts.border,
                    highlight: target?.canDrop
                        ? theme.accent
                        : target?.hovered
                            ? theme.danger
                            : safeOpts.highlight,
                });
            },
        };
        // With overflow the frame + title stay fixed and only the body scrolls.
        if (safeOpts.overflow && safeOpts.overflow !== "visible")
            return scrollable("panel", dir, safeOpts, cfg, children);
        return autoContainer("panel", dir, safeOpts, cfg, children);
    });
}
/** Insert extra spacing before the next child in the current layout. */
export function spacer(px) {
    currentLayout()?.gap(px);
}
/** Clip drawing to `rect` for the duration of `children` — for scrollable
 *  lists and masked regions, so a screen never hand-rolls save/clip/restore.
 *  Also gates the pointer to `rect`, so a widget clipped out of view (e.g.
 *  scrolled past a region's edge) can't be clicked through the empty space it
 *  was drawn into. Returns the callback's value. */
export function clip(rect, children) {
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
    }
    finally {
        if (layoutCaptureActive)
            popLayoutParent();
        popPointerClip();
        ctx.restore();
    }
}
// Scale by a raw factor around the top-left origin.
function scaledByFactor(factor, children) {
    const ctx = uiCtx();
    ctx.save();
    ctx.scale(factor, factor);
    pushUiTransform(factor, 0, 0, uiWidth() / factor, uiHeight() / factor);
    try {
        return children();
    }
    finally {
        popUiTransform();
        ctx.restore();
    }
}
// Fit a w×h reference box (uniform scale + align) into the current UI space.
function scaledToFit(w, h, scaleMult, align, children) {
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
    }
    finally {
        popUiTransform();
        ctx.restore();
    }
}
export function scaled(factorOrOptsOrBody, maybeChildren) {
    if (typeof factorOrOptsOrBody === "function") {
        // No-arg form: fit the global reference size (if any) times the global
        // scale. Without a base size there's nothing to fit, but the scale
        // preference still applies — that's the whole UI zoomed by the setting.
        const base = getBaseSize();
        const factor = getUiScaleSetting();
        if (base)
            return scaledToFit(base.w, base.h, factor, "center", factorOrOptsOrBody);
        return factor === 1 ? factorOrOptsOrBody() : scaledByFactor(factor, factorOrOptsOrBody);
    }
    const children = maybeChildren;
    if (typeof factorOrOptsOrBody === "number")
        return scaledByFactor(factorOrOptsOrBody, children);
    const opts = factorOrOptsOrBody;
    return scaledToFit(opts.w, opts.h, opts.scale ?? 1, opts.align ?? "center", children);
}
