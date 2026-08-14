import type { KeyCode } from "../engine/index.js";
import type { Vec2 } from "../math/vec2.js";
import { type GamepadState } from "./gamepad.js";
/** Standard-mapping gamepad inputs by name (sticks as four directions). */
export type PadButton = "a" | "b" | "x" | "y" | "l1" | "r1" | "l2" | "r2" | "select" | "start" | "l3" | "r3" | "dpad-up" | "dpad-down" | "dpad-left" | "dpad-right" | "lstick-up" | "lstick-down" | "lstick-left" | "lstick-right" | "rstick-up" | "rstick-down" | "rstick-left" | "rstick-right";
/** A gamepad binding string: a `PadButton` under the `pad:` prefix. */
export type PadCode = `pad:${PadButton}`;
/** One entry in an action's binding list: a key code or a pad code. */
export type Binding = KeyCode | PadCode;
/** Polled state of one named action. */
export interface ActionState {
    /** True while any binding is active. */
    readonly down: boolean;
    /** True for one update step when the action becomes active. */
    readonly pressed: boolean;
    /** True for one update step when the action goes inactive. */
    readonly released: boolean;
    /** Analog strength 0..1 — sticks report magnitude, keys/buttons snap to 1. */
    readonly value: number;
}
export interface InputMapMethods<A extends string> {
    /** -1..1 from an opposing action pair (Godot's `get_axis`): analog-aware,
     *  keys snap to ±1. */
    axis(negative: A, positive: A): number;
    /** Normalized movement vector from four actions (Godot's `get_vector`) —
     *  kills the 1.41× diagonal bug; analog magnitude preserved under 1.
     *  Returns a reused scratch object: read, don't hold. */
    vector(left: A, right: A, up: A, down: A): Vec2;
    /** Replace an action's bindings (rebinding UIs: this + `bindings` +
     *  `Storage`). */
    rebind(action: A, bindings: Binding[]): void;
    /** Suppress an action until all of its bindings are released. Use when UI
     * consumes a gameplay button (for example A resumes without also jumping). */
    consume(action: A): void;
    /** The current bindings — plain JSON, ready for `Storage.save`. */
    readonly bindings: Record<A, Binding[]>;
}
/** A typed action map from `map()`: each action name reads as an `ActionState`,
 *  plus the `axis`/`vector`/`rebind`/`bindings` methods. */
export type InputMap<A extends string> = {
    readonly [K in A]: ActionState;
} & InputMapMethods<A>;
interface KeysLike {
    down(code: string): boolean;
    pressed(code: string): boolean;
    released(code: string): boolean;
}
/** Options for `map()`: injectable key, pad and step sources (mainly for tests). */
export interface InputMapOptions {
    /** Key source. App-bound `Input.map` injects `app.Keys`. */
    keys: KeysLike;
    /** Pad source. App-bound `Input.map` injects gamepad 0. */
    pad?: GamepadState | null;
    /** Fixed-step source. App-bound `Input.map` injects `app.Loop.steps`. */
    steps: () => number;
}
/** Build a typed action map from a plain object: each key is an action name,
 *  each value a flat list of bindings — keyboard `KeyCode`s and `pad:`-prefixed
 *  `PadCode`s side by side. Action names become `ActionState` properties on the
 *  returned `InputMap`, alongside `axis`/`vector` synthesis, `rebind`, and the
 *  JSON-ready `bindings`. Strictly optional — raw `Keys` remains the floor.
 *
 *      const input = Input.map({
 *        left:  ["ArrowLeft", "KeyA", "pad:lstick-left"],
 *        right: ["ArrowRight", "KeyD", "pad:lstick-right"],
 *        jump:  ["Space", "pad:a"],
 *      });
 *      if (input.jump.pressed) jump();
 *      player.vel.x = input.axis("left", "right") * SPEED; */
export declare function map<A extends string>(bindings: Record<A, readonly Binding[]>, options: InputMapOptions): InputMap<A>;
export {};
