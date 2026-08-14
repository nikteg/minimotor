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
export declare function mountHiddenEditor(el: HTMLElement, ariaLabel: string): void;
/** The per-runtime state both native-backed widgets keep: at most one live
 *  editor, and the ids drawn this frame.
 *
 *  `seen` is a Set, not a single "last seen" id: with more than one field (or
 *  select) on screen, a later-drawn widget's id would evict an earlier focused
 *  one's editor at frame end — you could then only ever focus the last one. */
export interface NativeEditorHost<E extends {
    id: string;
}> {
    editor: E | null;
    seen: Set<string>;
}
/** Frame-end: a native editing bridge only lives while its immediate-mode
 *  widget is still submitted every frame, so drop the editor whose widget
 *  stopped drawing, then clear the per-frame set. */
export declare function evictUnseenEditor<E extends {
    id: string;
}>(host: NativeEditorHost<E>, remove: () => void): void;
