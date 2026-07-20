// ---------- Sprite-sheet animation ----------
// Slice a grid sprite sheet into frames and play them on a timeline. Pure frame
// math + timing — advance with `update(dtMs)` (e.g. Loop.step per fixed step).
//
//   const run = Minimotor.Anim.sheet(img, { fw: 32, fh: 32, fps: 12 });
//   run.update(Minimotor.Loop.step);
//   run.draw(ctx, x, y);                 // standalone, or…
//   Object.assign(sprite, run.rect);     // …drive an ECS Sprite's source rect

/** A rectangular region of the sheet image (px). Matches the `sx/sy/sw/sh`
 *  fields of the ECS `Sprite` component, so `Object.assign(sprite, anim.rect)`
 *  makes a sprite show the current frame. */
export interface FrameRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface SheetConfig {
  /** Frame width in px. */
  fw: number;
  /** Frame height in px. */
  fh: number;
  /** Playback speed in frames per second (default 12). */
  fps?: number;
  /** Grid columns; defaults to `floor(image.width / fw)`. */
  cols?: number;
  /** Which grid cells to play, in order. Defaults to every cell, row-major. */
  frames?: number[];
  /** Loop at the end (default true); when false, holds the last frame and sets
   *  `done`. */
  loop?: boolean;
  /** Called whenever the visible frame changes, with the new index into
   *  `frames` — footstep sounds, hit-frame triggers. */
  onFrame?: (frame: number) => void;
  /** Called once when a non-looping animation finishes. */
  onDone?: () => void;
}

/** Draw options for `Animation.draw`. */
export interface AnimDrawOptions {
  /** On-screen size (px); defaults to the frame size. */
  w?: number;
  h?: number;
  /** Anchor fraction; 0.5/0.5 (default) centers on the draw point. */
  ax?: number;
  ay?: number;
}

/** A playing sprite-sheet animation. */
export interface Animation {
  /** Advance the timeline by `dtMs` milliseconds. */
  update(dtMs: number): void;
  /** Current index into the configured `frames` list. */
  readonly frame: number;
  /** Source rect of the current frame (feed into an ECS Sprite). */
  readonly rect: FrameRect;
  /** True once a non-looping animation has reached its last frame. */
  readonly done: boolean;
  /** Jump back to the first frame and clear `done`. */
  reset(): void;
  /** Blit the current frame at `(dx, dy)` with the given options. */
  draw(ctx: CanvasRenderingContext2D, dx: number, dy: number, opts?: AnimDrawOptions): void;
}

/** A named set of animation clips with a single active state. Switching clips
 * resets the new clip by default, while repeatedly playing the current state
 * leaves its timeline uninterrupted. */
export interface AnimationStates<K extends string = string> extends Animation {
  /** Name of the active animation state. */
  readonly state: K;
  /** The active underlying clip. */
  readonly animation: Animation;
  /** Switch state. Returns true only when the state changed. */
  play(state: K, options?: { restart?: boolean }): boolean;
  /** Reset every clip and return to the initial state. */
  resetAll(): void;
}

type SheetImage = CanvasImageSource & { width: number; height: number };

/** Create an animation over a grid sprite sheet. */
export function sheet(image: SheetImage, config: SheetConfig): Animation {
  const { fw, fh } = config;
  const fps = config.fps ?? 12;
  const loop = config.loop ?? true;
  const cols = config.cols ?? Math.max(1, Math.floor(image.width / fw));
  const rows = Math.max(1, Math.floor(image.height / fh));
  const frames = config.frames ?? Array.from({ length: cols * rows }, (_, i) => i);
  const stepMs = fps > 0 ? 1000 / fps : Infinity;

  let index = 0; // index into `frames`
  let acc = 0;
  let done = false;

  function rectFor(cell: number): FrameRect {
    return { sx: (cell % cols) * fw, sy: Math.floor(cell / cols) * fh, sw: fw, sh: fh };
  }

  const self: Animation = {
    update(dtMs) {
      if (done || frames.length <= 1) return;
      acc += dtMs;
      let changed = false;
      while (acc >= stepMs) {
        acc -= stepMs;
        if (index + 1 < frames.length) {
          index++;
          changed = true;
        } else if (loop) {
          index = 0;
          changed = true;
        } else {
          done = true;
          acc = 0;
          config.onDone?.();
          break;
        }
      }
      if (changed) config.onFrame?.(index);
    },
    get frame() {
      return index;
    },
    get rect() {
      return rectFor(frames[index]);
    },
    get done() {
      return done;
    },
    reset() {
      index = 0;
      acc = 0;
      done = false;
    },
    draw(ctx, dx, dy, opts = {}) {
      const r = rectFor(frames[index]);
      const w = opts.w ?? fw;
      const h = opts.h ?? fh;
      const ax = opts.ax ?? 0.5;
      const ay = opts.ay ?? 0.5;
      ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, dx - ax * w, dy - ay * h, w, h);
    },
  };
  return self;
}

/** Combine animations into a named state player.
 *
 * ```ts
 * const hero = Anim.states({ idle: Anim.sheet(idle, idleCfg), run: Anim.sheet(run, runCfg) }, "idle");
 * hero.play(speed === 0 ? "idle" : "run");
 * hero.update(dt);
 * hero.draw(ctx, x, y);
 * ``` */
export function states<K extends string>(
  clips: Record<K, Animation>,
  initial: K,
): AnimationStates<K> {
  if (!clips[initial]) throw new Error(`Anim.states: missing initial state "${initial}"`);
  let current = initial;

  return {
    update(dtMs) {
      clips[current].update(dtMs);
    },
    get state() {
      return current;
    },
    get animation() {
      return clips[current];
    },
    get frame() {
      return clips[current].frame;
    },
    get rect() {
      return clips[current].rect;
    },
    get done() {
      return clips[current].done;
    },
    play(next, options = {}) {
      if (!clips[next]) throw new Error(`Anim.states: unknown state "${next}"`);
      if (next === current) {
        if (options.restart) clips[current].reset();
        return false;
      }
      current = next;
      clips[current].reset();
      return true;
    },
    reset() {
      clips[current].reset();
    },
    resetAll() {
      for (const clip of Object.values<Animation>(clips)) clip.reset();
      current = initial;
    },
    draw(ctx, dx, dy, opts) {
      clips[current].draw(ctx, dx, dy, opts);
    },
  };
}
