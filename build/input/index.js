// ---------- Input ----------
// Keyboard/action mapping and device input. `Input.map` binds keys/pad buttons
// to named actions with edge state, `Input.gamepad` polls a pad, `Input.context`
// swaps whole binding sets, plus DOM helpers `Input.wireButton`/`Input.vibrate`.
// Pads are sampled at step start, so the same step's update sees fresh state.
//
//   const Input = createInput(app);
//   const input = Input.map({ jump: ["Space", "pad:a"], left: ["ArrowLeft", "KeyA"] });
//   if (input.jump.pressed) player.vel.y = -JUMP;
import * as InputModule from "./module.js";
/** Create input maps and gamepad polling bound to one app. */
export function createInput(app) {
    const hardware = new Map();
    const registered = new Set();
    const connected = [];
    const gamepad = (index = 0) => {
        let pad = hardware.get(index);
        if (!pad) {
            pad = InputModule.createGamepadTracker(() => typeof navigator.getGamepads === "function" ? navigator.getGamepads()[index] : null);
            hardware.set(index, pad);
        }
        return pad;
    };
    const unsubscribe = app.Loop.onStepStart(() => {
        for (const pad of hardware.values())
            pad.poll();
    });
    let destroyed = false;
    const destroy = () => {
        if (destroyed)
            return;
        destroyed = true;
        unsubscribe();
        hardware.clear();
        registered.clear();
    };
    const api = {
        Buttons: InputModule.Buttons,
        createGamepadTracker: InputModule.createGamepadTracker,
        navigation: InputModule.navigation,
        preventTouchFocus: InputModule.preventTouchFocus,
        vibrate: InputModule.vibrate,
        wireButton: InputModule.wireButton,
        context: InputModule.createInputContext,
        gamepad,
        gamepads() {
            connected.length = 0;
            for (const pad of registered)
                if (pad.connected)
                    connected.push(pad);
            const raw = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
            for (let i = 0; i < raw.length; i++) {
                if (!raw[i])
                    continue;
                const pad = gamepad(i);
                if (pad.connected && !connected.includes(pad))
                    connected.push(pad);
            }
            return connected;
        },
        registerGamepad(pad) {
            registered.add(pad);
            return () => registered.delete(pad);
        },
        map(bindings, { keys = app.Keys, steps = () => app.Loop.steps, pad = gamepad(), ...options } = {}) {
            return InputModule.map(bindings, {
                ...options,
                keys,
                steps,
                pad,
            });
        },
        destroy,
    };
    app.onDestroy(destroy);
    return api;
}
export * from "./module.js";
