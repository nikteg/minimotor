import * as InputModule from "./module.js";
import type { GamepadState } from "./gamepad.js";
import type { App } from "../engine/app.js";
export type InputApi = Omit<typeof InputModule, "map" | "createInputContext"> & {
    context(initial?: string): InputModule.InputContextApi;
    gamepad(index?: number): GamepadState;
    gamepads(): readonly GamepadState[];
    registerGamepad(pad: GamepadState): () => void;
    map<A extends string>(bindings: Record<A, readonly InputModule.Binding[]>, options?: Partial<InputModule.InputMapOptions>): InputModule.InputMap<A>;
    destroy(): void;
};
/** Create input maps and gamepad polling bound to one app. */
export declare function createInput(app: App): InputApi;
export * from "./module.js";
