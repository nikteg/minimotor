// ---------- Input.map: named actions over fused devices ----------
// One typed map from action names to flat binding lists; keyboard codes and
// "pad:" prefixed gamepad codes side by side. Property access at the call
// site (`input.jump.pressed`), Godot-style `axis`/`vector` synthesis, and
// bindings that are plain JSON — a rebinding UI is data + Storage, not code.
//
//   const input = Input.map({
//     left:  ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
//     right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
//     jump:  ["Space", "pad:a"],
//   });
//   if (input.jump.pressed) jump();
//   player.vel.x = input.axis("left", "right") * SPEED;
//
// Zero wiring: nothing registers. Reads derive from `Keys` (already
// step-tracked by the engine) and the pad tracker, with pad edges folded
// per step on read (API_PLAN law 4).
import { Buttons } from "./gamepad.js";
const PAD_BUTTON_INDEX = {
    a: Buttons.A,
    b: Buttons.B,
    x: Buttons.X,
    y: Buttons.Y,
    l1: Buttons.L1,
    r1: Buttons.R1,
    l2: Buttons.L2,
    r2: Buttons.R2,
    select: Buttons.Select,
    start: Buttons.Start,
    l3: Buttons.L3,
    r3: Buttons.R3,
    "dpad-up": Buttons.DpadUp,
    "dpad-down": Buttons.DpadDown,
    "dpad-left": Buttons.DpadLeft,
    "dpad-right": Buttons.DpadRight,
};
// Stick directions: [axis index, sign]
const PAD_STICK = {
    "lstick-left": [0, -1],
    "lstick-right": [0, 1],
    "lstick-up": [1, -1],
    "lstick-down": [1, 1],
    "rstick-left": [2, -1],
    "rstick-right": [2, 1],
    "rstick-up": [3, -1],
    "rstick-down": [3, 1],
};
const STICK_THRESHOLD = 0.3;
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
export function map(bindings, options) {
    const steps = options.steps;
    const keySource = options.keys;
    const pad = () => options.pad ?? null;
    const store = {};
    for (const name of Object.keys(bindings))
        store[name] = [...bindings[name]];
    const padSamples = new Map();
    const consumed = new Set();
    const consumedReleaseStep = new Map();
    function padActivity(name) {
        const gp = pad();
        if (!gp || !gp.connected)
            return { active: false, value: 0 };
        let value = 0;
        for (const b of store[name]) {
            if (!b.startsWith("pad:"))
                continue;
            const button = b.slice(4);
            const idx = PAD_BUTTON_INDEX[button];
            if (idx !== undefined) {
                if (gp.down(idx))
                    value = Math.max(value, 1);
                continue;
            }
            const stick = PAD_STICK[button];
            if (stick) {
                const v = gp.axis(stick[0]) * stick[1];
                if (v > STICK_THRESHOLD)
                    value = Math.max(value, Math.min(1, v));
            }
        }
        return { active: value > 0, value };
    }
    /** Per-step pad sampling: on the first read of a new step, the previous
     *  step's activity shifts into `prevActive`. */
    function samplePad(name) {
        let f = padSamples.get(name);
        if (!f) {
            f = { sampledStep: -1, prevActive: false, curActive: false, curValue: 0 };
            padSamples.set(name, f);
        }
        const now = steps();
        if (f.sampledStep !== now) {
            f.prevActive = f.sampledStep === now - 1 ? f.curActive : false;
            const a = padActivity(name);
            f.curActive = a.active;
            f.curValue = a.value;
            f.sampledStep = now;
        }
        return f;
    }
    function anyKey(name, check) {
        for (const b of store[name]) {
            if (b.startsWith("pad:"))
                continue;
            if (check(b))
                return true;
        }
        return false;
    }
    function suppressed(name) {
        if (consumed.has(name)) {
            if (anyKey(name, (code) => keySource.down(code)) || padActivity(name).active)
                return true;
            consumed.delete(name);
            consumedReleaseStep.set(name, steps());
            return true;
        }
        if (consumedReleaseStep.get(name) === steps())
            return true;
        consumedReleaseStep.delete(name);
        return false;
    }
    function actionState(name) {
        return {
            get down() {
                if (suppressed(name))
                    return false;
                return anyKey(name, (c) => keySource.down(c)) || samplePad(name).curActive;
            },
            get pressed() {
                if (suppressed(name))
                    return false;
                const f = samplePad(name);
                return anyKey(name, (c) => keySource.pressed(c)) || (f.curActive && !f.prevActive);
            },
            get released() {
                if (suppressed(name))
                    return false;
                const f = samplePad(name);
                return anyKey(name, (c) => keySource.released(c)) || (!f.curActive && f.prevActive);
            },
            get value() {
                if (suppressed(name))
                    return 0;
                const key = anyKey(name, (c) => keySource.down(c)) ? 1 : 0;
                return Math.max(key, samplePad(name).curValue);
            },
        };
    }
    const scratch = { x: 0, y: 0 };
    const actions = {};
    for (const name of Object.keys(store))
        actions[name] = actionState(name);
    const axis = (negative, positive) => Math.max(-1, Math.min(1, actions[positive].value - actions[negative].value));
    // Methods are assembled last so an action named "axis" can't clobber them;
    // `bindings` is a live getter (defineProperty — Object.assign would
    // snapshot it).
    const result = Object.assign(actions, {
        axis,
        vector(left, right, up, down) {
            scratch.x = axis(left, right);
            scratch.y = axis(up, down);
            const len = Math.hypot(scratch.x, scratch.y);
            if (len > 1) {
                scratch.x /= len;
                scratch.y /= len;
            }
            return scratch;
        },
        rebind(action, next) {
            store[action] = [...next];
        },
        consume(action) {
            consumed.add(action);
        },
    });
    Object.defineProperty(result, "bindings", {
        enumerable: false,
        get() {
            const out = {};
            for (const name of Object.keys(store))
                out[name] = [...store[name]];
            return out;
        },
    });
    return result;
}
