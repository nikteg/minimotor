// ---------- Text input ----------
// The themed text field: a canvas control backed by a hidden native <input> /
// <textarea>, mirroring the element's live caret/selection so the canvas text is
// selectable and Cmd/Ctrl+C copies it. A widget on the kernel — it evicts its
// native editor and clears its per-frame seen-set via the lifecycle hooks
// (onFrameEnd / onReset), so core never imports it back.
import { activeClip, centeredText, claimPointerGesture, currentUiApp, dragPointer, drawBox, drawFocusRing, ensureWired, focusFromPointer, focusProxies, isInOverlayPass, isOverlayActive, measureWidth, lifecycleOnce, onFrameEnd, onReset, placeField, rawPointer, registerFocusable, requiredWidgetId, resolveThemeTextPadding, uiSlot, setCursor, theme, uiCtx, uiFont, uiPointer, uiToScreen, withUiApp, wrapLines, } from "../../ui/core/index.js";
import { evictUnseenEditor, mountHiddenEditor } from "./native-editor.js";
import { pointInRect } from "../../collision/index.js";
const st = uiSlot(() => ({
    editor: null,
    seen: new Set(),
    drawnTargets: new Map(),
    pressTargets: new Map(),
}));
// Register the frame-end eviction + reset with the lifecycle the first time a
// field is drawn, so core never has to import this widget.
const ensureTextInputHooks = lifecycleOnce(() => {
    onFrameEnd(textInputEndFrame);
    onReset(resetTextInput);
});
// Canvases with the native press listener attached (one per canvas).
const pressWired = new WeakSet();
function ensureNativePress(ctx) {
    const canvas = ctx.canvas;
    if (pressWired.has(canvas))
        return;
    pressWired.add(canvas);
    const app = currentUiApp();
    // The engine's own pointerdown listener registered first (at game build), so
    // the pointer's screen-logical coords are already updated when this runs.
    canvas.addEventListener("pointerdown", () => {
        withUiApp(app, () => {
            const s = st();
            const p = rawPointer();
            for (const t of s.pressTargets.values()) {
                if (t.dead || t.opts.disabled)
                    continue;
                if (!t.rects.some((rect) => pointInRect(p.x, p.y, rect)))
                    continue;
                if (t.clip && !pointInRect(p.x, p.y, t.clip))
                    continue;
                if (s.editor?.id === t.opts.id)
                    s.editor.input.focus({ preventScroll: true });
                else
                    openTextEditor(t.opts);
                return;
            }
        });
    });
}
export function removeTextEditor() {
    const s = st();
    s.editor?.input.remove();
    s.editor = null;
}
/** Read the live caret/selection from the native element. The selection APIs
 *  throw for some input types (notably number/email) — fall back to a collapsed
 *  caret at the end so those still render sanely. */
function readSelection(el) {
    const len = el.value.length;
    try {
        return {
            start: el.selectionStart ?? len,
            end: el.selectionEnd ?? len,
            dir: el.selectionDirection ?? "none",
        };
    }
    catch {
        return { start: len, end: len, dir: "none" };
    }
}
/** Wrap `str` into visual lines top-to-bottom, honoring hard newlines and
 *  recording where each line starts in `str` (so the caret/selection can be
 *  placed in 2D). Hard lines are split on `"\n"`, then greedy-wrapped with the
 *  shared `wrapLines` helper; the char offsets are recovered by walking the
 *  original text (which `wrapLines` trims and collapses). */
function layoutLines(ctx, str, maxW) {
    const out = [];
    let base = 0; // offset of the current hard line in `str`
    for (const para of str.split("\n")) {
        let pos = 0; // scan cursor within `para`
        for (const sub of wrapLines(ctx, para, maxW)) {
            while (pos < para.length && /\s/.test(para[pos]))
                pos++;
            out.push({ text: sub, start: base + pos });
            // Consume this line's glyphs, absorbing collapsed whitespace runs so the
            // next line's start lands on its first real character.
            for (let si = 0; si < sub.length && pos < para.length;) {
                if (sub[si] === " ") {
                    while (pos < para.length && /\s/.test(para[pos]))
                        pos++;
                    si++;
                }
                else {
                    pos++;
                    si++;
                }
            }
        }
        base += para.length + 1; // + the "\n"
    }
    return out;
}
/** Char index in `str` whose boundary is nearest local x `xLocal` (measured
 *  from the text's left edge). Picks by glyph midpoint so a click lands on the
 *  closer side of a character. `ctx.font` must already be set. */
function indexAtLocalX(ctx, str, xLocal) {
    if (xLocal <= 0)
        return 0;
    let prev = 0;
    for (let i = 1; i <= str.length; i++) {
        const w = measureWidth(ctx, str.slice(0, i));
        if (xLocal < (prev + w) / 2)
            return i - 1;
        prev = w;
    }
    return str.length;
}
/** Map a pointer position to a caret index in `shown`, honoring the field's
 *  horizontal scroll (single-line) or wrapped lines (multiline). */
function caretIndexAt(ctx, shown, scrollX, multiline, rect, innerX, innerW, innerY, lineH, px, py) {
    ctx.save();
    ctx.font = uiFont();
    ctx.textAlign = "left";
    let idx;
    if (multiline) {
        const lines = layoutLines(ctx, shown, innerW);
        if (lines.length === 0) {
            ctx.restore();
            return 0;
        }
        const li = Math.max(0, Math.min(lines.length - 1, Math.floor((py - innerY) / lineH)));
        idx = lines[li].start + indexAtLocalX(ctx, lines[li].text, px - innerX);
    }
    else {
        idx = indexAtLocalX(ctx, shown, px - (innerX - scrollX));
    }
    ctx.restore();
    return idx;
}
/** The word spanning `idx` (`[start, end]`), for double-click select. Collapses
 *  to `[idx, idx]` when the click isn't on/next to a word character. */
function wordRangeAt(str, idx) {
    const word = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
    let anchor = idx;
    if (word(str[idx]))
        anchor = idx;
    else if (word(str[idx - 1]))
        anchor = idx - 1;
    else
        return [idx, idx];
    let s = anchor;
    let e = anchor + 1;
    while (s > 0 && word(str[s - 1]))
        s--;
    while (e < str.length && word(str[e]))
        e++;
    return [s, e];
}
/** Set the native element's selection so the canvas mirror updates and Cmd/Ctrl+C
 *  copies it. The selection API throws for some input types (number/email) — a
 *  failed set just leaves the control's own caret. */
function setNativeSelection(el, start, end, dir) {
    try {
        el.setSelectionRange(start, end, dir);
    }
    catch {
        // Native control still works; it keeps its own caret.
    }
}
export function openTextEditor(opts) {
    removeTextEditor();
    const multiline = opts.multiline ?? false;
    // A <textarea> owns real newline/wrap behavior for multiline; a plain <input>
    // otherwise. Both share the value/selection API the canvas mirrors.
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline)
        input.type = opts.type ?? "text";
    else
        input.rows = opts.rows ?? 4;
    input.value = opts.value;
    if (opts.maxLength !== undefined)
        input.maxLength = opts.maxLength;
    if (opts.inputMode)
        input.inputMode = opts.inputMode;
    input.autocomplete = "off";
    input.spellcheck = false;
    const editor = {
        id: opts.id,
        input,
        value: opts.value,
        changed: false,
        submitted: false,
        multiline,
        scrollX: 0,
        dragAnchor: null,
        lastReturned: opts.value,
    };
    input.addEventListener("input", () => {
        editor.value = input.value;
        editor.changed = true;
    });
    input.addEventListener("keydown", (rawEvent) => {
        const event = rawEvent;
        if (event.key === "Enter") {
            // Single-line: Enter submits. Multiline: Enter inserts a newline (the
            // native textarea default — don't preventDefault), and only Cmd/Ctrl+Enter
            // submits.
            if (!multiline || event.metaKey || event.ctrlKey) {
                editor.submitted = true;
                if (opts.blurOnSubmit ?? true)
                    input.blur();
            }
        }
        else if (event.key === "Escape") {
            input.blur();
        }
    });
    mountHiddenEditor(input, opts.ariaLabel ?? opts.placeholder ?? opts.id);
    st().editor = editor;
    input.focus({ preventScroll: true });
    // Selection APIs throw for some valid input types (notably number/email).
    try {
        input.setSelectionRange?.(input.value.length, input.value.length);
    }
    catch {
        // Native control still works; it simply chooses its own caret position.
    }
}
/** Canvas-rendered text input backed by a hidden native `<input>` (or a
 * `<textarea>` when `multiline`) for keyboard, clipboard, IME and mobile-keyboard
 * behavior. The canvas mirrors the element's live caret and selection. Returns
 * the controlled value plus one-frame `changed`/`submitted` flags:
 *
 *     const r = UI.textInput({ id: "chat", value: draft, placeholder: "Say something" });
 *     draft = r.value;
 *     if (r.submitted) { send(draft); draft = ""; } // Enter pressed this frame
 */
export function textInput(opts) {
    const ctx = uiCtx();
    ensureWired();
    ensureTextInputHooks();
    const id = requiredWidgetId(opts.id, "textInput");
    const s = st();
    s.seen.add(id);
    // `rows` sets the visible line count. rows > 1 (or an explicit `multiline`)
    // backs the field with a <textarea>; a single row stays a one-line <input>.
    // The box height derives from the row count unless `h` is given.
    const rows = Math.max(1, Math.round(opts.rows ?? (opts.multiline ? 4 : 1)));
    const multiline = rows > 1 || (opts.multiline ?? false);
    const resolvedOpts = { ...opts, id, multiline, rows };
    // Fold the row-derived height into `opts.h` before laying out: a column slot
    // takes its size from `h`, not the widget's default arg, so without this a
    // multiline field would collapse to the column's default row height and never
    // show its rows.
    const boxH = opts.h ?? (multiline ? rows * (theme.fontSize + 6) + 12 : theme.inputH);
    const rect = placeField({ ...opts, h: boxH }, opts.w ?? 180, boxH, "textInput");
    // Register this field with the native press listener (mobile keyboards need
    // a synchronous in-gesture focus — see `pressTargets`). Rect + clip stored in
    // SCREEN space so the raw pointer can hit-test them next frame.
    ensureNativePress(ctx);
    // Anything proxying for this field — a `UI.field` label — is part of the hit
    // area on BOTH paths: here for the mobile in-gesture focus, and in the
    // immediate-mode press below. The proxy drew earlier this frame, so its rect
    // is already registered by the time the field reads it.
    const proxyRects = focusProxies(id);
    {
        const toScreen = (r) => {
            const tl = uiToScreen(r.x, r.y);
            const br = uiToScreen(r.x + r.w, r.y + r.h);
            return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
        };
        s.drawnTargets.set(id, {
            rects: [rect, ...proxyRects].map(toScreen),
            clip: activeClip(),
            opts: resolvedOpts,
            dead: isOverlayActive() && !isInOverlayPass(),
        });
    }
    const keyboardFocused = registerFocusable(ctx, {
        id,
        disabled: opts.disabled,
        tabIndex: opts.tabIndex,
        native: true,
        rect,
        focus: () => {
            if (s.editor?.id === id)
                s.editor.input.focus({ preventScroll: true });
            else
                openTextEditor(resolvedOpts);
        },
        blur: () => {
            if (s.editor?.id === id)
                s.editor.input.blur();
        },
    });
    const p = uiPointer();
    const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
    // A press on the field's LABEL counts as a press on the field — but only for
    // focusing it. The caret still comes from `openTextEditor` (end of the text),
    // because a label has no character under the pointer to aim at.
    const proxied = !opts.disabled && proxyRects.some((proxy) => pointInRect(p.x, p.y, proxy));
    // The pointer is on this field if it is on the BOX or on anything proxying
    // for it. Both halves matter below: a label press has to open the editor, and
    // it must not read as the outside press that closes it — the field would
    // otherwise blur itself on the very frame its own label focused it.
    const mine = hovered || proxied;
    // An I-beam over a text field reads "you can select here" (vs the hand a
    // button asks for). The engine resets it every frame.
    //
    // The BOX only, not `mine`: a proxy rect is folded into the hit area so a
    // press on it focuses this field, and that says nothing about what the
    // pointer is standing on. Over a `UI.field` label there is no text to select
    // and no caret to place, so the I-beam is a lie; the label asks for its own
    // cursor in `field`, and it draws first, so this line would overrule it.
    if (hovered)
        setCursor("text");
    // Focus + begin selecting on PRESS (native mousedown behavior — a press-then-
    // drag selects). A press outside a focused field commits + blurs it.
    if (mine && p.pressed && !opts.disabled) {
        focusFromPointer(ctx, id);
        if (s.editor?.id === id)
            s.editor.input.focus({ preventScroll: true });
        else
            openTextEditor(resolvedOpts);
    }
    else if (p.pressed && !mine && s.editor?.id === id)
        s.editor.input.blur();
    const active = s.editor?.id === id ? s.editor : null;
    if (active) {
        active.input.disabled = opts.disabled ?? false;
        if (opts.maxLength !== undefined)
            active.input.maxLength = opts.maxLength;
        // Honor a controlled value the app set EXTERNALLY — one that differs from
        // what we handed back last frame — even while focused, so a chat box can
        // clear itself after send. Skip it on a frame the user just typed, so their
        // (not-yet-echoed) keystroke isn't clobbered.
        if (opts.value !== active.lastReturned && !active.changed) {
            active.value = opts.value;
            active.input.value = opts.value;
        }
    }
    const value = active?.value ?? opts.value;
    const focused = !!active && document.activeElement === active.input;
    const focusHover = keyboardFocused && theme.focusStyle === "hover";
    const shown = value
        ? opts.type === "password"
            ? "•".repeat(value.length)
            : value
        : focused
            ? ""
            : (opts.placeholder ?? "");
    const textPad = resolveThemeTextPadding(opts.textPad, theme.textPad);
    const innerX = rect.x + 9 + textPad.x; // base frame-safe inset plus theme text padding
    const innerY = rect.y + 4 + textPad.y;
    const innerW = Math.max(0, rect.w - 18 - textPad.x * 2);
    const lineH = theme.fontSize + 6;
    // Mouse selection: place the caret on press, extend it on drag, select a word
    // on double-press. Writing the native selection keeps the canvas mirror and
    // the clipboard (Cmd/Ctrl+C) in sync. Keyboard selection (Shift+arrows, Cmd+A)
    // already works — those keys pass straight through to the focused element.
    if (active && focused) {
        // A live drag-selection owns the pointer (no body scroll while selecting).
        if (active.dragAnchor !== null)
            claimPointerGesture();
        if (p.doublePressed && hovered) {
            // Native double-click → select the word under the pointer. Handled apart
            // from the press edge: `dblclick` fires on the second release, not down.
            const idx = caretIndexAt(ctx, shown, active.scrollX, active.multiline, rect, innerX, innerW, innerY, lineH, p.x, p.y);
            const [ws, we] = wordRangeAt(shown, idx);
            setNativeSelection(active.input, ws, we, "forward");
            active.dragAnchor = null; // a word select isn't a drag
        }
        else if (hovered && p.pressed) {
            const idx = caretIndexAt(ctx, shown, active.scrollX, active.multiline, rect, innerX, innerW, innerY, lineH, p.x, p.y);
            setNativeSelection(active.input, idx, idx, "none");
            active.dragAnchor = idx;
        }
        else if (active.dragAnchor !== null && rawPointer().down) {
            // Extend through `dragPointer` (mapped, never clip-gated) and hold the
            // drag on the RAW pointer — a selection drag that strays outside the
            // field's clip region must keep extending, not freeze mid-gesture.
            const dp = dragPointer();
            const idx = caretIndexAt(ctx, shown, active.scrollX, active.multiline, rect, innerX, innerW, innerY, lineH, dp.x, dp.y);
            const a = Math.min(active.dragAnchor, idx);
            const b = Math.max(active.dragAnchor, idx);
            setNativeSelection(active.input, a, b, idx < active.dragAnchor ? "backward" : "forward");
        }
        if (!rawPointer().down)
            active.dragAnchor = null;
    }
    ctx.save();
    drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
        fill: opts.disabled ? theme.bgActive : focusHover ? theme.bgHover : theme.bg,
        stroke: focusHover
            ? theme.accentSoft
            : focused
                ? theme.accent
                : hovered
                    ? theme.accentSoft
                    : theme.border,
        role: "input",
        state: opts.disabled
            ? "disabled"
            : focusHover
                ? "hover"
                : focused
                    ? "active"
                    : hovered
                        ? "hover"
                        : "default",
    });
    ctx.beginPath();
    ctx.rect(rect.x + 7 + textPad.x, rect.y + 2 + textPad.y, Math.max(0, rect.w - 14 - textPad.x * 2), Math.max(0, rect.h - 4 - textPad.y * 2));
    ctx.clip();
    ctx.font = uiFont();
    ctx.textAlign = "left";
    const textColor = value ? theme.text : theme.textDim;
    const blink = Math.floor(performance.now() / 500) % 2 === 0;
    if (focused && active) {
        // Mirror the native element's live caret/selection. Indices are into
        // `shown`, whose length matches the value (the password mask is 1:1).
        const sel = readSelection(active.input);
        const caretIdx = sel.dir === "backward" ? sel.start : sel.end;
        if (multiline) {
            // Wrap top-aligned, then locate the caret's line + x within it.
            const lines = layoutLines(ctx, shown, innerW);
            const top = innerY;
            // The caret's line: the last line whose start is at or before it (a caret
            // at the very end sits on the final line).
            let caretLine = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].start <= caretIdx)
                    caretLine = i;
            }
            // Selection highlight, clipped to each line's span.
            if (sel.start !== sel.end) {
                ctx.fillStyle = theme.accentSoft;
                ctx.globalAlpha = 0.4;
                for (let i = 0; i < lines.length; i++) {
                    const ls = lines[i].start;
                    const le = ls + lines[i].text.length;
                    const a = Math.max(sel.start, ls);
                    const b = Math.min(sel.end, le);
                    if (b <= a)
                        continue;
                    const ax = innerX + measureWidth(ctx, shown.slice(ls, a));
                    const bx = innerX + measureWidth(ctx, shown.slice(ls, b));
                    ctx.fillRect(ax, top + i * lineH + 2, bx - ax, lineH - 4);
                }
                ctx.globalAlpha = 1;
            }
            ctx.fillStyle = textColor;
            lines.forEach((line, i) => centeredText(ctx, line.text, innerX, top + i * lineH + lineH / 2));
            if (blink && lines.length > 0) {
                const line = lines[caretLine];
                const caretX = innerX + measureWidth(ctx, shown.slice(line.start, caretIdx));
                ctx.fillStyle = theme.accent;
                ctx.fillRect(caretX, top + caretLine * lineH + 3, 1, lineH - 6);
            }
        }
        else {
            // Single line: scroll horizontally so the caret stays inside the clip.
            const caretLocalX = measureWidth(ctx, shown.slice(0, caretIdx));
            let scroll = active.scrollX;
            if (caretLocalX - scroll > innerW)
                scroll = caretLocalX - innerW;
            if (caretLocalX - scroll < 0)
                scroll = caretLocalX;
            const maxScroll = Math.max(0, measureWidth(ctx, shown) - innerW);
            scroll = Math.max(0, Math.min(scroll, maxScroll));
            active.scrollX = scroll;
            const baseX = innerX - scroll;
            if (sel.start !== sel.end) {
                const a = baseX + measureWidth(ctx, shown.slice(0, sel.start));
                const b = baseX + measureWidth(ctx, shown.slice(0, sel.end));
                ctx.fillStyle = theme.accentSoft;
                ctx.globalAlpha = 0.4;
                ctx.fillRect(a, rect.y + 6, b - a, Math.max(4, rect.h - 12));
                ctx.globalAlpha = 1;
            }
            ctx.fillStyle = textColor;
            centeredText(ctx, shown, baseX, rect.y + rect.h / 2);
            if (blink) {
                const caretX = baseX + caretLocalX;
                ctx.fillStyle = theme.accent;
                ctx.fillRect(caretX, rect.y + 7, 1, Math.max(4, rect.h - 14));
            }
        }
    }
    else {
        // Resting (unfocused): no caret/selection. Single line ellipsizes; multiline
        // wraps top-aligned. Both are clipped to the box.
        ctx.fillStyle = textColor;
        if (multiline) {
            const top = innerY;
            shown
                .split("\n")
                .flatMap((para) => wrapLines(ctx, para, innerW))
                .forEach((line, i) => centeredText(ctx, line, innerX, top + i * lineH + lineH / 2));
        }
        else {
            centeredText(ctx, shown, innerX, rect.y + rect.h / 2, innerW);
        }
    }
    ctx.restore();
    if (keyboardFocused && !focusHover)
        drawFocusRing(ctx, rect);
    const changed = active?.changed ?? false;
    const submitted = active?.submitted ?? false;
    if (active) {
        active.lastReturned = value;
        active.changed = false;
        active.submitted = false;
    }
    return { value, changed, submitted, focused };
}
function textInputEndFrame() {
    const s = st();
    evictUnseenEditor(s, removeTextEditor);
    // Publish this frame's hit targets for the native press listener and start
    // collecting the next frame's into the (reused) old map.
    const drawn = s.drawnTargets;
    s.drawnTargets = s.pressTargets;
    s.drawnTargets.clear();
    s.pressTargets = drawn;
}
/** Reset text-input state — for tests (run via the kernel's onReset). */
function resetTextInput() {
    const s = st();
    removeTextEditor();
    s.seen.clear();
    s.drawnTargets.clear();
    s.pressTargets.clear();
}
