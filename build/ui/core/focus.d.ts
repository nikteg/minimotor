import { type GamepadState } from "../../input/gamepad.js";
import type { App } from "../../engine/index.js";
export interface FocusEntry {
    id: string;
    disabled: boolean;
    overlay: boolean;
    tabIndex: number;
    native: boolean;
    /** Where the widget drew, in SCREEN-logical coords — so a scroll region can
     *  bring a keyboard-focused widget into view (see `focusReveal`). */
    rect?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    focus?: () => void;
    blur?: () => void;
}
/** A rect drawn by one widget that counts as a press on ANOTHER — a
 *  `UI.field` label standing in for the input it labels. Registered in the
 *  coords the proxy drew in, and only for the current frame. */
export interface FocusProxy {
    id: string;
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
}
/** Add an unregistered custom UI navigation pad. Hardware and engine-created
 * on-screen pads are discovered automatically, so most games never need this.
 * Pass `null` to remove the custom pad. Per app. */
export declare function setNavPad(pad: GamepadState | null): void;
/** Whether a connected navigation pad is being used right now. This is an
 * input-modality hint for overlays, not merely a connection check: an idle
 * controller should not make a newly opened modal paint a focus ring. */
export declare function hasActiveNavPad(): boolean;
export declare function focusCandidates(): FocusEntry[];
export declare function setWidgetFocus(id: string | null): void;
/** Whether a scroll region still owes the keyboard-focused widget a reveal,
 *  paired with where that widget drew (SCREEN-logical coords). `seen` is the
 *  epoch the caller last acted on; a region that returns a rect should store
 *  the returned `epoch` so it only scrolls once per focus move. Null when the
 *  focus came from the pointer (the widget was already visible — clicking it
 *  proves it), when nothing is focused, or when the widget hasn't drawn yet. */
export declare function focusReveal(seen: number): {
    epoch: number;
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
} | null;
export declare function moveWidgetFocus(direction: 1 | -1): void;
export declare function wireFocusCanvas(ctx: CanvasRenderingContext2D, app: App): void;
export declare function registerFocusable(ctx: CanvasRenderingContext2D, opts: {
    id?: string;
    disabled?: boolean;
    tabIndex?: number;
    native?: boolean;
    /** The widget's rect in the coords it drew in — recorded (mapped to screen)
     *  so a scroll region can reveal it when the keyboard focuses it. */
    rect?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    focus?: () => void;
    blur?: () => void;
}): boolean;
export declare function markFocusableOverlay(id: string): void;
/** Register `rect` as standing in for widget `id` for the rest of this frame:
 *  a press inside it is a press on that widget. This is how `UI.field` binds a
 *  label to its input, and it has to live in the kernel — the widget being
 *  proxied is the only code that can act on it, and it draws LATER in the frame.
 *
 *  Without it a label could set the focus id and nothing more: `textInput`
 *  blurs its editor on any press outside its own box, so the field would throw
 *  the focus away on the very frame the label granted it. */
export declare function registerFocusProxy(id: string, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}): void;
/** This frame's proxy rects for `id`, in the coords they were registered in —
 *  what a widget adds to its own hit area. Empty for the common case. */
export declare function focusProxies(id: string): {
    x: number;
    y: number;
    w: number;
    h: number;
}[];
/** Whether the pointer is inside one of this frame's proxy rects for `id` —
 *  the test a widget runs alongside its own `hovered`. */
export declare function focusProxyHovered(id: string): boolean;
export declare function focusFromPointer(ctx: CanvasRenderingContext2D, id: string | undefined): void;
export declare function drawFocusRing(ctx: CanvasRenderingContext2D, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}): void;
export declare function consumeKeyboardActivation(id: string | undefined): boolean;
export declare function consumeKeyboardCommand(id: string | undefined): string | null;
/** Consume the current frame's semantic modal-dismiss request (gamepad B or
 * Escape). Modal owns the close action; focus only owns the input convention. */
export declare function consumeDismissRequest(): boolean;
/** Move keyboard focus to a registered widget. */
export declare function focus(id: string): void;
/** Clear canvas-widget keyboard focus. */
export declare function blur(): void;
/** The currently focused widget id, or `null`. */
export declare function focusedId(): string | null;
/** Move to the next/previous widget in the most recently drawn tab order. */
export declare function focusNext(): void;
/** Move to the previous widget in the most recently drawn tab order. The
 *  reverse of `focusNext`. */
export declare function focusPrevious(): void;
export declare function padNav(): void;
export declare function wireFocusKeyboard(): void;
export declare function focusEndFrame(): void;
/** An overlay ran this frame — trap focus into it (called by `enterOverlay`). */
export declare function markFocusTrap(focusVisible?: boolean): void;
