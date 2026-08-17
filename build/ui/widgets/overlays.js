import { button } from "./button.js";
import { paintFrame } from "./panel.js";
import { panel, row } from "./layout.js";
import { dismissedByOutsideRelease } from "./lists.js";
import { cachedContentSize, consumeDismissRequest, ensureWired, enterOverlay, flow, hasActiveNavPad, lastContainerRect, lastWidgetRect, layoutCaptureActive, measureWidth, notePaint, popLayoutOverlay, popLayoutParent, pushLayoutOverlay, pushLayoutParent, rawPointer, recordLayout, runAutoSized, sweptCache, text, theme, uiCtx, uiFont, uiFrameTick, uiToScreen, } from "../../ui/core/index.js";
import { anchorViewport, fitAnchored } from "../../ui/core/index.js";
// Whether each popover was open LAST frame — the click that opens one lands
// outside its rect and must not immediately close it again. Swept, so
// position-keyed entries from moved popovers don't accumulate.
const popoverWasOpen = sweptCache();
export function popover(opts, children) {
    const ctx = uiCtx();
    ensureWired();
    // BEFORE anything is placed, and only while OPEN: a request consumed by a
    // closed popover would be taken from whatever else is listening this frame —
    // an open modal behind it, or the screen's own back handler.
    if (opts.open && opts.onDismiss && consumeDismissRequest())
        opts.onDismiss();
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
        ({ x, y } = fitAnchored({ x: anchor.x, y: anchor.y + anchor.h + gap, w, h }, anchor.y - h - gap, 4));
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
    if (open && was && dismissedByOutsideRelease(p, screenRect))
        open = false;
    popoverWasOpen.set(id, open);
    if (!open)
        return false;
    enterOverlay();
    // The capture could not see a popover AT ALL before this: the box is computed
    // here rather than through `place`/`autoContainer`, so nothing recorded it,
    // and `runAutoSized`'s `pushLayoutParent` — which opens "the most recent
    // entry" — therefore hung the popover's children off the TRIGGER drawn just
    // before it. Recording the box first fixes both at once, since the box is then
    // the most recent entry. `pinned`, because the coordinates are the popover's
    // own (anchored or explicit) and never a container's slot.
    //
    // `pushLayoutOverlay` is the other half: this frame and everything inside it
    // is an overlay, which is what entitles it to paint over the screen behind it
    // and what makes anything painting over IT a fault. See `paintIssues`.
    pushLayoutOverlay();
    const captured = layoutCaptureActive;
    if (captured) {
        recordLayout("popover", id, rect, { pinned: true });
        pushLayoutParent();
    }
    try {
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
            runAutoSized(key, rect, body, "col", opts.gap ?? theme.spacing.md, pad, "start", false, false, children);
        }
    }
    finally {
        if (captured)
            popLayoutParent();
        popLayoutOverlay();
    }
    return true;
}
export function modal(opts, children) {
    const ctx = uiCtx();
    ensureWired();
    if (opts.onDismiss && consumeDismissRequest())
        opts.onDismiss();
    enterOverlay(opts.showFocus ?? hasActiveNavPad());
    const vp = anchorViewport();
    const id = opts.id ?? `modal:${opts.title ?? ""}`;
    // The dim backdrop is the modal's real extent — it covers the viewport and
    // eats the pointer over all of it — and it was never in the capture, so a
    // reader of the tree saw only a centered panel and no sign of what made it
    // modal. Recorded as the overlay ROOT, with the dialog hung under it.
    //
    // BEFORE the fill, not after: the paint clock credits a draw to the entry
    // recorded most recently, so a backdrop painted first would have had its
    // ordinal taken by the dialog panel and the modal would have read as an entry
    // that covers the viewport and never paints.
    pushLayoutOverlay();
    const captured = layoutCaptureActive;
    if (captured) {
        // `${id}:backdrop`, not `id`: the dialog PANEL already carries the modal's
        // own id, and a second entry answering to the same one silently changes what
        // every existing `tree.find(e => e.id === …)` resolves to — from the dialog
        // to a box the size of the window. Two consumers' assertions moved before
        // this suffix existed.
        recordLayout("modal", `${id}:backdrop`, { x: 0, y: 0, w: vp.w, h: vp.h }, { pinned: true });
    }
    ctx.save();
    ctx.fillStyle = theme.dim;
    ctx.fillRect(0, 0, vp.w, vp.h);
    ctx.restore();
    if (captured) {
        // The raw `fillRect` above bypasses the kit's box painter, so claim the
        // ordinal by hand — those pixels are on the screen either way.
        notePaint();
        pushLayoutParent();
    }
    try {
        return drawModalBody(opts, id, children, ctx, vp);
    }
    finally {
        if (captured)
            popLayoutParent();
        popLayoutOverlay();
    }
}
/** The modal's contents, split out only so `modal` can wrap it in the capture's
 *  overlay scope with one `try`/`finally` rather than three return paths. */
function drawModalBody(opts, id, children, ctx, vp) {
    if (children) {
        // The dialog IS a panel: centered by the anchor, auto-sized on the axis
        // left unspecified, and laying its children out like any container.
        const margin = opts.margin ?? 12;
        const result = panel({
            anchor: "center",
            w: opts.w ?? 360,
            h: opts.h,
            margin,
            title: opts.title,
            id,
            dir: opts.dir,
            gap: opts.gap,
            pad: opts.pad,
            bg: opts.bg,
            border: opts.border,
        }, children);
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
// The frame each modal was last drawn on. The release that OPENS a modal lands
// on the backdrop of the modal it just opened, and would close it again on the
// same click — so the first frame of a modal never dismisses it.
//
// The FRAME and not a boolean, which is what this used to hold. A swept entry
// outlives its widget by `STALE_FRAMES`, about ten seconds, because that is
// what makes the cache a cache; so "is there an entry" answered "was this
// modal open at some point in the last ten seconds" and a modal closed and
// reopened inside that window skipped its own first-frame grace. The click
// that reopened it then dismissed it immediately, and it looked like the
// button had stopped working. Found in a game whose settings modal could be
// opened exactly once.
const modalLastDrawn = sweptCache();
function clickAway(opts, id, dialog) {
    if (!opts.onClickOutside)
        return;
    const tick = uiFrameTick();
    const was = modalLastDrawn.get(id) === tick - 1;
    modalLastDrawn.set(id, tick);
    if (!was || !dialog)
        return;
    // Raw pointer: the modal IS the overlay, so `uiPointer` is dead everywhere
    // outside the dialog — which is precisely the region being tested. The raw
    // one is in SCREEN coords and `dialog` is in the current space, so map it out
    // before comparing (the dialog may be inside a `UI.scaled` block).
    const tl = uiToScreen(dialog.x, dialog.y);
    const br = uiToScreen(dialog.x + dialog.w, dialog.y + dialog.h);
    const screenRect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    if (dismissedByOutsideRelease(rawPointer(), screenRect))
        opts.onClickOutside();
}
export function confirm(optsOrTitle) {
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
    const variantFor = (i) => opts.variants?.[i] ?? (i === buttons.length - 1 ? "primary" : "default");
    const idPrefix = opts.id ?? opts.title ?? "confirm";
    return modal({ w, title: opts.title, id: `confirm:${idPrefix}`, gap: 6 }, () => {
        for (const [i, line] of lines.entries()) {
            text(line, { h: lineH, color: i === 0 ? undefined : "dim" });
        }
        let hit = null;
        row({ justify: "end", gap: 8, h: 34, id: `${idPrefix}:buttons` }, () => {
            for (const [i, label] of buttons.entries()) {
                if (button({
                    id: `${idPrefix}:button:${i}`,
                    tabIndex: i,
                    label,
                    variant: variantFor(i),
                    h: 34,
                })) {
                    hit = label;
                }
            }
        });
        return hit;
    });
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
export function dialog(opts) {
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
    let hit = null;
    if (choices.length) {
        const bar = flow({ x: x + w - 12, y: y + h - 44, h: 32, gap: 8, align: "end" });
        for (let i = choices.length - 1; i >= 0; i--) {
            if (button({
                id: `${opts.id ?? opts.speaker ?? "dialog"}:choice:${i}`,
                tabIndex: i,
                at: bar,
                label: choices[i],
                variant: i === 0 ? "primary" : "default",
                h: 32,
            })) {
                hit = choices[i];
            }
        }
    }
    else if (opts.hint) {
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
