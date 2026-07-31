// ---------- Animation ----------
// Public entry for frame animation and value motion. Implementation files stay
// app-independent; `createAnimation` binds clock arguments explicitly.

import type { App } from "@src/engine/app.js";
import type { ClockHandle } from "@src/clock/index.js";
import {
  fromGrid,
  type GridAnimationSource,
  type PlaybackOptions,
  type SheetImage,
  type SheetOptions,
} from "./sheet.js";
import { fromImages, type ImageAnimationSource, type StateClip } from "./states.js";
import {
  animate,
  parallel,
  sequence,
  type AnimateOptions,
  type Motion,
  type Parallel,
  type SequenceStep,
} from "./value.js";
import { effects, keyed, type EffectPool, type KeyedPool } from "./pools.js";

export * from "./sheet.js";
export * from "./states.js";
export * from "./value.js";
export * from "./pools.js";

/** Any animation source that can start looping and one-shot cursors. Aseprite
 * atlases and both built-in image layouts conform structurally. */
export interface PlaybackSource<K, C> {
  play(initial: K, options?: PlaybackOptions): C;
  once(initial: K, options?: PlaybackOptions): C;
}

export interface AnimationApi {
  fromGrid<K extends string>(image: SheetImage, options: SheetOptions<K>): GridAnimationSource<K>;
  fromImages<K extends string>(
    clips: Record<K, StateClip>,
    options?: { clock?: ClockHandle },
  ): ImageAnimationSource<K>;
  animate(options: Omit<AnimateOptions, "clock"> & { clock?: ClockHandle }): Motion;
  sequence(steps: SequenceStep[], options?: { clock?: ClockHandle; loop?: boolean }): Motion;
  parallel(specs: Omit<AnimateOptions, "clock">[], options?: { clock?: ClockHandle }): Parallel;
  keyed<K, V>(factory?: (key: K) => V): KeyedPool<K, V>;
  effects<I, E>(create: (input: I) => E, done: (effect: E) => boolean): EffectPool<I, E>;
  play<K, C>(source: PlaybackSource<K, C>, initial: K, options?: PlaybackOptions): C;
  once<K, C>(source: PlaybackSource<K, C>, initial: K, options?: PlaybackOptions): C;
}

/** Build the animation API over an explicit default clock. */
export function bindAnimation(clock: ClockHandle): AnimationApi {
  return {
    fromGrid: (image, { clock: boundClock = clock, ...options }) =>
      fromGrid(image, { ...options, clock: boundClock }),
    fromImages: (clips, { clock: boundClock = clock, ...options } = {}) =>
      fromImages(clips, { ...options, clock: boundClock }),
    animate: ({ clock: boundClock = clock, ...options }) =>
      animate({ ...options, clock: boundClock }),
    sequence: (steps, { clock: boundClock = clock, ...options } = {}) =>
      sequence(steps, { ...options, clock: boundClock }),
    parallel: (specs, { clock: boundClock = clock, ...options } = {}) =>
      parallel(specs, { ...options, clock: boundClock }),
    keyed,
    effects,
    play: (source, initial, { clock: boundClock = clock, ...options } = {}) =>
      source.play(initial, { ...options, clock: boundClock }),
    once: (source, initial, { clock: boundClock = clock, ...options } = {}) =>
      source.once(initial, { ...options, clock: boundClock }),
  };
}

/** Animation helpers bound to one app's world clock. */
export function createAnimation(app: App): AnimationApi {
  return bindAnimation(app.Clock.world);
}
