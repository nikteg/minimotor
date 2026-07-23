// ---------- Sprite sheets ----------
// A sheet is shared, immutable config: image + frame size + named states
// (one grid row per state). A CURSOR (`sheet.play("idle")`) is a cheap
// per-entity playback head — a hundred goblins share one sheet.
//
//   const heroSheet = Anim.sheet(art.hero, {
//     frame: { w: 32, h: 32 },
//     states: {
//       idle: { row: 0, frames: 4, fps: 6 },
//       run:  { row: 1, frames: 6, fps: 12 },
//       jump: { row: 2, frames: 1 },
//     },
//   });
//   const anim = heroSheet.play("idle");
//   anim.set(grounded ? "run" : "jump");    // typed; same-state is a NO-OP
//   Draw.sprite(anim, player, { flipX });
//
// Cursors are pull-derived (API_PLAN law 4): the frame is computed from the
// clock on read — nothing ticks, holding the clock freezes every cursor, and
// calling `set` with the current state every step never restarts the loop
// (the classic stuck-on-frame-0 bug can't be written).

import { Clock, type ClockHandle } from "../clock.js";

/** A rectangular region of the sheet image (px). Matches the `sx/sy/sw/sh`
 *  fields of the ECS `Sprite` component. */
export interface FrameRect {
  /** Source x of the frame's top-left in the sheet image (px). */
  sx: number;
  /** Source y of the frame's top-left in the sheet image (px). */
  sy: number;
  /** Source width of the frame (px). */
  sw: number;
  /** Source height of the frame (px). */
  sh: number;
}

/** One named state's frames within a sheet's grid (a row and its frame count). */
export interface SheetStateSpec {
  /** Grid row holding this state's frames. */
  row: number;
  /** Frame count, left to right from column 0. */
  frames: number;
  /** Playback speed in frames/second. Default 12 (ignored for 1 frame). */
  fps?: number;
  /** Loop at the end (default true); false holds the last frame and reports
   *  `done`. */
  loop?: boolean;
}

/** Config for `Anim.sheet` — the source frame size plus the named states packed
 *  into the grid. */
export interface SheetOptions<K extends string> {
  /** Source frame size in the image, in px. */
  frame: { w: number; h: number };
  /** Named states — the keys become the cursor's typed vocabulary. */
  states: Record<K, SheetStateSpec>;
}

/** An image source usable as a sheet: a `CanvasImageSource` with known
 *  `width`/`height`. */
export type SheetImage = CanvasImageSource & { width: number; height: number };

/** A per-entity playback head over a sheet. Everything derives from the
 *  cursor's clock at read time. */
export interface SheetCursor<K extends string = string> {
  /** The sheet this cursor plays over. */
  readonly sheet: Sheet<K>;
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

/** A single-image, named-state sprite sheet; `play` starts a per-entity cursor. */
export interface Sheet<K extends string = string> {
  /** The source image sliced by this sheet. */
  readonly image: SheetImage;
  /** Source frame size in the image, in px. */
  readonly frame: { w: number; h: number };
  /** Start a playback cursor. `clock` defaults to `Clock.game`. */
  play(initial: K, opts?: { clock?: ClockHandle }): SheetCursor<K>;
  /** Source rect for an arbitrary state/frame (manual draws, HUD icons).
   *  Reused scratch — read, don't hold. */
  rect(state: K, frame: number): FrameRect;
}

/** Slice an image into a named-state sprite sheet. */
export function sheet<K extends string>(image: SheetImage, opts: SheetOptions<K>): Sheet<K> {
  const fw = opts.frame.w;
  const fh = opts.frame.h;
  const states = opts.states;
  const scratch: FrameRect = { sx: 0, sy: 0, sw: fw, sh: fh };

  function rectFor(state: K, frame: number): FrameRect {
    const spec = states[state];
    const n = Math.max(1, spec.frames);
    const f = Math.max(0, Math.min(frame, n - 1));
    scratch.sx = f * fw;
    scratch.sy = spec.row * fh;
    scratch.sw = fw;
    scratch.sh = fh;
    return scratch;
  }

  const self: Sheet<K> = {
    image,
    frame: { w: fw, h: fh },
    rect: rectFor,
    play(initial, playOpts = {}) {
      if (!states[initial]) throw new Error(`Anim.sheet: unknown state "${initial}"`);
      const clock = playOpts.clock ?? Clock.game;
      let state = initial;
      let start = clock.now;

      const frameIndex = (): number => {
        const spec = states[state];
        const n = Math.max(1, spec.frames);
        if (n === 1) return 0;
        const fps = spec.fps ?? 12;
        const idx = Math.floor(((clock.now - start) * fps) / 1000);
        return (spec.loop ?? true) ? idx % n : Math.min(idx, n - 1);
      };

      return {
        sheet: self,
        get state() {
          return state;
        },
        set(next) {
          if (next === state) return; // the load-bearing no-op
          if (!states[next]) throw new Error(`Anim.sheet: unknown state "${next}"`);
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
          const spec = states[state];
          if (spec.loop ?? true) return false;
          const n = Math.max(1, spec.frames);
          const fps = spec.fps ?? 12;
          return clock.now - start >= (n * 1000) / fps;
        },
      };
    },
  };
  return self;
}
