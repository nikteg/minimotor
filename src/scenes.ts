// ---------- Scenes ----------
// A typed scene stack. Scenes are a CONVENTION, not a capability — a
// `switch (mode)` in update/draw is a first-class way to build a game, and a
// plain `paused` boolean is legitimate for tiny games. What the stack buys:
// named modes with enter/exit as the home for reset logic, standardized
// draw-through modality, and the TIME BOUNDARY — `push` holds `Clock.game`,
// so pause is a consequence, not code.
//
//   const scenes = Scenes.create({
//     title:   { update() { if (input.jump.pressed) scenes.go("playing"); }, draw() {...} },
//     playing: { enter: resetLevel, update: updateWorld, draw: drawWorld },
//     paused:  { update() { if (input.pause.pressed) scenes.pop(); }, draw() {...} },
//   });
//   Loop.run(scenes);   // the stack IS GameCallbacks, structurally
//
// Stack semantics: only the TOP scene updates (input routes itself — polling
// + update-gating). Draw runs bottom-to-top starting from the highest
// `opaque` scene; drawing below a modal is a RE-DRAW of frozen state, not a
// screenshot. Pushing holds `Clock.game` (opt out per scene with
// `holdsTime: false` — the "live world under the pause menu" look); `go`
// replaces the stack and holds nothing.

import { Clock, type ClockHandle } from "./clock.js";
import { run as runTransition, type Transition, type TransitionRun } from "./transitions.js";
import { Stage } from "./engine/index.js";

/** One scene. Every hook is optional; hooks capture game state via closure. */
export interface SceneSpec {
  /** Runs when the scene becomes active (pushed, or navigated to). */
  enter?(): void;
  /** Runs when the scene leaves the stack (popped, or replaced by `go`). */
  exit?(): void;
  /** Fixed-step simulation — only while this scene is on TOP. */
  update?(): void;
  /** Render — every visible scene draws, bottom-to-top. Use `Draw.*`. */
  draw?(): void;
  /** This scene paints the full viewport: nothing beneath it draws. */
  opaque?: boolean;
  /** When pushed as a modal: hold `Clock.game` while on the stack (default
   *  true — hard freeze). `false` keeps world time flowing while updates
   *  stay gated: idle cycles and particles keep breathing under the menu. */
  holdsTime?: boolean;
}

/** Options for `SceneStack.go` — an optional covering `transition`. */
export interface GoOptions {
  /** Cover the swap with a transition (`Transitions.fade(300)`): the overlay
   *  covers the screen first, the swap happens behind it. */
  transition?: Transition;
}

/** The typed scene stack — structurally `GameCallbacks`, so `Loop.run(scenes)`
 *  is the entire handoff. */
export interface SceneStack<K extends string> {
  /** Replace the whole stack with `name` (exits every current scene). */
  go(name: K, opts?: GoOptions): void;
  /** Push `name` on top as a modal; scenes beneath keep drawing, and
   *  `Clock.game` holds unless the scene says `holdsTime: false`. */
  push(name: K): void;
  /** Exit the top scene and resume beneath (releases the clock hold when no
   *  holding modal remains). */
  pop(): void;
  /** Name of the top (updating) scene. */
  readonly active: K;
  /** Scene names, bottom-to-top. */
  readonly stack: readonly K[];
  /** GameCallbacks: tick the top scene (wired by `Loop.run(scenes)`). */
  update(): void;
  /** GameCallbacks: draw the visible stack bottom-to-top. */
  draw(ctx: CanvasRenderingContext2D): void;
}

/** Config for `Scenes.create` — the clock modal pushes hold. */
export interface SceneStackOptions {
  /** The clock modal pushes hold. Default `Clock.game`. */
  clock?: ClockHandle;
}

/** Build a typed scene stack from a `map` of named `SceneSpec`s. The first key
 *  is the opening scene (entered immediately). The result is structurally
 *  `GameCallbacks`, so `Loop.run(scenes)` is the whole handoff. Throws if `map`
 *  is empty. */
function create<K extends string>(
  map: Record<K, SceneSpec>,
  options: SceneStackOptions = {},
): SceneStack<K> {
  const names = Object.keys(map) as K[];
  if (names.length === 0) throw new Error("Scenes.create: at least one scene is required");
  const stack: K[] = [];
  let transition: TransitionRun | null = null;
  let transitionLast = 0;
  let held = false;

  const clock = (): ClockHandle => options.clock ?? Clock.game;

  function resolve(name: K): SceneSpec {
    const scene = map[name];
    if (!scene) throw new Error(`Scenes: no scene named "${String(name)}"`);
    return scene;
  }

  /** Modal time rule: any pushed scene (above the bottom) that doesn't opt
   *  out holds the game clock. Recomputed after every stack change. */
  function applyHold(): void {
    const shouldHold = stack.some((name, i) => i > 0 && resolve(name).holdsTime !== false);
    if (shouldHold && !held) {
      clock().hold();
      held = true;
    } else if (!shouldHold && held) {
      clock().release();
      held = false;
    }
  }

  function goNow(name: K): void {
    resolve(name); // validate before tearing anything down
    while (stack.length > 0) resolve(stack.pop()!).exit?.();
    stack.push(name);
    applyHold();
    resolve(name).enter?.();
  }

  const self: SceneStack<K> = {
    go(name, opts = {}) {
      if (opts.transition && !transition) {
        transitionLast = Clock.ui.now;
        transition = runTransition(opts.transition, () => goNow(name));
      } else {
        goNow(name);
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
      for (let i = from; i < stack.length; i++) resolve(stack[i]).draw?.();
      if (transition) {
        // Transitions run in interface time (they must play over a held world).
        const now = Clock.ui.now;
        transition.advance(now - transitionLast);
        transitionLast = now;
        let view: { w: number; h: number };
        try {
          view = Stage.viewport;
        } catch {
          view = { w: ctx.canvas.width, h: ctx.canvas.height };
        }
        transition.draw(ctx, view);
        if (transition.done) transition = null;
      }
    },
  };

  // The first key in the map is the opening scene.
  goNow(names[0]);
  return self;
}

/** Typed scene stacks are created, never ambient: `Scenes.create({...})`. */
export const Scenes = { create };
