// ---------- Aseprite sheet implementation ----------
// Aseprite sprite-sheet JSON: static atlas frames, tagged animation, per-frame
// timing, trim placement, layers, slices, pivots, and nine-slice centers.
// `Aseprite.sheet(image, json)` is also what `Assets.load({ aseprite })`
// composes automatically.

import type { ClockHandle } from "@src/clock/index.js";
import { type FrameRect, type PlaybackOptions, type SheetImage } from "@src/anim/sheet.js";

export interface AsepriteFrame {
  filename?: string;
  frame: { x: number; y: number; w: number; h: number };
  duration: number;
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
}

export interface AsepriteTag<N extends string = string> {
  name: N;
  from: number;
  to: number;
  direction?: "forward" | "reverse" | "pingpong" | "pingpong_reverse";
}

export interface AsepriteJson<N extends string = string> {
  frames: readonly AsepriteFrame[] | Readonly<Record<string, AsepriteFrame>>;
  meta: {
    frameTags?: readonly AsepriteTag<N>[];
    image?: string;
    layers?: readonly AsepriteLayer[];
    slices?: readonly AsepriteSlice[];
  };
}

export type AsepriteState<D> = D extends {
  meta: { frameTags: readonly (infer T)[] };
}
  ? T extends { name: infer N extends string }
    ? N
    : string
  : string;

export interface AsepriteLayer {
  name: string;
  group?: string;
  opacity?: number;
  blendMode?: string;
}

export interface AsepriteSliceKey {
  frame: number;
  bounds: { x: number; y: number; w: number; h: number };
  center?: { x: number; y: number; w: number; h: number };
  pivot?: { x: number; y: number };
}

export interface AsepriteSlice {
  name: string;
  color?: string;
  keys: readonly AsepriteSliceKey[];
}

export interface AsepriteCursor<K extends string = string> {
  readonly sheet: AsepriteSheet<K>;
  readonly state: K;
  set(state: K): void;
  reset(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  readonly frame: number;
  /** Current frame index in the exported atlas (not the tag-local index). */
  readonly sourceFrame: number;
  readonly rect: FrameRect;
  /** Resolve a named Aseprite slice for the current source frame. */
  slice(name: string): AsepriteSliceKey | undefined;
  readonly done: boolean;
}

export interface AsepriteSheet<K extends string = string> {
  readonly image: SheetImage;
  /** First frame size, convenient for fixed-cell sheets. */
  readonly frame: { w: number; h: number };
  readonly states: readonly K[];
  /** Exported frame names, usable as a static atlas even without tags. */
  readonly frames: readonly string[];
  readonly layers: readonly AsepriteLayer[];
  readonly slices: readonly string[];
  play(initial: K, opts: PlaybackOptions): AsepriteCursor<K>;
  /** Play one tag once, hold its final frame, and report `done`. */
  once(initial: K, opts: PlaybackOptions): AsepriteCursor<K>;
  rect(state: K, frame: number): FrameRect;
  /** Resolve an exported frame by filename/hash key or numeric index. */
  region(frame: string | number): FrameRect;
  /** Use an exported frame as a static sprite. */
  sprite(frame: string | number): {
    readonly sheet: { readonly image: SheetImage };
    rect: FrameRect;
  };
  /** Resolve slice bounds/pivot/9-slice center at a source frame. */
  slice(name: string, frame?: number): AsepriteSliceKey | undefined;
  /** Reuse the parsed clips with another image, e.g. a tinted outline. */
  withImage(image: SheetImage): AsepriteSheet<K>;
}

interface ParsedFrame {
  index: number;
  name: string;
  rect: FrameRect;
  duration: number;
}

interface ParsedClip {
  frames: ParsedFrame[];
  duration: number;
}

const tagOrder = (tag: AsepriteTag, count: number): number[] => {
  if (
    !Number.isInteger(tag.from) ||
    !Number.isInteger(tag.to) ||
    tag.from < 0 ||
    tag.to < tag.from ||
    tag.to >= count
  ) {
    throw new Error(`Aseprite.sheet: tag "${tag.name}" has an invalid frame range`);
  }
  const forward = Array.from({ length: tag.to - tag.from + 1 }, (_, i) => tag.from + i);
  const reverse = [...forward].reverse();
  if (tag.direction === "reverse") return reverse;
  if (tag.direction === "pingpong") return [...forward, ...reverse.slice(1, -1)];
  if (tag.direction === "pingpong_reverse") return [...reverse, ...forward.slice(1, -1)];
  return forward;
};

/** Read Aseprite CLI JSON (array or hash format) as a pull-derived animation sheet. */
export function sheet<const D extends AsepriteJson>(
  image: SheetImage,
  data: D,
  options: { clock?: ClockHandle } = {},
): AsepriteSheet<AsepriteState<D>> {
  const sheetClock = options.clock;
  type K = AsepriteState<D>;
  const entries: [string, AsepriteFrame][] = Array.isArray(data.frames)
    ? data.frames.map((frame, index) => [frame.filename ?? String(index), frame])
    : Object.entries(data.frames);
  const source = entries.map(([, frame]) => frame);
  if (source.length === 0) throw new Error("Aseprite.sheet: no frames");
  const frames = source.map((entry, index): ParsedFrame => {
    if (entry.rotated) {
      throw new Error(`Aseprite.sheet: frame ${index} is rotated; disable atlas rotation`);
    }
    const { x, y, w, h } = entry.frame;
    if (
      ![x, y, w, h, entry.duration].every(Number.isFinite) ||
      w <= 0 ||
      h <= 0 ||
      entry.duration <= 0
    ) {
      throw new Error(`Aseprite.sheet: frame ${index} has invalid geometry or duration`);
    }
    const sourceSize = entry.sourceSize;
    const offset = entry.spriteSourceSize;
    if (
      entry.trimmed &&
      (!sourceSize ||
        !offset ||
        ![sourceSize.w, sourceSize.h, offset.x, offset.y].every(Number.isFinite))
    ) {
      throw new Error(`Aseprite.sheet: trimmed frame ${index} has no source placement`);
    }
    return {
      index,
      name: entries[index][0],
      rect: {
        sx: x,
        sy: y,
        sw: w,
        sh: h,
        ...(entry.trimmed
          ? {
              sourceW: sourceSize!.w,
              sourceH: sourceSize!.h,
              offsetX: offset!.x,
              offsetY: offset!.y,
            }
          : {}),
      },
      duration: entry.duration,
    };
  });
  const clips = new Map<K, ParsedClip>();
  for (const tag of data.meta?.frameTags ?? []) {
    const key = tag.name as K;
    if (clips.has(key)) throw new Error(`Aseprite.sheet: duplicate tag "${tag.name}"`);
    const selected = tagOrder(tag, frames.length).map((index) => frames[index]);
    clips.set(key, {
      frames: selected,
      duration: selected.reduce((sum, frame) => sum + frame.duration, 0),
    });
  }
  const states = [...clips.keys()];
  const first = frames[0].rect;
  const scratch: FrameRect = { ...first };
  const byName = new Map(frames.map((frame) => [frame.name, frame]));
  const slices = new Map(
    (data.meta?.slices ?? []).map((slice) => [
      slice.name,
      { ...slice, keys: [...slice.keys].sort((a, b) => a.frame - b.frame) },
    ]),
  );

  const make = (sheetImage: SheetImage): AsepriteSheet<K> => {
    const copy = (value: FrameRect): FrameRect => {
      for (const key of Object.keys(scratch)) delete scratch[key as keyof FrameRect];
      Object.assign(scratch, value);
      return scratch;
    };
    const rectFor = (state: K, frame: number): FrameRect => {
      const clip = clips.get(state);
      if (!clip) throw new Error(`Aseprite.sheet: unknown state "${state}"`);
      const value = clip.frames[Math.max(0, Math.min(frame, clip.frames.length - 1))].rect;
      return copy(value);
    };
    const sheet: AsepriteSheet<K> = {
      image: sheetImage,
      frame: { w: first.sourceW ?? first.sw, h: first.sourceH ?? first.sh },
      states,
      frames: frames.map((frame) => frame.name),
      layers: data.meta?.layers ?? [],
      slices: [...slices.keys()],
      rect: rectFor,
      region(frame) {
        const value = typeof frame === "number" ? frames[frame] : byName.get(frame);
        if (!value) throw new Error(`Aseprite.sheet: unknown frame "${frame}"`);
        return copy(value.rect);
      },
      sprite(frame) {
        return {
          sheet: { image: sheetImage },
          rect: { ...sheet.region(frame) },
        };
      },
      slice(name, frame = 0) {
        const keys = slices.get(name)?.keys;
        if (!keys) throw new Error(`Aseprite.sheet: unknown slice "${name}"`);
        let value: AsepriteSliceKey | undefined;
        for (const key of keys) {
          if (key.frame > frame) break;
          value = key;
        }
        return value;
      },
      withImage: make,
      once(initial, playOptions) {
        return makeCursor(initial, playOptions, false);
      },
      play(initial, playOptions) {
        return makeCursor(initial, playOptions, true);
      },
    };
    const makeCursor = (
      initial: K,
      playOptions: PlaybackOptions,
      loop: boolean,
    ): AsepriteCursor<K> => {
      if (!clips.has(initial)) throw new Error(`Aseprite.sheet: unknown state "${initial}"`);
      const clock = playOptions.clock ?? sheetClock;
      if (!clock) {
        throw new Error(
          "Aseprite.sheet: playback needs a clock; pass one explicitly or use Animation.play(source, state)",
        );
      }
      let state = initial;
      let start = clock.now;
      let pausedAt: number | undefined;
      const now = () => pausedAt ?? clock.now;
      const elapsed = () => Math.max(0, now() - start);
      const current = (): { clip: ParsedClip; index: number } => {
        const clip = clips.get(state)!;
        const time = loop
          ? elapsed() % clip.duration
          : Math.min(elapsed(), Math.max(0, clip.duration - Number.EPSILON));
        let at = 0;
        for (let index = 0; index < clip.frames.length; index++) {
          at += clip.frames[index].duration;
          if (time < at) return { clip, index };
        }
        return { clip, index: clip.frames.length - 1 };
      };
      const cursor: AsepriteCursor<K> = {
        sheet,
        get state() {
          return state;
        },
        set(next) {
          if (next !== state) {
            if (!clips.has(next)) throw new Error(`Aseprite.sheet: unknown state "${next}"`);
            state = next;
            start = now();
          }
        },
        reset() {
          start = now();
        },
        pause() {
          pausedAt ??= clock.now;
        },
        resume() {
          if (pausedAt === undefined) return;
          start += clock.now - pausedAt;
          pausedAt = undefined;
        },
        get paused() {
          return pausedAt !== undefined;
        },
        get frame() {
          return current().index;
        },
        get sourceFrame() {
          const value = current();
          return value.clip.frames[value.index].index;
        },
        get rect() {
          return rectFor(state, current().index);
        },
        slice(name) {
          const value = current();
          return sheet.slice(name, value.clip.frames[value.index].index);
        },
        get done() {
          const clip = clips.get(state)!;
          return !loop && elapsed() >= clip.duration;
        },
      };
      return cursor;
    };
    return sheet;
  };
  return make(image);
}

export type {
  AsepriteCursor as Cursor,
  AsepriteFrame as Frame,
  AsepriteJson as Json,
  AsepriteLayer as Layer,
  AsepriteSheet as Sheet,
  AsepriteSlice as Slice,
  AsepriteSliceKey as SliceKey,
  AsepriteState as State,
  AsepriteTag as Tag,
};
