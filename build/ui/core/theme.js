// ---------- Theme painting ----------
// Drawing helpers that style from the shared `Theme` tokens. They need text
// measurement (a UI-state concern), so they stay here; the tokens themselves
// are core and re-exported below so `UI.setTheme` stays one import for callers.
import { lineMetrics, measureWidth } from "./measure.js";
// The layout capture's paint clock. Imported from its own leaf module rather
// than from `layout-capture.ts`, which reaches `lifecycle.ts` and so back to
// this file — see the note at the top of `paint-seq.ts`.
import { notePaint } from "./paint-seq.js";
import { theme, } from "../../ui/theme.js";
export { defaultTheme, getTheme, resolveThemePadding, resolveThemeTextPadding, setTheme, theme, withTheme, } from "../../ui/theme.js";
export { createTilesetSkin, createTilesetSkinFromManifest, frameFromCell, inspectTilesetSkin, shade, } from "../../ui/theme.js";
export const uiFont = (size = theme.fontSize, bold = false) => `${bold ? "bold " : ""}${size}px ${theme.font}`;
/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
export function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (rr <= 0) {
        ctx.rect(x, y, w, h);
        return;
    }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
function rotatedFrame(frame, axis) {
    if (!axis || (frame.orientation ?? "x") === axis)
        return undefined;
    return axis === "y" ? "cw" : "ccw";
}
function orientedInsets(frame, rotation) {
    if (rotation === "cw") {
        return {
            left: frame.insets.top,
            top: frame.insets.right,
            right: frame.insets.bottom,
            bottom: frame.insets.left,
        };
    }
    if (rotation === "ccw") {
        return {
            left: frame.insets.bottom,
            top: frame.insets.left,
            right: frame.insets.top,
            bottom: frame.insets.right,
        };
    }
    return frame.insets;
}
/** Paint one named sprite from the active skin. Widgets use semantic names
 *  (`selectArrow`, `checkboxOn`, `radioOff`, …), while a theme decides which
 *  atlas region supplies that name. Returns false when the skin has no such
 *  sprite so the caller can use its procedural fallback. */
export function drawThemeSprite(ctx, name, x, y, w, h) {
    const sprite = theme.skin?.sprites.icons?.[name];
    if (!sprite)
        return false;
    notePaint();
    const dw = w ?? sprite.region.sw;
    const dh = h ?? sprite.region.sh;
    if (dw <= 0 || dh <= 0)
        return false;
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    try {
        ctx.drawImage(sprite.image, sprite.region.sx, sprite.region.sy, sprite.region.sw, sprite.region.sh, x, y, dw, dh);
    }
    finally {
        ctx.imageSmoothingEnabled = previousSmoothing;
    }
    return true;
}
function frameRole(role, state) {
    if (role === "panel")
        return "panel";
    if (role === "panelTitle")
        return "panelTitle";
    if (role === "menuGroup")
        return "menuGroup";
    if (role === "barTrack")
        return "barTrack";
    if (role === "barFill")
        return "barFill";
    if (role === "sliderTrack")
        return "sliderTrack";
    if (role === "sliderFill")
        return "sliderFill";
    if (role === "scrollTrack")
        return "scrollTrack";
    if (role === "scrollThumb") {
        if (state === "active")
            return "scrollThumbActive";
        if (state === "hover")
            return "scrollThumbHover";
        return "scrollThumb";
    }
    if (role === "input") {
        if (state === "hover")
            return "inputHover";
        if (state === "active")
            return "inputActive";
        if (state === "disabled")
            return "inputDisabled";
        return "input";
    }
    if (role === "tab") {
        if (state === "active")
            return "tabActive";
        if (state === "hover")
            return "tabHover";
        return "tab";
    }
    if (state === "hover")
        return "buttonHover";
    if (state === "active")
        return "buttonActive";
    if (state === "disabled")
        return "disabled";
    return "button";
}
function roleFrame(frames, role, state) {
    if (!frames)
        return undefined;
    const primary = frames[frameRole(role, state)];
    if (primary)
        return primary;
    if (role === "tab" && state !== "default")
        return frames.tab;
    if (role === "input" && state !== "default")
        return frames.input ?? (state === "disabled" ? frames.disabled : undefined);
    return undefined;
}
function drawImagePart(ctx, image, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0)
        return;
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}
function repeatSlice(ctx, image, sx, sy, sw, sh, dx, dy, dw, dh) {
    let y = dy;
    let remainingY = dh;
    while (remainingY > 0) {
        const sliceH = Math.min(sh, remainingY);
        let x = dx;
        let remainingX = dw;
        while (remainingX > 0) {
            const sliceW = Math.min(sw, remainingX);
            drawImagePart(ctx, image, sx, sy, sliceW, sliceH, x, y, sliceW, sliceH);
            x += sliceW;
            remainingX -= sliceW;
        }
        y += sliceH;
        remainingY -= sliceH;
    }
}
function drawOrientedNineSlice(ctx, image, frame, x, y, w, h, axis) {
    const rotation = rotatedFrame(frame, axis);
    if (!rotation) {
        drawNineSlice(ctx, image, frame, x, y, w, h);
        return;
    }
    ctx.save();
    if (rotation === "cw") {
        ctx.translate(x + w, y);
        ctx.rotate(Math.PI / 2);
    }
    else {
        ctx.translate(x, y + h);
        ctx.rotate(-Math.PI / 2);
    }
    drawNineSlice(ctx, image, frame, 0, 0, h, w);
    ctx.restore();
}
/** Paint a pixel-native nine-slice region, clipping partial repeats. */
export function drawNineSlice(ctx, image, region, x, y, w, h) {
    notePaint();
    const { left, top, right, bottom } = region.insets;
    const centerW = region.sw - left - right;
    const centerH = region.sh - top - bottom;
    if (w < left + right || h < top + bottom) {
        // A control smaller than its fixed corners cannot be represented without
        // overlapping slices; scale the complete frame only for this edge case.
        drawImagePart(ctx, image, region.sx, region.sy, region.sw, region.sh, x, y, w, h);
        return;
    }
    const dx = x + left;
    const dy = y + top;
    const dw = w - left - right;
    const dh = h - top - bottom;
    const sx = region.sx;
    const sy = region.sy;
    drawImagePart(ctx, image, sx, sy, left, top, x, y, left, top);
    drawImagePart(ctx, image, sx + region.sw - right, sy, right, top, x + w - right, y, right, top);
    drawImagePart(ctx, image, sx, sy + region.sh - bottom, left, bottom, x, y + h - bottom, left, bottom);
    drawImagePart(ctx, image, sx + region.sw - right, sy + region.sh - bottom, right, bottom, x + w - right, y + h - bottom, right, bottom);
    repeatSlice(ctx, image, sx + left, sy, centerW, top, dx, y, dw, top);
    repeatSlice(ctx, image, sx + left, sy + region.sh - bottom, centerW, bottom, dx, y + h - bottom, dw, bottom);
    repeatSlice(ctx, image, sx, sy + top, left, centerH, x, dy, left, dh);
    repeatSlice(ctx, image, sx + region.sw - right, sy + top, right, centerH, x + w - right, dy, right, dh);
    repeatSlice(ctx, image, sx + left, sy + top, centerW, centerH, dx, dy, dw, dh);
}
/** Fill (and optionally stroke) a themed box: rounded per `theme.radius`,
 *  stroked at `theme.borderWidth` inset so the outline stays inside the rect.
 *  `radius`/`border` override the theme for one call. */
export function drawBox(ctx, x, y, w, h, opts) {
    // Every opaque box in the kit lands here — panel and popover frames, buttons,
    // fields, bars, tabs, toggles, list rows — which makes it the one place the
    // capture has to be told "these pixels went down now".
    notePaint();
    const frames = theme.skin?.frames;
    const state = opts.state ?? "default";
    const variant = opts.variant ?? "default";
    const variantFrame = opts.role === "button" && variant !== "default"
        ? (theme.skin?.buttonVariants?.[variant]?.[state] ??
            theme.skin?.buttonVariants?.[variant]?.default)
        : undefined;
    const themedRoleFrame = opts.role ? roleFrame(frames, opts.role, state) : undefined;
    const requestedFrame = opts.role === "button" && variant !== "default"
        ? variantFrame
        : (variantFrame ?? themedRoleFrame);
    const frame = requestedFrame ??
        (opts.role === "button" && variant === "default"
            ? frames?.button
            : opts.role === "tab"
                ? frames?.tab
                : opts.role === "input"
                    ? frames?.input
                    : undefined);
    if (frame && theme.skin) {
        const previousSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        try {
            // Some pixel frames are outlines with transparent centers (including
            // the Tiny RPG bar/slider art). Keep the caller's fill visible beneath
            // the nine-slice frame instead of silently dropping it because a skin
            // was selected.
            const needsFrameUnderlay = opts.role === "barTrack" ||
                opts.role === "barFill" ||
                opts.role === "sliderTrack" ||
                opts.role === "sliderFill" ||
                opts.role === "scrollTrack" ||
                opts.role === "scrollThumb";
            if (opts.fill && needsFrameUnderlay) {
                const { left, top, right, bottom } = orientedInsets(frame, rotatedFrame(frame, opts.axis));
                const innerW = w >= left + right ? w - left - right : w;
                const innerH = h >= top + bottom ? h - top - bottom : h;
                const innerX = w >= left + right ? x + left : x;
                const innerY = h >= top + bottom ? y + top : y;
                ctx.fillStyle = opts.fill;
                ctx.beginPath();
                ctx.rect(innerX, innerY, innerW, innerH);
                ctx.fill();
            }
            drawOrientedNineSlice(ctx, frame.image ?? theme.skin.image, frame, x, y, w, h, opts.axis);
        }
        finally {
            ctx.imageSmoothingEnabled = previousSmoothing;
        }
        return;
    }
    const r = opts.radius ?? theme.radius;
    if (opts.fill) {
        ctx.fillStyle = opts.fill;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
    }
    if (opts.stroke) {
        const bw = opts.border ?? theme.borderWidth;
        if (bw > 0) {
            ctx.strokeStyle = opts.stroke;
            ctx.lineWidth = bw;
            const half = bw / 2;
            roundRectPath(ctx, x + half, y + half, w - bw, h - bw, Math.max(0, r - half));
            ctx.stroke();
        }
    }
}
/** Trim `text` with a trailing ellipsis until it fits `maxW` (binary search).
 *  Returns the string unchanged when it already fits. Every probe goes through
 *  the memo, so a label that keeps its text and width costs map hits after the
 *  first frame instead of ~log₂(n) real measurements. */
export function ellipsize(ctx, text, maxW) {
    if (maxW <= 0 || measureWidth(ctx, text) <= maxW)
        return text;
    const ell = "…";
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measureWidth(ctx, text.slice(0, mid) + ell) <= maxW)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo) + ell : ell;
}
/** Vertically centered text using stable font line metrics — the canvas
 *  "middle" baseline sits visibly high for most fonts. Honors the current textAlign.
 *  `maxW` clips with an ellipsis (via `ellipsize`) so a label can never spill
 *  out of its widget. */
export function centeredText(ctx, text, x, cy, maxW) {
    // A label is the other half of what reaches the canvas — item 115's fault was
    // a table's HEADER coming through a popover, not a box. An empty string is
    // not a paint.
    if (text !== "")
        notePaint();
    // measureText's actualBoundingBox values are relative to the CURRENT
    // textBaseline — pin it before measuring, or state leaked from caller
    // drawing (e.g. "middle") skews the correction.
    ctx.textBaseline = "alphabetic";
    // Clip to width with an ellipsis rather than passing `maxW` to fillText,
    // which SQUISHES the glyphs horizontally. (Multi-line wrapping is handled by
    // the caller via `wrapLines`; this keeps a single line from stretching.)
    const str = maxW !== undefined ? ellipsize(ctx, text, maxW) : text;
    // Use font-level metrics rather than the current string's actual bounds.
    // This keeps every single-line label on the same alphabetic baseline even
    // when one label contains descenders and another does not.
    const { asc, desc } = lineMetrics(ctx);
    if (asc || desc) {
        const baseline = cy + (asc - desc) / 2;
        const outline = theme.textOutline;
        if (outline && outline.width > 0 && ctx.strokeText) {
            ctx.save();
            ctx.strokeStyle = outline.color;
            ctx.lineWidth = outline.width;
            ctx.lineJoin = "round";
            ctx.strokeText(str, x, baseline);
            ctx.restore();
        }
        ctx.fillText(str, x, baseline);
    }
    else {
        // Metrics unavailable (mocked ctx) — middle baseline is the best we have.
        ctx.textBaseline = "middle";
        ctx.fillText(str, x, cy);
    }
}
/** `centeredText` for a line made of several differently coloured runs.
 *
 *  Canvas has one `fillStyle` per `fillText`, so a multi-colour line has to be
 *  drawn run by run — but it must still be ELLIPSIZED, ALIGNED and BASELINED as
 *  the one string it is, or a coloured word would change where the line sits.
 *  So the combined string does all of that, and only the painting is split: the
 *  ellipsis is applied to the whole line and then sliced back over the runs by
 *  character offset, the left origin is derived from the combined width under
 *  the caller's `textAlign`, and each run is then placed at the combined
 *  string's own offset for it (see the loop) rather than at the running sum of
 *  the runs' widths — the two differ wherever the font kerns across the split.
 *
 *  A single run is handed straight to `centeredText`, so the overwhelmingly
 *  common case draws through exactly the code it always did. */
export function centeredSpans(ctx, runs, x, cy, maxW) {
    if (runs.length <= 1) {
        const only = runs[0];
        if (only?.color !== undefined)
            ctx.fillStyle = only.color;
        centeredText(ctx, only?.text ?? "", x, cy, maxW);
        return;
    }
    notePaint();
    ctx.textBaseline = "alphabetic";
    const full = runs.map((r) => r.text).join("");
    const shown = maxW !== undefined ? ellipsize(ctx, full, maxW) : full;
    // Slice the (possibly ellipsized) line back over the runs by character
    // offset. `ellipsize` only ever returns a PREFIX plus "…", so a run's
    // characters keep their index and the ellipsis lands on the run the cut fell
    // inside — the same colour as the text it replaced.
    const drawn = [];
    let at = 0;
    for (const run of runs) {
        if (at >= shown.length)
            break;
        const piece = shown.slice(at, at + run.text.length);
        if (piece)
            drawn.push({ text: piece, color: run.color, at });
        at += run.text.length;
    }
    const width = measureWidth(ctx, shown);
    const align = ctx.textAlign;
    const left = align === "center" ? x - width / 2 : align === "right" || align === "end" ? x - width : x;
    const { asc, desc } = lineMetrics(ctx);
    const baseline = asc || desc ? cy + (asc - desc) / 2 : cy;
    const outline = theme.textOutline;
    const prevAlign = ctx.textAlign;
    const prevFill = ctx.fillStyle;
    // Runs are positioned by hand, so the canvas must not align them as well.
    ctx.textAlign = "left";
    if (!asc && !desc)
        ctx.textBaseline = "middle";
    for (const run of drawn) {
        // Each run starts where the COMBINED string would put it — the width of the
        // line's prefix — rather than at the running total of the runs' own widths.
        // The two are not the same number: canvas kerns across a pair of glyphs and
        // splitting the pair between two `measureText` calls loses the kern, so the
        // sum of the parts is WIDER than the whole. MEASURED in headless Chromium
        // over three fonts and eight boundaries: `"V"`+`"."` at 13px Helvetica Neue
        // is 9.880 joined against 11.557 summed, 1.677px apart, and `"AV"`+`"A"` at
        // 12px system-ui is 0.762px apart. Summing would drift every run after the
        // first rightwards by that much and push the line's painted end past the
        // box `text` reserved from the joined measure — which is exactly the "one
        // layout" property this file exists to keep. Boundaries that fall on a
        // space (what a coloured name inside a sentence actually produces) measure
        // 0 apart, so this is a correctness floor rather than a visible shift.
        const pen = run.at === 0 ? left : left + measureWidth(ctx, shown.slice(0, run.at));
        if (outline && outline.width > 0 && ctx.strokeText) {
            ctx.save();
            ctx.strokeStyle = outline.color;
            ctx.lineWidth = outline.width;
            ctx.lineJoin = "round";
            ctx.strokeText(run.text, pen, baseline);
            ctx.restore();
        }
        ctx.fillStyle = run.color ?? prevFill;
        ctx.fillText(run.text, pen, baseline);
    }
    ctx.fillStyle = prevFill;
    ctx.textAlign = prevAlign;
}
