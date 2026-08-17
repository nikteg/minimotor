// ---------- button ----------
import { buttonState, centeredText, consumeKeyboardActivation, dragPayloadHeld, drawBox, drawFocusRing, focusFromPointer, hoverCursor, measureWidth, place, pointerGestureOwned, registerFocusable, resolveThemePadding, shade, theme, uiCtx, uiFont, uiPointer, widgetId, } from "../../ui/core/index.js";
import { tooltip } from "./tooltip.js";
import { pointInRect } from "../../collision/index.js";
/** Resolve a variant into (idle, hover, active) fills, border and label
 *  colors — mixing in the theme and any per-button overrides. */
function variantColors(opts) {
    const v = opts.variant ?? "default";
    let base;
    if (v === "primary") {
        base = { bg: theme.primary, label: theme.button.text.primary, border: theme.primary };
    }
    else if (v === "danger") {
        base = { bg: theme.danger, label: theme.button.text.danger, border: theme.danger };
    }
    else if (v === "ghost") {
        base = { bg: "transparent", label: theme.button.text.ghost, border: "transparent" };
    }
    else {
        base = { bg: theme.bg, label: theme.button.text.default, border: theme.border };
    }
    const solid = v === "primary" || v === "danger";
    return {
        bg: opts.bg ?? base.bg,
        bgHover: opts.bgHover ?? (v === "ghost" ? theme.bgHover : shade(base.bg, false)),
        bgActive: opts.bgActive ?? (solid ? shade(base.bg, true) : theme.bgActive),
        border: base.border,
        label: opts.color ?? base.label,
    };
}
/** The width `button` would choose for this label under the active theme.
 *
 *  For laying out AROUND a button before it is placed — a `spacer` that pushes
 *  one flush right has to know how much room to leave, and a hardcoded number
 *  is wrong the moment a skin changes button padding, min width or the font.
 *  Pass the same `font`/`size`/`bold` the button will get. */
export function buttonWidth(label, opts) {
    const ctx = uiCtx();
    const prev = ctx.font;
    ctx.font = opts?.font ?? uiFont(opts?.size ?? theme.fontSize + 2, opts?.bold ?? true);
    const padding = resolveThemePadding(theme.button.padding);
    const autoW = Math.ceil(measureWidth(ctx, label)) + padding.left + padding.right;
    ctx.font = prev;
    return theme.button.width > 0 ? theme.button.width : Math.max(autoW, theme.button.minWidth);
}
export function button(optsOrLabel, rest) {
    // Label-first sugar: `if (UI.button("Resume")) ...` (API_PLAN #43).
    if (typeof optsOrLabel === "string")
        return button({ ...rest, label: optsOrLabel });
    const opts = optsOrLabel;
    const ctx = uiCtx();
    ctx.save();
    ctx.font = opts.font ?? uiFont(opts.size ?? theme.fontSize + 2, opts.bold ?? true);
    // Auto width: the label plus comfortable padding. `buttonWidth` restates
    // this so a caller can reserve the same space before the button is placed.
    const padding = resolveThemePadding(theme.button.padding);
    const autoW = Math.ceil(measureWidth(ctx, opts.label)) + padding.left + padding.right;
    const w = opts.w ??
        (theme.button.width > 0 ? theme.button.width : Math.max(autoW, theme.button.minWidth));
    const rect = place(opts, w, opts.h ?? theme.button.height, "button");
    const id = widgetId(opts.id, "button");
    const keyboardFocused = registerFocusable(ctx, {
        id,
        disabled: opts.disabled,
        tabIndex: opts.tabIndex,
        rect,
    });
    const p = uiPointer();
    const over = pointInRect(p.x, p.y, rect);
    if (over && opts.tooltip)
        tooltip(opts.tooltip);
    const state = opts.disabled
        ? { hover: false, active: false, clicked: false }
        : buttonState(rect, p);
    // While a drag-and-drop payload is in flight the pointer is CARRYING it, not
    // pointing at controls: every button it crosses would otherwise light up and
    // compete with the drop target for the eye. Only the LOOK is suppressed —
    // `clicked` below is untouched, so a button that is also a drag source still
    // clicks when the pointer is released on it without a drag starting.
    const carrying = dragPayloadHeld();
    const pointerHover = state.hover && !carrying;
    const focusHover = keyboardFocused && theme.focusStyle === "hover";
    const hover = pointerHover || focusHover;
    const active = state.active && !carrying;
    // A slider or another drag widget owns the pointer until its release frame
    // finishes. Do not let the release land on a button underneath the drag;
    // the drag's origin, not its final position, owns that gesture.
    const clicked = (!pointerGestureOwned() && state.clicked) || (!opts.disabled && consumeKeyboardActivation(id));
    if (state.clicked)
        focusFromPointer(ctx, id);
    hoverCursor(pointerHover);
    const c = variantColors(opts);
    const fill = opts.disabled ? theme.bgActive : active ? c.bgActive : hover ? c.bgHover : c.bg;
    // Hover lifts the border to the accent, except on filled variants (their
    // border already matches the fill — an accent ring would clash).
    const filled = c.bg !== "transparent" && c.border === c.bg;
    const stroke = c.border === "transparent" && !hover ? undefined : hover && !filled ? theme.accent : c.border;
    drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
        fill: fill === "transparent" ? undefined : fill,
        stroke,
        radius: opts.radius,
        role: opts.skin === false ? undefined : "button",
        state: opts.disabled ? "disabled" : active ? "active" : hover ? "hover" : "default",
        variant: opts.variant ?? "default",
    });
    ctx.fillStyle = opts.disabled ? theme.button.text.disabled : c.label;
    ctx.textAlign = "center";
    centeredText(ctx, opts.label, rect.x + rect.w / 2, rect.y + rect.h / 2 + (active ? 1 : 0), rect.w - 12);
    ctx.restore();
    if (keyboardFocused && !focusHover)
        drawFocusRing(ctx, rect);
    return clicked;
}
