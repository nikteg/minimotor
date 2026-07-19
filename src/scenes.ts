// ---------- Scenes ----------
// A scene stack that replaces the hand-rolled `state = "menu"|"play"|"over"` +
// per-state branching every game otherwise duplicates. The top scene updates;
// the whole stack draws bottom-to-top, so `push()` overlays (a pause screen over
// a frozen game) work without extra bookkeeping.
//
//   Minimotor.Scenes.define("play", { enter, update, draw, exit });
//   Minimotor.Scenes.go("menu");     // swap: exit the stack, enter "menu"
//   Minimotor.Scenes.push("pause");  // overlay: "play" keeps drawing underneath
//   Minimotor.Scenes.pop();          // exit the overlay, resume beneath
//
// The default `Scenes` facade wires itself into the default Loop the first time
// you `go`/`push`, so game code never calls `Loop.run` when using scenes.

import { Loop, Draw } from "./engine.js";
import type { World } from "./ecs.js";

/** A game screen. Every hook is optional. `update` runs on the fixed timestep
 *  for the top scene only; `draw` runs once per frame for every scene in the
 *  stack (bottom-to-top).
 *
 *  A scene may declare an ECS `world`. If it has no `update`/`draw` hook, the
 *  world is auto-driven (`world.update()` / `world.draw(ctx)`). If it does have
 *  a hook, the hook is in full control and calls `world.update()`/`draw(ctx)`
 *  itself where it wants — so background/entities/HUD ordering stays yours. */
export interface Scene {
  /** Called when the scene becomes active (pushed, or navigated to). */
  enter?(): void;
  /** Fixed-step simulation. Only the top scene updates. */
  update?(): void;
  /** Render. Every scene in the stack draws, bottom-to-top. */
  draw?(): void;
  /** Called when the scene leaves the stack (popped, or replaced by `go`). */
  exit?(): void;
  /** Optional ECS world; auto-driven only when `update`/`draw` are absent. */
  world?: World;
}

/** Manages a stack of named scenes. Pure — no Loop/DOM dependency — so the
 *  navigation/lifecycle logic is testable in isolation. The default `Scenes`
 *  facade below wraps one of these and drives it from the default Loop. */
export interface SceneManager {
  /** Register (or replace) a scene under `name`. */
  define(name: string, scene: Scene): void;
  /** Replace the whole stack with `name` (exits every current scene). */
  go(name: string): void;
  /** Push `name` on top; scenes beneath stay and keep drawing. */
  push(name: string): void;
  /** Exit the top scene and resume the one beneath. */
  pop(): void;
  /** Name of the top (updating) scene, or undefined when the stack is empty. */
  readonly active: string | undefined;
  /** Scene names, bottom-to-top. */
  readonly stack: readonly string[];
  /** Tick the top scene's `update` (call once per fixed step). */
  update(): void;
  /** Draw every scene bottom-to-top (call once per frame). `ctx` is only needed
   *  for scenes that auto-drive a `world`. */
  draw(ctx?: CanvasRenderingContext2D): void;
}

export function createSceneManager(): SceneManager {
  const registry = new Map<string, Scene>();
  const stack: { name: string; scene: Scene }[] = [];

  function resolve(name: string): Scene {
    const scene = registry.get(name);
    if (!scene) throw new Error(`Minimotor: no scene defined named "${name}"`);
    return scene;
  }

  return {
    define(name, scene) {
      registry.set(name, scene);
    },
    go(name) {
      const scene = resolve(name);
      while (stack.length) stack.pop()!.scene.exit?.();
      stack.push({ name, scene });
      scene.enter?.();
    },
    push(name) {
      const scene = resolve(name);
      stack.push({ name, scene });
      scene.enter?.();
    },
    pop() {
      stack.pop()?.scene.exit?.();
    },
    get active() {
      return stack[stack.length - 1]?.name;
    },
    get stack() {
      return stack.map((s) => s.name);
    },
    update() {
      const top = stack[stack.length - 1]?.scene;
      if (!top) return;
      if (top.update) top.update();
      else top.world?.update(); // auto-drive a pure-ECS scene
    },
    draw(ctx) {
      for (const { scene } of stack) {
        if (scene.draw) scene.draw();
        else if (scene.world && ctx) scene.world.draw(ctx);
      }
    },
  };
}

// ---------- Default facade (wires into the default Loop) ----------

let manager = createSceneManager();
let wired = false;

function ensureRunning(): void {
  if (wired) return;
  wired = true;
  Loop.run({
    update: () => manager.update(),
    draw: () => manager.draw(Draw.ctx),
  });
}

export const Scenes = {
  define(name: string, scene: Scene): void {
    manager.define(name, scene);
  },
  go(name: string): void {
    manager.go(name);
    ensureRunning();
  },
  push(name: string): void {
    manager.push(name);
    ensureRunning();
  },
  pop(): void {
    manager.pop();
  },
  get active(): string | undefined {
    return manager.active;
  },
  get stack(): readonly string[] {
    return manager.stack;
  },
  /** Reset registry, stack and Loop wiring — for tests only. */
  _reset(): void {
    manager = createSceneManager();
    wired = false;
  },
};
