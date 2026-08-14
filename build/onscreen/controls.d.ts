import { type GamepadState, type PadButton } from "../input/index.js";
import type { Theme } from "../ui/theme.js";
/** Placement inset from a bottom corner, in logical px. `y` counts UP from the
 *  bottom edge, so a layout survives aspect-ratio / resolution changes. */
export type Anchor = {
    side: "left" | "right";
    x: number;
    y: number;
};
/** Haptics for a button — fires `navigator.vibrate` on touch-down (opt-in,
 *  silent no-op where unsupported). */
export interface HapticsConfig {
    /** Pulse duration in ms. Default 12. */
    ms?: number;
    /** A `navigator.vibrate()` pattern; overrides `ms`. */
    pattern?: number[];
    /** Buzz on press. Default true. */
    onPress?: boolean;
    /** Buzz on release. Default false. */
    onRelease?: boolean;
}
/** The LEFT analog stick — auto-binds to standard `lstick` axes `0`/`1`
 *  (readable as `pad:lstick-*` or `pad.axis(0)`/`pad.axis(1)`). */
export interface StickSpec {
    /** Fixed center of the stick base. */
    anchor: Anchor;
    /** Travel radius in px — a finger at the rim reads magnitude `1`. */
    radius: number;
    /** Radial deadzone `0..1` applied before the tracker's own. Default 0. */
    deadzone?: number;
}
/** One RIGHT-cluster (or custom) button. Give `button` to feed a `pad:` binding,
 *  or `onTap`/`onHold` for an unmapped control (pause, inventory). */
export interface ButtonSpec {
    /** Center of the button. */
    anchor: Anchor;
    /** Radius in px. */
    r: number;
    /** Glyph drawn in the center. */
    label?: string;
    /** Standard-mapping button this actuates — read via `pad:<button>`. */
    button?: PadButton;
    /** Unmapped tap callback (fires on release). */
    onTap?: () => void;
    /** Unmapped press/release callback (`true` on down, `false` on up). */
    onHold?: (down: boolean) => void;
    /** Per-button haptics override. */
    haptics?: boolean | HapticsConfig;
    /** Evaluated each frame: return `true` to gray the button out and ignore
     *  touches on it (e.g. an "ENTER CAR" button that's live only when near a
     *  car). Omit for an always-active button. */
    disabled?: () => boolean;
}
/** Shape of an on-screen gamepad passed to `gamepad()`: an optional left/right
 *  `stick` plus a `buttons` cluster, drawn as translucent touch controls on the
 *  canvas. Touches drive a synthetic standard-mapping pad, fused with a real
 *  controller by default (`merge`), so `pad:` bindings in `Input.map` work
 *  identically from either source. */
export interface OnscreenGamepadConfig {
    /** Fuse with a hardware pad: `true` = pad `0` (unplugged contributes
     *  nothing), a number = that index, `false` = touch-only. Default true. */
    merge?: boolean | number;
    /** Show only while touch is the live input source; hide on desktop or when a
     *  real pad acts (visual only — input keeps feeding). Default true. */
    autohide?: boolean;
    /** Fade duration in ms for autohide. Default 200; `0` = instant. */
    autohideFadeMs?: number;
    /** Control opacity `0..1`. Default 0.5. */
    opacity?: number;
    /** Default haptics for mapped buttons. Default false. */
    haptics?: boolean | HapticsConfig;
    /** The left analog stick — binds to `lstick` axes 0/1. */
    stick?: StickSpec;
    /** An optional RIGHT analog stick — binds to `rstick` axes 2/3 (`pad:rstick-*`
     *  or `pad.axis(2)`/`pad.axis(3)`). Add it for twin-stick controls (move with
     *  the left, aim/fire with the right). */
    rightStick?: StickSpec;
    /** The button cluster (>= 2 recommended) plus any custom buttons. */
    buttons?: ButtonSpec[];
}
/** What `OnscreenInput.gamepad` returns: a `GamepadState` (for `Input.map`) that
 *  also knows how to render itself via `OnscreenInput.drawControls`. */
export type OnscreenPad = GamepadState & {
    /** Client-space bounds for a configured semantic button, like
     *  `getBoundingClientRect()` for a canvas control. */
    buttonBounds(button: PadButton): ControlBounds | null;
};
/** A canvas control's viewport-relative CSS-pixel bounds. */
export interface ControlBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
}
/** Standard-mapping index for a face/shoulder/dpad `PadButton` (undefined for
 *  stick pseudo-buttons, which are axes, not buttons). */
export declare function padButtonIndex(button: PadButton): number | undefined;
/** Stick vector `-1..1` from a finger offset `(dx, dy)` relative to the base
 *  center, clamped to the rim and rescaled past the deadzone. Screen `y` grows
 *  down, matching standard `lstick` axis 1 (down = positive). */
export declare function computeStick(dx: number, dy: number, radius: number, deadzone?: number): {
    x: number;
    y: number;
};
/** A raw pad snapshot the tracker understands: connection, button pressed
 *  flags, and axis values. */
export interface RawPad {
    connected: boolean;
    buttons: {
        pressed: boolean;
    }[];
    axes: number[];
}
/** Raw-level fusion: button = touch OR hardware, axis = larger magnitude. Keeps
 *  edge semantics correct when the same action comes from both sources. */
export declare function fuseGamepad(touch: RawPad, hw: RawPad | null): RawPad;
export interface OnscreenRuntime {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    viewport: {
        dpr: number;
    };
    onStepStart(handler: () => void): () => void;
    onFrame(handler: () => void): () => void;
    registerGamepad(pad: GamepadState): () => void;
    theme(): Theme;
}
/** Build an on-screen gamepad. The returned value is a `GamepadState` — pass it
 *  to `Input.map` as `pad` and render it each frame with
 *  `OnscreenInput.drawControls`. Touch and a hardware pad share one code path,
 *  so `pressed`/`released` stay edge-correct whichever source acted.
 *
 *      const pad = OnscreenInput.gamepad({
 *        stick: { anchor: { side: "left", x: 90, y: 90 }, radius: 60 },
 *        buttons: [{ anchor: { side: "right", x: 70, y: 70 }, r: 34, button: "a", label: "A" }],
 *      });
 *      const input = Input.map({ jump: ["Space", "pad:a"] }, { pad });
 *      // draw(): OnscreenInput.drawControls(pad); */
export declare function createOnscreenGamepad(runtime: OnscreenRuntime, config?: OnscreenGamepadConfig): OnscreenPad;
/** Render an on-screen gamepad — call once per frame in `draw`. The controls are
 *  painted in WINDOW space at end-of-frame, so they sit in the physical screen
 *  corners regardless of a `resolution` letterbox or a `Camera.render` block
 *  (calling it inside or outside a camera block makes no difference). Honors
 *  `opacity` and the autohide fade. */
export declare function drawControls(pad: OnscreenPad): void;
/** Whether the on-screen controls are currently faded in (touch is the live
 *  input on a coarse pointer). Use it to suppress desktop-only affordances while
 *  the virtual pad is up — e.g. disable mouse-aim so it doesn't fight the right
 *  stick. Reflects the autohide fade, so it eases in/out with the controls. */
export declare function visible(pad: OnscreenPad): boolean;
/** Drop all cached listener/poll state — for tests. */
export declare function _resetOnscreen(): void;
export declare function destroyOnscreenGamepad(pad: OnscreenPad): void;
