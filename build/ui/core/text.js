import { uiCtx } from "./context.js";
import { currentLayout, place } from "./flow.js";
import { centeredSpans, resolveThemeTextPadding, theme, uiFont } from "./theme.js";
import { currentUiTransform, uiHeight, uiWidth } from "./input.js";
import { measureWidth } from "./measure.js";
import { uiApp } from "./state.js";
export const ANCHOR_H = {
    topLeft: 0,
    left: 0,
    bottomLeft: 0,
    top: 0.5,
    center: 0.5,
    bottom: 0.5,
    topRight: 1,
    right: 1,
    bottomRight: 1,
};
export const ANCHOR_V = {
    topLeft: 0,
    top: 0,
    topRight: 0,
    left: 0.5,
    center: 0.5,
    right: 0.5,
    bottomLeft: 1,
    bottom: 1,
    bottomRight: 1,
};
/** The box viewport-anchored chrome positions against, in the CURRENT space:
 *  the host app's viewport at the root, and the REFERENCE box inside a
 *  `UI.scaled` block (what `UI.width`/`UI.height` report). Anchoring against the
 *  device viewport inside a scaled block would put "centered" and "bottom" off
 *  by the scale — a modal, a dialogue box or a flipped drop-menu laid out in
 *  reference coords must measure the space in those same coords. Safe-area
 *  insets are mapped in too (and clamped at 0 — a scaled box that starts past
 *  the notch owes it nothing). */
export function anchorViewport() {
    const vp = uiApp().viewport;
    const t = currentUiTransform();
    if (t) {
        return {
            w: uiWidth(),
            h: uiHeight(),
            safeLeft: Math.max(0, (vp.safeLeft - t.ox) / t.scale),
            safeTop: Math.max(0, (vp.safeTop - t.oy) / t.scale),
        };
    }
    return vp;
}
/** Keep a box that hangs off something else on screen.
 *
 *  `box` is where it WANTS to go (already offset from its anchor by whatever
 *  gap that caller likes), `flipY` is the top edge to use instead when it would
 *  run off the bottom — normally above the anchor. The result is clamped into
 *  `anchorViewport()` with `margin` px to spare on every side, so a flip that
 *  itself doesn't fit still lands on screen.
 *
 *  Shared by the popover, the select drop-menu and the tooltip. They had each
 *  written the clamp inline and drifted to different margins; the gaps stay
 *  theirs (a menu hugs its control, a tooltip trails the cursor), only the
 *  staying-on-screen part is common. */
export function fitAnchored(box, flipY, margin) {
    const vp = anchorViewport();
    const y = box.y + box.h > vp.h - margin ? flipY : box.y;
    return {
        x: Math.max(margin, Math.min(box.x, vp.w - box.w - margin)),
        y: Math.max(margin, y),
    };
}
/** The line box a single line of themed text occupies: the font size plus the
 *  kit's leading. What `text` reserves per line, and what a caller placing a
 *  label in a COLUMN must pass as `h` — a column slot with no height falls back
 *  to `theme.button.height`, which turns a one-line label into a 32px block. */
export function lineHeight(size) {
    return (size ?? theme.fontSize) + 6;
}
export function resolveColor(c) {
    if (c === "dim")
        return theme.textDim;
    if (c === "accent")
        return theme.accent;
    return c ?? theme.text;
}
/** Width of `content` in the given font (default: the theme's base font) —
 *  for sizing custom layouts around labels. Memoized per (font, string).
 *  Runs measure as the one string they concatenate to, which is the same width
 *  `UI.text` will reserve for them. */
export function textWidth(content, font) {
    const ctx = uiCtx();
    const prevFont = ctx.font;
    ctx.font = font ?? uiFont();
    const w = measureWidth(ctx, spanText(content));
    ctx.font = prevFont;
    return w;
}
/** The runs of `content`, with `"dim"`/`"accent"` resolved and the label's own
 *  colour standing in for any run that names none. A plain string is one run —
 *  which is what keeps every string caller on the span code path rather than
 *  beside it. */
function toRuns(content, fallback) {
    const base = resolveColor(fallback);
    if (typeof content === "string")
        return [{ text: content, color: base }];
    return mergeRuns(content.map((span) => ({
        text: span.text,
        color: span.color === undefined ? base : resolveColor(span.color),
    })));
}
/** The one string a run list means — what is measured, wrapped, ellipsized and
 *  reported. Runs concatenate verbatim. */
export function spanText(content) {
    return typeof content === "string" ? content : content.map((s) => s.text).join("");
}
/** Greedy word-wrap `runs` into lines no wider than `maxW` (font must be set on
 *  `ctx`), each line a run list whose concatenation is that line's text.
 *
 *  This is the kit's ONLY wrapping calculation: `wrapLines` is this function
 *  with one run. Words are measured as the combined string they will be drawn
 *  as, so a word that straddles a colour boundary (`"Ana"` + `"'s ball"`)
 *  breaks where the same characters in one colour would. */
export function wrapRuns(ctx, runs, maxW) {
    // Tokenize into words that carry their runs. Whitespace closes a word; a word
    // is one or more fragments, one per colour it passes through.
    const words = [];
    let word = [];
    const endWord = () => {
        if (word.length > 0)
            words.push(word);
        word = [];
    };
    for (const run of runs) {
        for (const chunk of run.text.split(/(\s+)/)) {
            if (!chunk)
                continue;
            if (/^\s+$/.test(chunk))
                endWord();
            else
                word.push({ text: chunk, color: run.color });
        }
    }
    endWord();
    const lines = [];
    let line = [];
    let lineText = "";
    for (const w of words) {
        const wordText = w.map((f) => f.text).join("");
        const candidate = lineText ? `${lineText} ${wordText}` : wordText;
        if (lineText && measureWidth(ctx, candidate) > maxW) {
            lines.push(line);
            line = [...w];
            lineText = wordText;
        }
        else {
            // The joining space rides on the run before it — invisible, so its colour
            // cannot matter, and this keeps the line's concatenation equal to the
            // string a single-colour wrap would have produced.
            if (lineText)
                line[line.length - 1] = appendSpace(line[line.length - 1]);
            line.push(...w);
            lineText = candidate;
        }
    }
    if (line.length > 0)
        lines.push(line);
    return lines.length > 0 ? lines.map(mergeRuns) : [[]];
}
function appendSpace(run) {
    return { text: `${run.text} `, color: run.color };
}
/** Fold neighbouring runs that share a colour back into one, and drop empties.
 *
 *  This is not a tidiness pass, it is what keeps the plain-string case BYTE
 *  IDENTICAL: word-wrapping cuts a line into one fragment per word, and without
 *  this a single-colour wrapped label would be painted word by word — measured
 *  and advanced per fragment — instead of as the one string `centeredText`
 *  draws. One run in, one run out. */
function mergeRuns(runs) {
    const out = [];
    for (const run of runs) {
        if (!run.text)
            continue;
        const last = out[out.length - 1];
        if (last && last.color === run.color)
            last.text += run.text;
        else
            out.push({ text: run.text, color: run.color });
    }
    return out;
}
/** Greedy word-wrap `str` into lines no wider than `maxW` (font must be set
 *  on `ctx`). A single word wider than `maxW` gets its own line (drawn clamped
 *  by the caller). */
export function wrapLines(ctx, str, maxW) {
    return wrapRuns(ctx, [{ text: str }], maxW).map((line) => line.map((r) => r.text).join(""));
}
/** Draw a line of themed text. Uses the theme font/size/color so a screen
 *  never has to touch `ctx.font`/`fillText` itself; flows in a layout or
 *  positions absolutely:
 *
 *    UI.text("Score: 42", { x: 12, y: 12, bold: true });
 *    UI.text(name, { color: "dim", align: "right", w: col.w });
 *
 *  Pass RUNS instead of a string to colour parts of one label without splitting
 *  it into separate widgets — the runs share this call's slot, wrap, alignment
 *  and measurement, and only the paint is per-run:
 *
 *    UI.text([{ text: name, color: player.color }, { text: " holed out" }]); */
export function text(content, rawOpts) {
    const ctx = uiCtx();
    let opts = rawOpts ?? {};
    // Everything below sizes, wraps, ellipsizes and records the label as the one
    // string it reads as — `str` — so a multi-colour label occupies exactly the
    // box its plain-string equivalent would.
    const str = spanText(content);
    if (opts.anchor) {
        const view = anchorViewport();
        const hx = ANCHOR_H[opts.anchor];
        const vy = ANCHOR_V[opts.anchor];
        const baseX = hx === 0 ? view.safeLeft : hx === 0.5 ? view.w / 2 : view.w;
        const baseY = vy === 0 ? view.safeTop : vy === 0.5 ? view.h / 2 : view.h;
        const lineH = lineHeight(opts.size);
        opts = {
            ...opts,
            x: baseX + (opts.x ?? 0),
            y: baseY + (opts.y ?? 0) - vy * lineH,
            align: opts.align ?? (hx === 0 ? "left" : hx === 0.5 ? "center" : "right"),
            anchor: undefined,
        };
    }
    ctx.save();
    // UI is ALWAYS screen (letterbox-logical) space, regardless of ambient
    // camera blocks — reset to the base transform, not raw device space. Only
    // when the host app actually owns THIS ctx (an offscreen ctx keeps its
    // transform). The reset also wipes the canvas-side scale a `UI.scaled` block
    // pushed — but the rect below is laid out in that block's REFERENCE coords —
    // so re-apply the active UI transform: the glyphs must land (and size) where
    // the sibling widget boxes drew.
    if (typeof ctx.setTransform === "function") {
        const g = uiApp();
        if (g.ctx === ctx) {
            g.resetTransform();
            const t = currentUiTransform();
            if (t) {
                ctx.translate(t.ox, t.oy);
                ctx.scale(t.scale, t.scale);
            }
        }
    }
    ctx.font = opts.font ?? uiFont(opts.size ?? theme.fontSize, opts.bold ?? false);
    const natural = Math.ceil(measureWidth(ctx, str));
    const lineH = lineHeight(opts.size);
    const themePad = resolveThemeTextPadding(theme.textPad);
    const padLeft = opts.padX ?? opts.pad ?? themePad.left;
    const padRight = opts.padX ?? opts.pad ?? themePad.right;
    const padTop = opts.padY ?? opts.pad ?? themePad.top;
    const padBottom = opts.padY ?? opts.pad ?? themePad.bottom;
    const layout = opts.x === undefined && opts.y === undefined ? (opts.at ?? currentLayout()) : undefined;
    const wrapWidth = opts.maxWidth ??
        (opts.w !== undefined
            ? opts.w - padLeft - padRight
            : layout?.dir === "col" && layout.crossSize !== undefined
                ? layout.crossSize - padLeft - padRight
                : layout?.dir === "row"
                    ? layout.remaining - padLeft - padRight
                    : undefined);
    const autoH = opts.wrap && wrapWidth !== undefined
        ? wrapLines(ctx, str, Math.max(0, wrapWidth)).length * lineH + padTop + padBottom
        : lineH;
    const autoW = opts.wrap && opts.w === undefined && layout?.dir === "row" ? layout.remaining : undefined;
    // A self-sized slot must include the padding it will then be inset by —
    // otherwise the label is ellipsized to fit inside its OWN `theme.textPad`,
    // and every label under a theme with a non-zero textPad loses its last
    // characters to "…".
    const rect = place(opts.wrap && wrapWidth !== undefined
        ? { ...opts, w: autoW ?? opts.w, h: opts.h ?? autoH }
        : opts, natural + padLeft + padRight, autoH, "text");
    // Inset within the slot (pad shorthand + per-axis overrides). Falls back to
    // the theme's textPad (default 0 → flush) so a global inset is one setTheme.
    const bx = rect.x + padLeft;
    const bw = rect.w - padLeft - padRight;
    const by = rect.y + padTop;
    const bh = rect.h - padTop - padBottom;
    const align = opts.align ?? "left";
    const runs = toRuns(content, opts.color);
    ctx.fillStyle = resolveColor(opts.color);
    ctx.textAlign = align;
    // A known width constrains the text: it flows in a layout, or w/maxWidth was
    // given. Then align positions WITHIN the slot [bx, bx+bw] and the width
    // clamps/wraps. Without a width the position is an anchor point: `x` is where
    // the text aligns to (canvas-native), so `align:"center", x: W/2` centers on
    // W/2 rather than starting there.
    const constrained = opts.w !== undefined || opts.maxWidth !== undefined || !!currentLayout() || !!opts.at;
    const tx = constrained
        ? align === "center"
            ? bx + bw / 2
            : align === "right"
                ? bx + bw
                : bx
        : rect.x;
    const maxW = opts.maxWidth ?? (constrained ? bw : undefined);
    if (opts.wrap && maxW !== undefined) {
        const lines = wrapRuns(ctx, runs, maxW);
        const blockTop = by + (bh - lines.length * lineH) / 2;
        lines.forEach((line, i) => centeredSpans(ctx, line, tx, blockTop + i * lineH + lineH / 2, maxW));
    }
    else {
        centeredSpans(ctx, runs, tx, by + bh / 2, maxW);
    }
    ctx.restore();
}
