// ---------- Select dropdown ----------
// The themed <select>: a canvas control backed by a hidden native <select>
// (for accessibility + native keyboard), whose drop menu is a deferred canvas
// overlay. A widget on the kernel — it drives the shared focus machine and hangs
// its deferred menu draw + editor cleanup off the frame loop via the kernel's
// lifecycle hooks (onOverlayPass / onFrameEnd / onReset), so core never imports
// it back.
import { captureOverlay, centeredText, consumeKeyboardActivation, consumeKeyboardCommand, buttonState, drawBox, currentUiTransform, dragPointer, drawFocusRing, drawThemeSprite, ensureWired, enterOverlay, focusFromPointer, hoverCursor, lifecycleOnce, layoutCaptureActive, popLayoutOverlay, popLayoutParent, pushLayoutOverlay, pushLayoutParent, recordLayout, markFocusableOverlay, onFrameEnd, onOverlayPass, onReset, placeField, pointerGestureOwned, popUiTransform, pushUiTransform, registerFocusable, requiredWidgetId, uiSlot, fitAnchored, theme, uiCtx, uiFont, uiHeight, uiPointer, uiWidth, ellipsize, resolveThemePadding, resolveThemeTextPadding, wrapLines, withTheme, } from "../../ui/core/index.js";
import { dismissedByOutsideRelease, list, scrollGestureActive } from "./lists.js";
import { listMetrics } from "./list-metrics.js";
import { evictUnseenEditor, mountHiddenEditor } from "./native-editor.js";
import { paintFrame } from "./panel.js";
import { pointInRect } from "../../collision/index.js";
import { clamp } from "../../math/mathf.js";
const st = uiSlot(() => ({
    editor: null,
    seen: new Set(),
    request: null,
    commit: null,
}));
function flattenOptions(opts) {
    if (opts.groups)
        return opts.groups.flatMap((group) => group.options);
    return opts.options ?? [];
}
function menuEntries(opts) {
    if (!opts.groups) {
        return opts.options.map((option, optionIndex) => ({ kind: "option", optionIndex, option }));
    }
    const entries = [];
    let optionIndex = 0;
    for (const group of opts.groups) {
        entries.push({ kind: "group", label: group.label });
        for (const option of group.options) {
            entries.push({ kind: "option", optionIndex, option });
            optionIndex++;
        }
    }
    return entries;
}
// The select hangs a deferred menu draw + editor cleanup off the frame loop.
// Register those with the lifecycle the first time a select is drawn, so core
// never has to import this widget.
const ensureSelectHooks = lifecycleOnce(() => {
    onOverlayPass(drawSelectOverlay);
    onFrameEnd(selectEndFrame);
    onReset(resetSelect);
});
export function removeSelectEditor() {
    const s = st();
    s.editor?.select.remove();
    s.editor = null;
}
export function openSelectEditor(opts, index, menuOpen = true) {
    removeSelectEditor();
    const select = document.createElement("select");
    if (opts.groups) {
        let optionIndex = 0;
        for (const group of opts.groups) {
            const optgroup = document.createElement("optgroup");
            optgroup.label = group.label;
            for (const option of group.options) {
                const nativeOption = document.createElement("option");
                nativeOption.value = String(optionIndex++);
                nativeOption.textContent = option.label;
                nativeOption.disabled = option.disabled ?? false;
                optgroup.appendChild(nativeOption);
            }
            select.appendChild(optgroup);
        }
    }
    else {
        for (let i = 0; i < opts.options.length; i++) {
            const option = document.createElement("option");
            option.value = String(i);
            option.textContent = opts.options[i].label;
            option.disabled = opts.options[i].disabled ?? false;
            select.appendChild(option);
        }
    }
    select.value = index >= 0 ? String(index) : "";
    const editor = {
        id: opts.id,
        select,
        index,
        changed: false,
        open: menuOpen,
        justOpened: menuOpen,
        scroll: 0,
        lastIndex: index,
    };
    select.addEventListener("change", () => {
        editor.index = Number(select.value);
        editor.changed = true;
    });
    select.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            editor.open = !editor.open;
            editor.justOpened = editor.open;
        }
        else if (event.key === "Escape") {
            editor.open = false;
            select.blur();
        }
    });
    mountHiddenEditor(select, opts.ariaLabel ?? opts.id);
    st().editor = editor;
    select.focus({ preventScroll: true });
}
// Step `index` to the next non-disabled option in `dir`, clamped at the ends.
function nextEnabled(options, index, dir) {
    let i = index;
    for (let step = 0; step < options.length; step++) {
        const candidate = i + dir;
        if (candidate < 0 || candidate >= options.length)
            break;
        i = candidate;
        if (!options[i].disabled)
            return i;
    }
    return index >= 0 ? index : dir > 0 ? Math.min(0, options.length - 1) : options.length - 1;
}
// Feed a focus-machine command (from padNav's dpad, or a keyboard fallback) to
// the focused select: move the highlighted option by one, opening a closed
// select on a vertical nudge so the change is visible. Returns whether the
// command was ours.
function handleSelectCommand(opts, currentIndex) {
    const cmd = consumeKeyboardCommand(opts.id);
    if (!cmd)
        return;
    const dir = cmd === "ArrowDown" || cmd === "ArrowRight" ? 1 : -1;
    const vertical = cmd === "ArrowDown" || cmd === "ArrowUp";
    const s = st();
    if (s.editor?.id !== opts.id)
        openSelectEditor(opts, currentIndex, vertical);
    else if (vertical && !s.editor.open) {
        s.editor.open = true;
        s.editor.justOpened = true;
    }
    const editor = st().editor;
    if (!editor)
        return;
    const from = editor.index >= 0 ? editor.index : currentIndex;
    const next = nextEnabled(opts.options, from, dir);
    if (next !== editor.index) {
        editor.index = next;
        editor.select.value = String(next);
        editor.changed = true;
    }
}
/** Themed dropdown backed by a hidden native `<select>`. Clicking opens a
 * canvas option list; focused keyboard arrows (native) and gamepad d-pad/stick
 * (via the focus machine) update the same controlled value. Controlled: pass
 * `value` in, assign the result's `value` back:
 *
 *     mode = UI.select({
 *       id: "mode",
 *       value: mode,
 *       options: [{ label: "Easy", value: "easy" }, { label: "Hard", value: "hard" }],
 *     }).value;
 */
export function select(opts) {
    const ctx = uiCtx();
    ensureWired();
    ensureSelectHooks();
    const id = requiredWidgetId(opts.id, "select");
    const options = flattenOptions(opts);
    const resolvedOpts = { ...opts, id, options };
    const s = st();
    s.seen.add(id);
    const rect = placeField(opts, opts.w ?? 180, opts.h ?? theme.inputH, "select", true);
    const currentIndex = options.findIndex((option) => Object.is(option.value, opts.value));
    const keyboardFocused = registerFocusable(ctx, {
        id,
        disabled: opts.disabled,
        tabIndex: opts.tabIndex,
        native: true,
        rect,
        focus: () => {
            if (s.editor?.id === id)
                s.editor.select.focus({ preventScroll: true });
            else
                openSelectEditor(resolvedOpts, currentIndex, false);
        },
        blur: () => {
            if (s.editor?.id === id) {
                s.editor.open = false;
                s.editor.select.blur();
            }
        },
    });
    // With our menu open the ordinary `uiPointer` is dead (we're the overlay's
    // background), so read the ungated `dragPointer` instead — still mapped into
    // the active UI transform's reference coords, which is the space `rect` is
    // in. (The RAW pointer would be in screen coords and miss the control by the
    // UI scale — clicking the control then couldn't close its own menu.)
    const p = s.editor?.id === id ? dragPointer() : uiPointer();
    const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
    const focusHover = keyboardFocused && theme.focusStyle === "hover";
    if (hovered)
        hoverCursor(true);
    // Toggle on release — but never on the release that merely ENDS a scroll
    // drag or a widget drag (`p` is the raw pointer while our menu is open, so
    // it ignores edge suppression): a swipe in the drop menu that lifts over the
    // control must not close the menu it just scrolled.
    if (hovered && p.released && !opts.disabled && !scrollGestureActive() && !pointerGestureOwned()) {
        focusFromPointer(ctx, id);
        if (s.editor?.id === id) {
            s.editor.open = !s.editor.open;
            s.editor.justOpened = s.editor.open;
            s.editor.select.focus({ preventScroll: true });
        }
        else
            openSelectEditor(resolvedOpts, currentIndex);
    }
    // Gamepad navigation (keyboard runs through the native <select>): padNav feeds
    // A → activation and d-pad/stick → arrow commands to the focused widget.
    if (!opts.disabled) {
        if (consumeKeyboardActivation(id)) {
            if (s.editor?.id === id) {
                s.editor.open = !s.editor.open;
                s.editor.justOpened = s.editor.open;
            }
            else
                openSelectEditor(resolvedOpts, currentIndex, true);
        }
        handleSelectCommand(resolvedOpts, currentIndex);
    }
    let editor = s.editor?.id === id ? s.editor : null;
    const committed = s.commit?.id === id ? s.commit.index : -1;
    if (committed >= 0)
        s.commit = null;
    let value = committed >= 0
        ? (options[committed]?.value ?? opts.value)
        : editor && editor.index >= 0
            ? (options[editor.index]?.value ?? opts.value)
            : opts.value;
    let changed = committed >= 0 || (editor?.changed ?? false);
    const selected = options.find((option) => Object.is(option.value, value));
    ctx.save();
    drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
        fill: opts.disabled ? theme.bgActive : focusHover ? theme.bgHover : theme.bg,
        stroke: focusHover
            ? theme.accentSoft
            : editor
                ? theme.accent
                : hovered
                    ? theme.accentSoft
                    : theme.border,
        // A select is an input control, not a button: themed skins often provide
        // different nine-slice art and native dimensions for the two surfaces.
        role: "input",
        state: opts.disabled
            ? "disabled"
            : focusHover
                ? "hover"
                : editor
                    ? "active"
                    : hovered
                        ? "hover"
                        : "default",
    });
    ctx.font = uiFont();
    ctx.fillStyle = selected ? theme.text : theme.textDim;
    ctx.textAlign = "left";
    const textPad = resolveThemeTextPadding(opts.textPad, theme.textPad);
    const baseTextX = theme.spacing.lg - 2;
    const arrowSpace = theme.spacing.lg * 2 + theme.spacing.md;
    centeredText(ctx, selected?.label ?? opts.placeholder ?? "Select…", rect.x + baseTextX + textPad.x, rect.y + textPad.y + (rect.h - textPad.y * 2) / 2, Math.max(1, rect.w - arrowSpace - textPad.x * 2));
    const arrow = theme.skin?.sprites.icons?.selectArrow;
    if (arrow) {
        const arrowH = Math.min(rect.h - 8, arrow.region.sh);
        const arrowW = Math.min(theme.spacing.xl, (arrow.region.sw / arrow.region.sh) * arrowH);
        drawThemeSprite(ctx, "selectArrow", rect.x + rect.w - arrowW - theme.spacing.sm, rect.y + (rect.h - arrowH) / 2, arrowW, arrowH);
    }
    else {
        ctx.fillStyle = theme.textDim;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.w - 20, rect.y + rect.h / 2 - 3);
        ctx.lineTo(rect.x + rect.w - 10, rect.y + rect.h / 2 - 3);
        ctx.lineTo(rect.x + rect.w - 15, rect.y + rect.h / 2 + 3);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    if (keyboardFocused && !focusHover)
        drawFocusRing(ctx, rect);
    if (editor?.open) {
        markFocusableOverlay(id);
        // Defer the menu until frame-end so siblings drawn later in the callback
        // layout cannot paint over it. Input is still captured immediately.
        // The overlay pass runs AFTER any enclosing `UI.scaled` block has popped,
        // so snapshot the transform alongside the rect and let the pass restore
        // it: the menu then anchors under the control AND zooms with it (rows,
        // labels and hit-testing all in the control's own space).
        captureOverlay();
        const t = currentUiTransform();
        s.request = {
            ctx,
            opts: resolvedOpts,
            rect,
            transform: t ? { ...t, w: uiWidth(), h: uiHeight() } : null,
            theme,
        };
        editor.changed = false;
    }
    return { value, changed, open: !!editor?.open };
}
export function drawSelectOverlay() {
    const s = st();
    const request = s.request;
    s.request = null;
    if (!request || !s.editor?.open || s.editor.id !== request.opts.id)
        return;
    // The normal draw pass captured the background already; only now does the
    // deferred menu become the live side of the overlay boundary.
    enterOverlay();
    // ...and the layout capture's side of the same boundary: an open menu paints
    // over whatever the frame already drew, which is the widget working and not
    // the fault `paintIssues` hunts for. The scope covers BOTH branches below.
    pushLayoutOverlay();
    try {
        drawSelectOverlayPass(request);
    }
    finally {
        popLayoutOverlay();
    }
}
function drawSelectOverlayPass(request) {
    // The overlay pass runs inside this runtime's frame end, so the ambient
    // context already points at the canvas the select was drawn on — but every
    // `UI.scaled` block has popped by now, canvas-side and pointer-side. Restore
    // the transform the control drew under so the menu matches it.
    const t = request.transform;
    const ctx = request.ctx;
    if (!t) {
        withTheme(request.theme, () => drawSelectMenu(ctx, request.opts, request.rect));
        return;
    }
    ctx.save();
    ctx.translate(t.ox, t.oy);
    ctx.scale(t.scale, t.scale);
    // The overlay pass is at the root (no enclosing transform to compose with),
    // so the snapshot's absolute offset goes in as-is.
    pushUiTransform(t.scale, t.ox, t.oy, t.w, t.h);
    try {
        withTheme(request.theme, () => drawSelectMenu(ctx, request.opts, request.rect));
    }
    finally {
        popUiTransform();
        ctx.restore();
    }
}
/** The `theme.select` label color for one row state. Shared by the plain and
 *  the wrapped painter so a wrapped menu can't drift from a normal one. */
function selectRowLabelColor(disabled, selected) {
    if (disabled)
        return theme.select.textDisabled;
    return selected ? theme.select.textSelected : theme.select.text;
}
/** Paint one option row and report a click on it.
 *
 *  Deliberately NOT a `button()`: menu rows only ever looked like buttons
 *  because that was the nearest widget to hand, which left them wearing the
 *  primary/ghost variants — so restyling a call-to-action moved the dropdown
 *  highlight, and `button`'s hard-wired disabled fill and hover border ring
 *  were unreachable from a theme. Rows now read `theme.select` directly. They
 *  are also not focusable: the open menu is driven by the native `<select>`
 *  behind it, so putting every row in the tab order would fight it. */
function selectRow(ctx, rect, label, disabled, selected) {
    // Rows used to appear in the layout tree as `button`s, because they used to
    // BE buttons. They are their own kind now — the menu is windowed by `list`,
    // so no `place()` call records them.
    if (layoutCaptureActive)
        recordLayout("selectOption", undefined, rect);
    const s = theme.select;
    const state = disabled
        ? { hover: false, active: false, clicked: false }
        : buttonState(rect, uiPointer());
    hoverCursor(state.hover);
    const fill = disabled
        ? s.bgDisabled
        : selected
            ? state.active
                ? s.bgSelectedActive
                : state.hover
                    ? s.bgSelectedHover
                    : s.bgSelected
            : state.active
                ? s.bgActive
                : state.hover
                    ? s.bgHover
                    : s.bg;
    if (fill !== "transparent") {
        ctx.save();
        ctx.fillStyle = fill;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
    }
    if (label) {
        ctx.save();
        ctx.font = uiFont(theme.fontSize + 2, true);
        ctx.fillStyle = selectRowLabelColor(disabled, selected);
        ctx.textAlign = "center";
        centeredText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2 + (state.active ? 1 : 0), rect.w - 12);
        ctx.restore();
    }
    return state.clicked;
}
function drawWrappedSelectLabel(ctx, option, rect, selected) {
    ctx.save();
    ctx.font = uiFont(theme.fontSize + 2, true);
    ctx.fillStyle = selectRowLabelColor(option.disabled, selected);
    ctx.textAlign = "center";
    const maxW = Math.max(1, rect.w - 12);
    const lineH = theme.fontSize + 8;
    const maxLines = Math.max(1, Math.floor((rect.h - 4) / lineH));
    const lines = wrapLines(ctx, option.label, maxW);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = ellipsize(ctx, `${lines[maxLines - 1]}…`, maxW);
    }
    const blockH = lines.length * lineH;
    const top = rect.y + (rect.h - blockH) / 2;
    for (let i = 0; i < lines.length; i++) {
        centeredText(ctx, lines[i], rect.x + rect.w / 2, top + i * lineH + lineH / 2, maxW);
    }
    ctx.restore();
}
function drawSelectMenu(ctx, opts, rect) {
    const editor = st().editor;
    // Ungated (we own the overlay) but mapped through the restored transform, so
    // it compares against `rect`/`menu` in the coords they're laid out in.
    const p = dragPointer();
    const value = editor.index >= 0 ? opts.options[editor.index]?.value : opts.value;
    const entries = menuEntries(opts);
    const count = entries.length;
    // Group headers count toward the visible window, while `maxVisible` still
    // means selectable option rows. Each entry's height is measured below, so a
    // short label occupies one line and a wrapped label gets only the space it
    // actually needs.
    const requestedPad = opts.menuPad ?? theme.panel.padding;
    const menuPad = resolveThemePadding(requestedPad);
    // Keep a tiny usable body for unusually narrow controls instead of allowing
    // negative list dimensions when a theme's frame padding is larger than the
    // select width.
    const padLeft = Math.max(0, menuPad.left);
    const padRight = Math.max(0, menuPad.right);
    const padTop = Math.max(0, menuPad.top);
    const padBottom = Math.max(0, menuPad.bottom);
    const contentW = Math.max(1, rect.w - padLeft - padRight);
    const lineH = theme.fontSize + 8;
    // A skinned group header is a decorative STRIP, and strips are usually fixed-
    // height plates: their whole height is the nine-slice's repeating band (top
    // and bottom insets of 0), so a row taller than the art tiles a second copy
    // of the plate under the first — Tiny RPG's 24px alt title strip in a 32px
    // row shows 8px of a second plate, complete with its end caps. Give the row
    // the art's own height, floored at the text height so a short strip still
    // clears its label. Without a skin the header is plain text and keeps the
    // roomier `lineH + 8`.
    const groupArtH = theme.skin?.frames.menuGroup?.sh;
    const groupH = groupArtH === undefined ? lineH + 8 : Math.max(lineH, groupArtH);
    const itemHeights = (() => {
        ctx.save();
        ctx.font = uiFont(theme.fontSize + 2, true);
        const maxW = Math.max(1, contentW - 26);
        const heights = entries.map((entry) => {
            if (entry.kind === "group")
                return groupH;
            if (!opts.wrapItems)
                return lineH + 8;
            return Math.max(lineH + 8, wrapLines(ctx, entry.option.label, maxW).length * lineH + 8);
        });
        ctx.restore();
        return heights;
    })();
    const metrics = listMetrics(count, (index) => itemHeights[index]);
    const visibleOptions = Math.max(1, opts.maxVisible ?? 8);
    let visibleEntries = 0;
    let visibleOptionCount = 0;
    while (visibleEntries < count) {
        const entry = entries[visibleEntries];
        if (entry.kind === "option" && visibleOptionCount >= visibleOptions)
            break;
        visibleEntries++;
        if (entry.kind === "option")
            visibleOptionCount++;
    }
    let listH = metrics.tops[visibleEntries] ?? 0;
    if (listH <= 0)
        listH = lineH + 8;
    const menuH = listH + padTop + padBottom;
    const gap = 2;
    const menuPos = fitAnchored({ x: rect.x, y: rect.y + rect.h + gap, w: rect.w, h: menuH }, rect.y - menuH - gap, 4);
    const menu = { x: menuPos.x, y: menuPos.y, w: rect.w, h: menuH };
    // The menu's own box, which nothing recorded before: its rows appeared in the
    // capture with the `clip` inside `list` for a parent and no sign of the frame
    // they sat in. Recorded before the frame is painted so the paint clock credits
    // the frame to it, and opened as a parent so the rows hang off it.
    const captured = layoutCaptureActive;
    if (captured) {
        recordLayout("selectMenu", opts.id, menu, { pinned: true });
        pushLayoutParent();
    }
    ctx.save();
    ctx.fillStyle = theme.bgActive;
    ctx.fillRect(menu.x, menu.y, menu.w, menu.h);
    ctx.restore();
    paintFrame(ctx, { ...menu, bg: theme.bgActive });
    // Keep the highlighted option in view: center it when the menu just opened,
    // and snap to it when the keyboard (native <select>) moved the selection.
    // Otherwise leave the offset alone so wheel/drag scrolling isn't fought.
    const selectedEntry = entries.findIndex((entry) => entry.kind === "option" && entry.optionIndex === editor.index);
    const max = Math.max(0, metrics.content - listH);
    if (editor.justOpened) {
        const selectedTop = selectedEntry >= 0 ? metrics.tops[selectedEntry] : 0;
        const selectedH = selectedEntry >= 0 ? itemHeights[selectedEntry] : lineH + 8;
        editor.scroll = clamp(selectedTop - (listH - selectedH) / 2, 0, max);
    }
    else if (editor.index !== editor.lastIndex && editor.index >= 0) {
        const top = selectedEntry >= 0 ? metrics.tops[selectedEntry] : 0;
        const selectedH = selectedEntry >= 0 ? itemHeights[selectedEntry] : lineH + 8;
        if (top < editor.scroll)
            editor.scroll = top;
        else if (top + selectedH > editor.scroll + listH)
            editor.scroll = top + selectedH - listH;
        editor.scroll = clamp(editor.scroll, 0, max);
    }
    editor.lastIndex = editor.index;
    // The menu is a windowed `list` scroll region: scrollbar + wheel + swipe, only
    // the visible options drawn. The row callback paints one option row.
    let picked = -1;
    editor.scroll = list({
        x: menu.x + padLeft,
        y: menu.y + padTop,
        w: Math.max(1, menu.w - padLeft - padRight),
        h: listH,
        rowH: (index) => itemHeights[index],
        count,
        offset: editor.scroll,
        id: `${opts.id}:menu`,
    }, (i, r) => {
        const entry = entries[i];
        if (entry.kind === "group") {
            // A skin that names `menuGroup` gets its strip drawn behind the label;
            // without one the header stays plain text, as it always was.
            if (theme.skin?.frames.menuGroup) {
                drawBox(ctx, r.x, r.y, r.w, r.h, { role: "menuGroup" });
            }
            ctx.save();
            ctx.font = uiFont(theme.fontSize, true);
            ctx.fillStyle = theme.select.groupLabel;
            ctx.textAlign = "center";
            centeredText(ctx, entry.label, r.x + r.w / 2, r.y + r.h / 2, r.w - 4);
            ctx.restore();
            return;
        }
        const option = entry.option;
        const selectedOption = Object.is(option.value, value);
        // Wrapped labels are drawn below, after the row paints its fill.
        const clicked = selectRow(ctx, r, opts.wrapItems ? "" : option.label, option.disabled, selectedOption);
        if (opts.wrapItems)
            drawWrappedSelectLabel(ctx, option, r, selectedOption);
        if (clicked)
            picked = entry.optionIndex;
    });
    // Closed here rather than at the end of the function: everything the menu
    // draws is inside `list`, and the three paths below all `return`, which would
    // leave the capture's parent stack open into the next frame.
    if (captured)
        popLayoutParent();
    if (picked >= 0) {
        editor.index = picked;
        editor.select.value = String(picked);
        editor.open = false;
        st().commit = { id: opts.id, index: picked }; // observed by select() next draw
        return;
    }
    // Close on a click outside the menu AND the control that opened it. (The
    // frame the menu opens is exempt: that press is what opened it.)
    if (!editor.justOpened && dismissedByOutsideRelease(p, rect, menu)) {
        removeSelectEditor();
        return;
    }
    editor.justOpened = false;
}
// Called by frame's onFrame housekeeping.
export function selectEndFrame() {
    evictUnseenEditor(st(), removeSelectEditor);
}
/** Reset all select state — for tests (see frame `_reset`). */
export function resetSelect() {
    const s = st();
    removeSelectEditor();
    s.seen.clear();
    s.request = null;
    s.commit = null;
}
