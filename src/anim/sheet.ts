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

import { activeClock, boundClock, type ClockHandle } from "../clock.js";

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
  /** Original untrimmed frame size and packed-content offset. Present for
   * trimmed atlases; Draw.sprite uses them to preserve alignment. */
  sourceW?: number;
  sourceH?: number;
  offsetX?: number;
  offsetY?: number;
}

/** One named state's frames within a sheet's grid (a row and its frame count). */
export interface SheetStateSpec {
  /** Grid row holding this state's frames. */
  row: number;
  /** Frame count, left to right from column 0. */
  frames: number;
  /** Playback speed in frames/second. Default 12 (ignored for 1 frame). */
  fps?: number;
}

/** Config for `Anim.sheet` — the source frame size plus the named states packed
 *  into the grid. */
export interface SheetOptions<K extends string> {
  /** Source frame size in the image, in px. */
  frame: { w: number; h: number };
  /** Named states — the keys become the cursor's typed vocabulary. */
  states: Record<K, SheetStateSpec>;
  /** Clock every cursor from this sheet runs on. Defaults to the ambient
   *  clock, which is what `createAnimation(app)` binds. */
  clock?: ClockHandle;
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
  /** Freeze on the current frame. */
  pause(): void;
  /** Continue from the frozen frame. */
  resume(): void;
  /** Whether playback is currently frozen. */
  readonly paused: boolean;
  /** Current frame index within the state. */
  readonly frame: number;
  /** Source rect of the current frame (reused scratch — read, don't hold). */
  readonly rect: FrameRect;
  /** True once a non-looping state has reached its last frame. */
  readonly done: boolean;
}

export interface PlaybackOptions {
  /** Playback clock. Defaults to the clock the sheet captured when it was
   *  built — an app-bound `Anim.sheet` captures that app's world clock, so
   *  cursors pause and slow down with it without naming it here. */
  clock?: ClockHandle;
}

/** A single-image, named-state sprite sheet; `play` starts a per-entity cursor. */
export interface Sheet<K extends string = string> {
  /** The source image sliced by this sheet. */
  readonly image: SheetImage;
  /** Source frame size in the image, in px. */
  readonly frame: { w: number; h: number };
  /** Start a playback cursor, on this sheet's clock unless `opts` names one. */
  play(initial: K, opts?: PlaybackOptions): SheetCursor<K>;
  /** Play one state once, hold its final frame, and report `done`. */
  once(initial: K, opts?: PlaybackOptions): SheetCursor<K>;
  /** Source rect for an arbitrary state/frame (manual draws, HUD icons).
   *  Reused scratch — read, don't hold. */
  rect(state: K, frame: number): FrameRect;
}

/** Slice an image into a named-state sprite sheet. */
export function sheet<K extends string>(image: SheetImage, opts: SheetOptions<K>): Sheet<K> {
  // Captured HERE, while the app-bound service's `withClock` is still on the
  // stack: `play()` is called later from game code, where it has restored.
  const sheetClock = opts.clock ?? boundClock();
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

  const makeCursor = (initial: K, playOpts: PlaybackOptions, loop: boolean): SheetCursor<K> => {
    if (!states[initial]) throw new Error(`Anim.sheet: unknown state "${initial}"`);
    const clock = playOpts.clock ?? sheetClock ?? activeClock();
    let state = initial;
    let start = clock.now;
    let pausedAt: number | undefined;
    const now = () => pausedAt ?? clock.now;

    const frameIndex = (): number => {
      const spec = states[state];
      const n = Math.max(1, spec.frames);
      if (n === 1) return 0;
      const fps = spec.fps ?? 12;
      const idx = Math.floor(((now() - start) * fps) / 1000);
      return loop ? idx % n : Math.min(idx, n - 1);
    };

    const cursor: SheetCursor<K> = {
      sheet: self,
      get state() {
        return state;
      },
      set(next) {
        if (next !== state) {
          if (!states[next]) throw new Error(`Anim.sheet: unknown state "${next}"`);
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
        return frameIndex();
      },
      get rect() {
        return rectFor(state, frameIndex());
      },
      get done() {
        if (loop) return false;
        const spec = states[state];
        const n = Math.max(1, spec.frames);
        const fps = spec.fps ?? 12;
        return now() - start >= (n * 1000) / fps;
      },
    };
    return cursor;
  };

  const self: Sheet<K> = {
    image,
    frame: { w: fw, h: fh },
    rect: rectFor,
    once(initial, playOpts = {}) {
      return makeCursor(initial, playOpts, false);
    },
    play(initial, playOpts = {}) {
      return makeCursor(initial, playOpts, true);
    },
  };
  return self;
}
