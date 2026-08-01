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
export function mountHiddenEditor(el: HTMLElement, ariaLabel: string): void {
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

/** The per-runtime state both native-backed widgets keep: at most one live
 *  editor, and the ids drawn this frame.
 *
 *  `seen` is a Set, not a single "last seen" id: with more than one field (or
 *  select) on screen, a later-drawn widget's id would evict an earlier focused
 *  one's editor at frame end — you could then only ever focus the last one. */
export interface NativeEditorHost<E extends { id: string }> {
  editor: E | null;
  seen: Set<string>;
}

/** Frame-end: a native editing bridge only lives while its immediate-mode
 *  widget is still submitted every frame, so drop the editor whose widget
 *  stopped drawing, then clear the per-frame set. */
export function evictUnseenEditor<E extends { id: string }>(
  host: NativeEditorHost<E>,
  remove: () => void,
): void {
  if (host.editor && !host.seen.has(host.editor.id)) remove();
  host.seen.clear();
}
