import * as AnimModule from "../../anim/index.js";
import type { ClockHandle } from "../../clock.js";
import type { Game } from "../../engine/app.js";

type BoundPlaybackOptions = Omit<AnimModule.PlaybackOptions, "clock"> & {
  clock?: ClockHandle;
};

interface PlaybackSource<K, C> {
  play(initial: K, options: AnimModule.PlaybackOptions): C;
  once(initial: K, options: AnimModule.PlaybackOptions): C;
}

type BoundSheet<K extends string> = Omit<AnimModule.Sheet<K>, "play" | "once"> & {
  play(initial: K, options?: BoundPlaybackOptions): AnimModule.SheetCursor<K>;
  once(initial: K, options?: BoundPlaybackOptions): AnimModule.SheetCursor<K>;
};

type BoundStateKit<K extends string> = Omit<AnimModule.StateKit<K>, "play" | "once"> & {
  play(initial: K, options?: BoundPlaybackOptions): AnimModule.StateCursor<K>;
  once(initial: K, options?: BoundPlaybackOptions): AnimModule.StateCursor<K>;
};

export type AnimationApi = Omit<
  typeof AnimModule,
  "animate" | "sequence" | "parallel" | "sheet" | "states"
> & {
  sheet<K extends string>(
    image: AnimModule.SheetImage,
    options: AnimModule.SheetOptions<K>,
  ): BoundSheet<K>;
  states<K extends string>(clips: Record<K, AnimModule.StateClip>): BoundStateKit<K>;
  animate(
    options: Omit<AnimModule.AnimateOptions, "clock"> & { clock?: ClockHandle },
  ): AnimModule.Motion;
  sequence(
    steps: AnimModule.SequenceStep[],
    options?: { clock?: ClockHandle; loop?: boolean },
  ): AnimModule.Motion;
  parallel(
    specs: Omit<AnimModule.AnimateOptions, "clock">[],
    options?: { clock?: ClockHandle },
  ): AnimModule.Parallel;
  /** Start any Anim/Aseprite-compatible source on this game's world clock. */
  play<K, C>(source: PlaybackSource<K, C>, initial: K, options?: BoundPlaybackOptions): C;
  /** Play one state once on this game's world clock. */
  once<K, C>(source: PlaybackSource<K, C>, initial: K, options?: BoundPlaybackOptions): C;
};

/** Animation helpers bound to one game's world clock. */
export function createAnimation(game: Game): AnimationApi {
  const clock = game.Clock.world;
  const api: AnimationApi = {
    ...AnimModule,
    sheet(image, options) {
      const source = AnimModule.sheet(image, options);
      return {
        ...source,
        play(initial, playback = {}) {
          return source.play(initial, { clock, ...playback });
        },
        once(initial, playback = {}) {
          return source.once(initial, { clock, ...playback });
        },
      };
    },
    states(clips) {
      const source = AnimModule.states(clips);
      return {
        ...source,
        play(initial, playback = {}) {
          return source.play(initial, { clock, ...playback });
        },
        once(initial, playback = {}) {
          return source.once(initial, { clock, ...playback });
        },
      };
    },
    play(source, initial, options = {}) {
      return source.play(initial, { clock, ...options });
    },
    once(source, initial, options = {}) {
      return source.once(initial, { clock, ...options });
    },
    animate(options) {
      return AnimModule.animate({ clock, ...options });
    },
    sequence(steps, options = {}) {
      return AnimModule.sequence(steps, { clock, ...options });
    },
    parallel(specs, options = {}) {
      return AnimModule.parallel(specs, { clock, ...options });
    },
  };
  return api;
}
