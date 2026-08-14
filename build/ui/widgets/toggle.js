// ---------- toggle ----------
import { buttonState, centeredText, consumeKeyboardActivation, drawThemeSprite, drawBox, drawFocusRing, focusFromPointer, hoverCursor, measureWidth, place, registerFocusable, theme, uiCtx, uiFont, uiPointer, widgetId, } from "../../ui/core/index.js";
import { tooltip } from "./tooltip.js";
export function toggle(optsOrLabel, onArg, rest) {
    // Label-first sugar: `muted = UI.toggle("Mute", muted)` (API_PLAN #43).
    if (typeof optsOrLabel === "string")
        return toggle({ ...rest, label: optsOrLabel, on: !!onArg });
    const opts = optsOrLabel;
    const ctx = uiCtx();
    const size = opts.size ?? 16;
    ctx.save();
    ctx.font = opts.font ?? uiFont();
    const labelW = measureWidth(ctx, opts.label);
    const w = size + theme.spacing.md + Math.ceil(labelW);
    // Hit region spans box + label, so the text is clickable too. Placed via a
    // layout, the box is vertically centered on the taller slot.
    const slot = place({ ...opts, w: opts.w, h: opts.h }, w, size, "toggle");
    const rect = {
        x: slot.x,
        y: slot.y + Math.max(0, (slot.h - size) / 2),
        w: slot.w,
        h: size,
    };
    const id = widgetId(opts.id, "toggle");
    const keyboardFocused = registerFocusable(ctx, {
        id,
        disabled: opts.disabled,
        tabIndex: opts.tabIndex,
        rect,
    });
    const state = opts.disabled ? { hover: false, clicked: false } : buttonState(rect, uiPointer());
    const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
    if (state.clicked)
        focusFromPointer(ctx, id);
    const focusHover = keyboardFocused && theme.focusStyle === "hover";
    const hover = state.hover || focusHover;
    hoverCursor(state.hover);
    if (state.hover && opts.tooltip)
        tooltip(opts.tooltip);
    const on = clicked ? !opts.on : opts.on;
    // Dim a locked/disabled checkbox AND its label so it reads as unavailable
    // (covers the box, the check, and the text — all drawn under this alpha).
    if (opts.disabled)
        ctx.globalAlpha *= 0.45;
    // Checkbox radius scales down with the theme so a big radius doesn't turn
    // the little box into a circle.
    const boxR = Math.min(theme.radius, 4);
    const radio = opts.appearance === "radio";
    const spriteName = radio ? (on ? "radioOn" : "radioOff") : on ? "checkboxOn" : "checkboxOff";
    if (!drawThemeSprite(ctx, spriteName, rect.x, rect.y, size, size)) {
        drawBox(ctx, rect.x, rect.y, size, size, {
            fill: theme.bgActive,
            stroke: hover ? theme.accent : theme.border,
            radius: radio ? size / 2 : boxR,
        });
        if (on) {
            drawBox(ctx, rect.x + theme.spacing.sm, rect.y + theme.spacing.sm, size - theme.spacing.sm * 2, size - theme.spacing.sm * 2, {
                fill: theme.accent,
                radius: radio ? size / 2 : Math.max(0, boxR - theme.spacing.xs),
            });
        }
    }
    ctx.fillStyle = opts.color ?? theme.text;
    ctx.textAlign = "left";
    centeredText(ctx, opts.label, rect.x + size + theme.spacing.md, rect.y + size / 2);
    ctx.restore();
    if (keyboardFocused && !focusHover)
        drawFocusRing(ctx, rect);
    return on;
}
