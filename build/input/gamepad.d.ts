/** Standard-mapping button indices (https://w3c.github.io/gamepad/#remapping). */
export declare const Buttons: {
    readonly A: 0;
    readonly B: 1;
    readonly X: 2;
    readonly Y: 3;
    readonly L1: 4;
    readonly R1: 5;
    readonly L2: 6;
    readonly R2: 7;
    readonly Select: 8;
    readonly Start: 9;
    readonly L3: 10;
    readonly R3: 11;
    readonly DpadUp: 12;
    readonly DpadDown: 13;
    readonly DpadLeft: 14;
    readonly DpadRight: 15;
};
/** Polled gamepad state. Read inside `update`, like `Keys`. */
export interface GamepadState {
    /** True while a pad is plugged in and reporting. */
    readonly connected: boolean;
    /** Axis value in -1..1 with a 0.15 deadzone applied (0 when unplugged).
     *  Standard mapping: 0/1 = left stick X/Y, 2/3 = right stick X/Y. */
    axis(index: number): number;
    /** True while the button is held. */
    down(button: number): boolean;
    /** True for one update step when the button goes down. */
    pressed(button: number): boolean;
    /** True for one update step when the button goes up. */
    released(button: number): boolean;
}
export interface GamepadNavigation {
    /** Horizontal navigation axis, -1..1. */
    x: number;
    /** Vertical navigation axis, -1..1. */
    y: number;
    /** Conventional primary/accept action edge. */
    acceptPressed: boolean;
    /** Conventional back/cancel action edge. */
    cancelPressed: boolean;
}
/** Semantic UI navigation from a gamepad: D-pad axes plus, optionally, a
 * stick. Keeps menu code independent of standard-mapping button indices.
 * Returns a reused object; read it, don't hold it. */
export declare function navigation(pad: GamepadState, options?: {
    stick?: false | 0 | 1;
}): GamepadNavigation;
/** Create a gamepad tracker fed by `read` (injectable for tests). Call `poll()`
 * once per fixed step; app-bound `Input.gamepad()` wires this to that app's
 * `Loop.onStepStart` for you. */
export declare function createGamepadTracker(read: () => Gamepad | null | undefined): GamepadState & {
    poll(): void;
};
