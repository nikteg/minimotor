// ---------- Input ----------
// Keyboard/action mapping and device input. `Input.map` binds keys/pad buttons
// to named actions with edge state, `Input.gamepad` polls a pad, `Input.context`
// swaps whole binding sets, plus DOM helpers `Input.wireButton`/`Input.vibrate`.
// Pads are sampled at step start, so the same step's update sees fresh state.
//
//   const Input = createInput(app);
//   const input = Input.map({ jump: ["Space", "pad:a"], left: ["ArrowLeft", "KeyA"] });
//   if (input.jump.pressed) player.vel.y = -JUMP;

import * as InputModule from "./index.js";
import type { GamepadState } from "./gamepad.js";
import type { App } from "../engine/app.js";

export type InputApi = Omit<typeof InputModule, "map" | "createInputContext"> & {
  context(initial?: string): InputModule.InputContextApi;
  gamepad(index?: number): GamepadState;
  gamepads(): readonly GamepadState[];
  registerGamepad(pad: GamepadState): () => void;
  map<A extends string>(
    bindings: Record<A, readonly InputModule.Binding[]>,
    options?: Partial<InputModule.InputMapOptions>,
  ): InputModule.InputMap<A>;
  destroy(): void;
};

/** Create input maps and gamepad polling bound to one app. */
export function createInput(app: App): InputApi {
  const {
    map: _standaloneMap,
    createInputContext: _standaloneContext,
    ...standaloneInput
  } = InputModule;
  const hardware = new Map<number, ReturnType<typeof InputModule.createGamepadTracker>>();
  const registered = new Set<GamepadState>();
  const connected: GamepadState[] = [];

  const gamepad = (index = 0): GamepadState => {
    let pad = hardware.get(index);
    if (!pad) {
      pad = InputModule.createGamepadTracker(() =>
        typeof navigator.getGamepads === "function" ? navigator.getGamepads()[index] : null,
      );
      hardware.set(index, pad);
    }
    return pad;
  };

  const unsubscribe = app.Loop.onStepStart(() => {
    for (const pad of hardware.values()) pad.poll();
  });

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    hardware.clear();
    registered.clear();
  };
  const api: InputApi = {
    ...standaloneInput,
    context: InputModule.createInputContext,
    gamepad,
    gamepads() {
      connected.length = 0;
      for (const pad of registered) if (pad.connected) connected.push(pad);
      const raw = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      for (let i = 0; i < raw.length; i++) {
        if (!raw[i]) continue;
        const pad = gamepad(i);
        if (pad.connected && !connected.includes(pad)) connected.push(pad);
      }
      return connected;
    },
    registerGamepad(pad) {
      registered.add(pad);
      return () => registered.delete(pad);
    },
    map(bindings, options = {}) {
      return InputModule.map(bindings, {
        ...options,
        keys: options.keys ?? app.Keys,
        steps: options.steps ?? (() => app.Loop.steps),
        pad: options.pad === undefined ? gamepad() : options.pad,
      });
    },
    destroy,
  };
  app.onDestroy(destroy);
  return api;
}
