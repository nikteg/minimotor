// ---------- Animation ----------
// Frame-based sprite animation on the app's world clock: `Anim.sheet` (regular grid),
// `Anim.states` (one image per state), motion behaviors, and composable value
// tweens (`Anim.animate`, `Anim.sequence`, `Anim.parallel`). Cursors here are
// `Draw.sprite`-ready.
//
//   const Anim = createAnimation(app);
//   const hero = Anim.sheet(img, {
//     frame: { w: 32, h: 32 },
//     states: { idle: { row: 0, frames: 4 }, run: { row: 1, frames: 6, fps: 12 } },
//   });
//   Draw.sprite(hero.play("idle"), player);   // per-entity cursor

import * as AnimModule from "./index.js";
import { withClock, type ClockHandle } from "../clock.js";
import type { App } from "../engine/app.js";

/** A source that can start a cursor — `Anim.sheet`, `Anim.states`, or an
 *  `Aseprite.sheet`, which comes from a module with no app-bound service of its
 *  own and so is never built inside a binding. */
interface PlaybackSource<K, C> {
  play(initial: K, options: { clock: ClockHandle }): C;
  once(initial: K, options: { clock: ClockHandle }): C;
}

/** Every animation helper, with the clock argument already answered. The shape
 *  is the module's own — binding happens at the clock, not in the types, so a
 *  helper added to `anim/` arrives here bound instead of silently unbound. */
export type AnimationApi = typeof AnimModule & {
  /** Start a foreign source (an `Aseprite.sheet`) on this app's world clock. */
  play<K, C>(source: PlaybackSource<K, C>, initial: K, options?: { clock?: ClockHandle }): C;
  /** Play one state of a foreign source once, on this app's world clock. */
  once<K, C>(source: PlaybackSource<K, C>, initial: K, options?: { clock?: ClockHandle }): C;
};

/** Animation helpers bound to one app's world clock.
 *
 *  Each function runs inside `withClock`, so the primitives capture this app's
 *  world clock as they build (a sheet keeps it for every cursor it later
 *  starts). Passing an explicit `clock` still wins, and two apps on one page
 *  stay independent because the binding is dynamic scope, not a global. */
export function createAnimation(app: App): AnimationApi {
  const clock = app.Clock.world;
  const api: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(AnimModule)) {
    const value = Reflect.get(AnimModule, key);
    api[key] =
      typeof value === "function"
        ? (...args: unknown[]) => withClock(clock, () => value(...args))
        : value;
  }
  // Sources from modules without a service of their own can't have captured
  // anything, so they still take the clock by argument.
  api.play = <K, C>(
    source: PlaybackSource<K, C>,
    initial: K,
    options: { clock?: ClockHandle } = {},
  ) => source.play(initial, { clock: options.clock ?? clock });
  api.once = <K, C>(
    source: PlaybackSource<K, C>,
    initial: K,
    options: { clock?: ClockHandle } = {},
  ) => source.once(initial, { clock: options.clock ?? clock });
  return api as AnimationApi;
}
