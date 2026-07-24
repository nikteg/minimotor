// ---------- Multi-image state animations ----------
// The companion to `Anim.sheet` for the OTHER common art layout: one image PER
// STATE (a sprite kit shipped as `idle.png`, `run.png`, `jump.png`, …), rather
// than every state packed into one grid. Each state's image is a horizontal
// strip of `frames` cells (or a single static frame).
//
//   const hero = Anim.states({
//     idle: { image: art.idle, frames: 4, fps: 6 },
//     run:  { image: art.run,  frames: 6, fps: 12 },
//     jump: { image: art.jump },                       // 1 static frame
//   });
//   const anim = hero.play("idle");
//   anim.set(grounded ? "run" : "jump");    // typed; same-state is a NO-OP
//   Draw.sprite(anim, player, { flipX });    // SpriteLike: the image switches
//
// A kit is shared, immutable config; a CURSOR (`hero.play("idle")`) is a cheap
// per-entity playback head — a hundred goblins share one kit. Like `Anim.sheet`
// the cursor is pull-derived (API_PLAN law 4): the frame comes from the clock on
// read, so nothing ticks, holding the clock freezes it, and calling `set` with
// the current state every step never restarts the loop.

import { Clock, type ClockHandle } from "../clock.js";
import type { FrameRect, SheetImage } from "./sheet.js";

/** One state's clip: an image plus how to read frames out of it. */
export interface StateClip {
  /** The state's image — a horizontal strip of `frames` cells, or (with
   *  `frames` omitted/1) a single static frame. */
  image: SheetImage;
  /** Cells laid out left-to-right in `image`. Default 1 (static). */
  frames?: number;
  /** Playback speed in frames/second. Default 12 (ignored for 1 frame). */
  fps?: number;
  /** Loop at the end (default true); false holds the last frame and reports
   *  `done`. */
  loop?: boolean;
  /** Source cell size in px. Defaults to `image.width / frames` × full height —
   *  override only for padded strips or non-strip layouts. */
  frame?: { w: number; h: number };
}

/** A per-entity playback head over a state kit. Everything derives from the
 *  cursor's clock at read time. Satisfies `SpriteLike`, so it drops straight
 *  into `Draw.sprite` — and `sheet.image` returns the ACTIVE state's image. */
export interface StateCursor<K extends string = string> {
  /** The active state's image, exposed as `SpriteLike` expects. Switches with
   *  `set` — this is what makes multi-image kits work in `Draw.sprite`. */
  readonly sheet: { readonly image: SheetImage };
  /** The active state name. */
  readonly state: K;
  /** Switch state. Same-state calls are no-ops (call it every step freely);
   *  switching resets the new state's timeline. */
  set(state: K): void;
  /** Restart the current state's timeline. */
  reset(): void;
  /** Current frame index within the state. */
  readonly frame: number;
  /** Source rect of the current frame (reused scratch — read, don't hold). */
  readonly rect: FrameRect;
  /** True once a non-looping state has reached its last frame. */
  readonly done: boolean;
}

/** A shared, immutable multi-image state kit (one image per state); `play`
 *  starts a cheap per-entity `StateCursor`. */
export interface StateKit<K extends string = string> {
  /** Start a playback cursor. `clock` defaults to `Clock.world`. */
  play(initial: K, opts?: { clock?: ClockHandle }): StateCursor<K>;
  /** Source rect for an arbitrary state/frame (manual draws, HUD icons).
   *  Reused scratch — read, don't hold. */
  rect(state: K, frame: number): FrameRect;
  /** The image backing a state (e.g. to pass to `Draw.sprite`'s sibling APIs). */
  image(state: K): SheetImage;
}

/** Assemble named states, each from its own image, into a shared kit. */
export function states<K extends string>(clips: Record<K, StateClip>): StateKit<K> {
  const scratch: FrameRect = { sx: 0, sy: 0, sw: 0, sh: 0 };

  const frameCount = (clip: StateClip): number => Math.max(1, clip.frames ?? 1);
  const cellW = (clip: StateClip): number => clip.frame?.w ?? clip.image.width / frameCount(clip);
  const cellH = (clip: StateClip): number => clip.frame?.h ?? clip.image.height;

  function rectFor(state: K, frame: number): FrameRect {
    const clip = clips[state];
    const n = frameCount(clip);
    const f = Math.max(0, Math.min(frame, n - 1));
    const fw = cellW(clip);
    scratch.sx = f * fw;
    scratch.sy = 0;
    scratch.sw = fw;
    scratch.sh = cellH(clip);
    return scratch;
  }

  const self: StateKit<K> = {
    rect: rectFor,
    image(state) {
      return clips[state].image;
    },
    play(initial, playOpts = {}) {
      if (!clips[initial]) throw new Error(`Anim.states: unknown state "${initial}"`);
      const clock = playOpts.clock ?? Clock.world;
      let state = initial;
      let start = clock.now;

      const frameIndex = (): number => {
        const clip = clips[state];
        const n = frameCount(clip);
        if (n === 1) return 0;
        const fps = clip.fps ?? 12;
        const idx = Math.floor(((clock.now - start) * fps) / 1000);
        return (clip.loop ?? true) ? idx % n : Math.min(idx, n - 1);
      };

      // Stable SpriteLike facade — a getter so it always reflects the active
      // state's image without allocating per read.
      const sheetFacade = {
        get image() {
          return clips[state].image;
        },
      };

      return {
        sheet: sheetFacade,
        get state() {
          return state;
        },
        set(next) {
          if (next === state) return; // the load-bearing no-op
          if (!clips[next]) throw new Error(`Anim.states: unknown state "${next}"`);
          state = next;
          start = clock.now;
        },
        reset() {
          start = clock.now;
        },
        get frame() {
          return frameIndex();
        },
        get rect() {
          return rectFor(state, frameIndex());
        },
        get done() {
          const clip = clips[state];
          if (clip.loop ?? true) return false;
          const n = frameCount(clip);
          const fps = clip.fps ?? 12;
          return clock.now - start >= (n * 1000) / fps;
        },
      };
    },
  };
  return self;
}
