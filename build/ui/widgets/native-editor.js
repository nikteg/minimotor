// ---------- Hidden native editor ----------
// The shared half of the two native-backed widgets, `select` and `textInput`.
// Both park a REAL DOM element offscreen so the browser supplies what a canvas
// cannot — keyboard handling, IME composition, clipboard, and on mobile the
// on-screen keyboard or option picker — while the canvas draws the control that
// mirrors it. Everything specific to a field or a dropdown stays in those files;
// what lives here is the element's lifetime.
//
// Internal, like `panel.ts`: not re-exported from `widgets/index.ts`.
/** Park `el` offscreen, name it for assistive tech and add it to the document.
 *
 *  Offscreen rather than `display: none` or `visibility: hidden` — a hidden
 *  element cannot take focus, and focus is the entire point: it is what routes
 *  keystrokes, IME composition and the mobile keyboard to this element. It
 *  stays out of the tab order (`tabIndex = -1`) because the canvas runs its own
 *  focus machine, and out of pointer hit-testing so clicks reach the canvas.
 *
 *  Focusing is left to the caller, which does it AFTER storing its editor —
 *  a focus handler that ran first would see state that isn't there yet. */
export function mountHiddenEditor(el, ariaLabel) {
    guardEditorFocus();
    el.setAttribute("aria-label", ariaLabel);
    el.tabIndex = -1;
    el.dataset.minimotorUi = "true";
    Object.assign(el.style, {
        position: "fixed",
        left: "-1000px",
        top: "0",
        // A REAL box, not the 1×1 that offscreen-input recipes usually suggest:
        // Chromium copies nothing from a selection with no rendered width, so
        // Cmd/Ctrl+C and Cmd/Ctrl+X silently did nothing (paste was unaffected,
        // which is what made it easy to miss). `position: fixed` keeps this size
        // out of layout — the document's scroll extent doesn't change.
        width: "320px",
        height: "48px",
        opacity: "0",
        pointerEvents: "none",
    });
    document.body.appendChild(el);
}
/** How long after a field is focused a blur is treated as the browser's doing
 *  rather than the player's — see {@link guardEditorFocus}.
 *
 * The measured gap between the finger lifting and the stray blur was about a
 * fifth of a second, which is the keyboard's open animation. Half a second
 * clears that and is still far short of anybody deliberately tapping Done. */
const FOCUS_GRACE_MS = 500;
/** A ceiling on rescues per opening, so a browser that insists on blurring
 *  cannot turn this into an endless focus fight. Two is one more than has ever
 *  been observed. */
const MAX_RESCUES = 2;
let focusGuarded = false;
/** Keep iOS from closing the on-screen keyboard the instant a finger lifts.
 *
 * ## The bug
 *
 * On an iPhone, tapping a canvas text field opened the keyboard and closed it
 * again on release, so nothing could be typed. Holding the finger down kept it
 * open. This is the SECOND half of that story: the `preventDefault` on the
 * press listener in `text-input.ts` fixed the case where the browser moved
 * focus during the gesture, and this fixes the one where it moves it after.
 *
 * ## What it is not, all measured on the device
 *
 * Traced live on an iPhone by painting pointer, focus and viewport events onto
 * the page, since a phone has no console to read:
 *
 *     DOWN 48,201   iH=626 vvH=626 vvTop=0 scale=1.00
 *     FOCUSIN INPUT fs=16px
 *     UP   48,201   iH=626 vvH=626 vvTop=0 scale=1.00
 *     vvRESIZE      iH=403 vvH=403
 *     FOCUSOUT INPUT inDoc=1
 *     FOCUSIN CANVAS
 *
 * Four candidate causes were tested on the device and every one is ruled out:
 *
 * - **Not the release landing elsewhere.** `DOWN` and `UP` report the same
 *   point, and neither `vvTop` nor `scale` moves between them.
 * - **Not the iOS focus zoom.** `scale` never leaves 1.00. (A field under 16px
 *   does trigger that zoom, and an author should set one; it was not firing.)
 * - **Not the host's resize handling.** The keyboard drops
 *   `window.innerHeight` from 626 to 403 and the canvas is sized off that;
 *   swallowing the `resize` before the engine saw it changed nothing.
 * - **Not a `focus()` call.** `canvas.focus` was patched to log its caller and
 *   never fired. `focusFromPointer` already declines to touch the canvas for a
 *   native-backed widget.
 *
 * What remains is the browser moving focus by itself, to the element the finger
 * touched, once the keyboard has settled. `inDoc=1` on the way out, so nothing
 * had torn the element down — it was simply blurred.
 *
 * ## The fix, and its one condition
 *
 * Put the focus back. The keyboard is already open by then, so this is not
 * asking iOS to open one outside a user gesture — the thing iOS refuses, and
 * the reason several tidier-looking fixes cannot work.
 *
 * **Only for a moment after the field was opened**, which is the whole design.
 * An unconditional trap is worse than the bug: every legitimate blur — the
 * keyboard's Done button, Escape, Enter, tapping another widget — would be
 * undone and the keyboard could never be dismissed. The stray focus lands
 * inside the keyboard's animation, so a short window catches it and leaves
 * every later blur alone.
 *
 * Installed on the first editor ever mounted, and listens on the document, so
 * it costs one pair of listeners for the life of the page and nothing at all
 * for an app with no text input. On a desktop no stray blur arrives and none of
 * this fires. */
function guardEditorFocus() {
    if (focusGuarded || typeof document === "undefined")
        return;
    focusGuarded = true;
    let openedAt = 0;
    let rescues = 0;
    /** Set while a rescue's own `focus()` is landing.
     *
     * **Without this the guard cannot give up.** The rescue re-focuses the
     * editor, which fires `focusin`, which would reset the window and the
     * counter — so a browser that blurs on every attempt would be answered
     * forever, and both the grace window and the ceiling below would be dead
     * code. Only a focus the guard did NOT cause counts as a fresh opening. */
    let rescuing = false;
    const isEditor = (node) => node instanceof HTMLElement && node.dataset.minimotorUi === "true";
    document.addEventListener("focusin", (event) => {
        if (!isEditor(event.target))
            return;
        if (rescuing) {
            rescuing = false;
            return;
        }
        openedAt = performance.now();
        rescues = 0;
    }, true);
    document.addEventListener("focusout", (event) => {
        const editor = event.target;
        if (!isEditor(editor))
            return;
        // Gone from the page: the widget stopped drawing and `evictUnseenEditor`
        // removed it. That is a real teardown, not a stray blur.
        if (!document.contains(editor))
            return;
        if (performance.now() - openedAt > FOCUS_GRACE_MS)
            return;
        if (rescues >= MAX_RESCUES)
            return;
        rescues++;
        // On the next task rather than synchronously: the browser is part-way
        // through moving focus, and re-focusing inside its own `focusout` is
        // undone by the rest of that move.
        setTimeout(() => {
            if (!document.contains(editor))
                return;
            rescuing = true;
            editor.focus({ preventScroll: true });
            // Cleared here as well as in the handler: if the focus did not take,
            // no `focusin` arrives and the flag would swallow the next real one.
            rescuing = false;
        }, 0);
    }, true);
}
/** Frame-end: a native editing bridge only lives while its immediate-mode
 *  widget is still submitted every frame, so drop the editor whose widget
 *  stopped drawing, then clear the per-frame set. */
export function evictUnseenEditor(host, remove) {
    if (host.editor && !host.seen.has(host.editor.id))
        remove();
    host.seen.clear();
}
