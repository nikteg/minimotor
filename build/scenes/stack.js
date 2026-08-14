// ---------- Scene stack implementation ----------
// A typed scene stack. Scenes are a CONVENTION, not a capability — a
// `switch (mode)` in update/draw is a first-class way to build a game, and a
// plain `paused` boolean is legitimate for tiny games. What the stack buys:
// named modes with enter/exit as the home for reset logic, standardized
// draw-through modality, and the TIME BOUNDARY — `push` holds `Clock.world`,
// so pause is a consequence, not code.
//
//   const scenes = Scenes.create({
//     title:   { update() { if (input.jump.pressed) scenes.go("playing"); }, draw() {...} },
//     playing: { enter: resetLevel, update: updateWorld, draw: drawWorld },
//     paused:  { update() { if (input.pause.pressed) scenes.pop(); }, draw() {...} },
//   });
//   Loop.run(scenes);   // the stack IS AppCallbacks, structurally
//
// Stack semantics: only the TOP scene updates (input routes itself — polling
// + update-gating). Draw runs bottom-to-top starting from the highest
// `opaque` scene; drawing below a modal is a RE-DRAW of frozen state, not a
// screenshot. Pushing holds `Clock.world` (opt out per scene with
// `holdsTime: false` — the "live world under the pause menu" look); `go`
// replaces the stack and holds nothing.
import { run as runTransition, } from "../transitions/index.js";
/** Build a typed scene stack from a `map` of named `SceneSpec`s. The first key
 *  is the opening scene (entered immediately). The result is structurally
 *  `AppCallbacks`, so `Loop.run(scenes)` is the whole handoff. Throws if `map`
 *  is empty. */
export function createSceneStack(map, options) {
    const names = Object.keys(map);
    if (names.length === 0)
        throw new Error("Scenes.create: at least one scene is required");
    const stack = [];
    let transition = null;
    let transitionLast = 0;
    let held = false;
    const clock = () => options.clock;
    function resolve(name) {
        const scene = map[name];
        if (!scene)
            throw new Error(`Scenes: no scene named "${String(name)}"`);
        return scene;
    }
    /** Modal time rule: any pushed scene (above the bottom) that doesn't opt
     *  out holds the world clock. Recomputed after every stack change. */
    function applyHold() {
        const shouldHold = stack.some((name, i) => i > 0 && resolve(name).holdsTime !== false);
        if (shouldHold && !held) {
            clock().hold();
            held = true;
        }
        else if (!shouldHold && held) {
            clock().release();
            held = false;
        }
    }
    function goNow(name) {
        resolve(name); // validate before tearing anything down
        while (stack.length > 0)
            resolve(stack.pop()).exit?.();
        stack.push(name);
        applyHold();
        resolve(name).enter?.();
    }
    const self = {
        go(name, opts = {}) {
            if (opts.transition && !transition) {
                transitionLast = (options.uiClock ?? options.clock).now;
                transition = runTransition(opts.transition, {
                    beforeCover: opts.beforeCover,
                    swap() {
                        opts.onSwap?.();
                        goNow(name);
                    },
                    afterReveal: opts.afterReveal,
                });
            }
            else {
                opts.beforeCover?.();
                opts.onSwap?.();
                goNow(name);
                opts.afterReveal?.();
            }
        },
        push(name) {
            resolve(name);
            stack.push(name);
            applyHold();
            resolve(name).enter?.();
        },
        pop() {
            const top = stack.pop();
            if (top !== undefined) {
                applyHold();
                resolve(top).exit?.();
            }
        },
        get active() {
            return stack[stack.length - 1];
        },
        get stack() {
            return [...stack];
        },
        update() {
            resolve(stack[stack.length - 1]).update?.();
        },
        draw(ctx) {
            // Start at the topmost opaque scene — everything below it is covered.
            let from = 0;
            for (let i = stack.length - 1; i >= 0; i--) {
                if (resolve(stack[i]).opaque) {
                    from = i;
                    break;
                }
            }
            for (let i = from; i < stack.length; i++)
                resolve(stack[i]).draw?.();
            if (transition) {
                // Transitions run in interface time (they must play over a held world).
                const now = (options.uiClock ?? options.clock).now;
                transition.advance(now - transitionLast);
                transitionLast = now;
                transition.draw(ctx, options.view ?? { w: ctx.canvas.width, h: ctx.canvas.height });
                if (transition.done)
                    transition = null;
            }
        },
    };
    // The first key in the map is the opening scene.
    goNow(names[0]);
    return self;
}
