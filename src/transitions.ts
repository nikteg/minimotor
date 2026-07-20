// ---------- Scene transitions ----------
// Cover → swap → reveal: an overlay ramps to full coverage, the scene switches
// behind it at the midpoint, then the overlay ramps back out. Pass one to
// `Scenes.go`:
//
//   Minimotor.Scenes.go("play", Minimotor.Transitions.fade(400));
//   Minimotor.Scenes.go("over", Minimotor.Transitions.wipe(500, "down"));
//
// A `Transition` is plain data (duration + how to draw coverage `t`), so custom
// ones are one object literal. The runner (`run`) is pure and fixed-step —
// testable without an engine; the `Scenes` facade drives it for you.

import type { Viewport } from "./engine.js";

/** Draws the transition overlay. `t` is coverage 0..1 — 0 means the scene is
 *  fully visible, 1 fully covered. Called once per frame while active. */
export type TransitionRender = (
  ctx: CanvasRenderingContext2D,
  t: number,
  vp: Pick<Viewport, "w" | "h">,
) => void;

export interface Transition {
  /** Full duration in ms — half covering, half revealing. */
  durationMs: number;
  render: TransitionRender;
}

/** Classic fade through a solid color. */
export function fade(durationMs = 400, color = "#000"): Transition {
  return {
    durationMs,
    render(ctx, t, vp) {
      ctx.save();
      ctx.globalAlpha = t;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, vp.w, vp.h);
      ctx.restore();
    },
  };
}

/** A solid curtain sweeping across the screen. `dir` is the direction the
 *  leading edge travels while covering. */
export function wipe(
  durationMs = 400,
  dir: "left" | "right" | "up" | "down" = "left",
  color = "#000",
): Transition {
  return {
    durationMs,
    render(ctx, t, vp) {
      ctx.save();
      ctx.fillStyle = color;
      const w = vp.w * t;
      const h = vp.h * t;
      if (dir === "left") ctx.fillRect(vp.w - w, 0, w, vp.h);
      else if (dir === "right") ctx.fillRect(0, 0, w, vp.h);
      else if (dir === "up") ctx.fillRect(0, vp.h - h, vp.w, h);
      else ctx.fillRect(0, 0, vp.w, h);
      ctx.restore();
    },
  };
}

/** A live transition being played out. Drive `advance` on the fixed step and
 *  `draw` once per frame (after the scenes have drawn). */
export interface TransitionRun {
  /** Advance by `dtMs`; fires the swap exactly once at the midpoint. */
  advance(dtMs: number): void;
  /** Draw the overlay at the current coverage. */
  draw(ctx: CanvasRenderingContext2D, vp: Pick<Viewport, "w" | "h">): void;
  /** True once the reveal has finished. */
  readonly done: boolean;
}

/** Start a transition: `swap` is called at full coverage (the scene switch the
 *  viewer never sees happen). Pure — no engine dependency. */
export function run(spec: Transition, swap: () => void): TransitionRun {
  const half = spec.durationMs / 2;
  let elapsed = 0;
  let swapped = false;

  return {
    advance(dtMs) {
      elapsed += dtMs;
      if (!swapped && elapsed >= half) {
        swapped = true;
        swap();
      }
    },
    draw(ctx, vp) {
      const t = elapsed < half ? elapsed / half : 1 - (elapsed - half) / half;
      spec.render(ctx, Math.max(0, Math.min(1, t)), vp);
    },
    get done() {
      return elapsed >= spec.durationMs;
    },
  };
}
