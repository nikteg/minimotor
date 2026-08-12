// ---------- Skid marks: rubber a car lays down while drifting ----------
// A little machine that, while the tyres are scrubbing, stitches dark segments
// end-to-end under each tyre — an unbroken streak, not dots or dashes: every new
// segment starts exactly where the last one ended, and a fresh slide only begins
// after the tyres stop marking. Tyre positions are given in car-local space, so
// any layout works (two rear wheels, all four, a bike's two, a six-wheeler…).
// Marks age out over `life` seconds, or set `life: Infinity` to make them
// permanent (capped by `max`). Emission is throttled so density is frame-rate-
// independent. Feed it the car's pose each fixed step; draw it in WORLD space
// (inside your camera block, under the car).
//
//    const skids = Gizmos.skidmarks();
//    // each fixed step:
//    skids.trace(body.x, body.y, body.rot, { marking: car.tireSlip > 40 }, dt);
//    // in draw, world space, before the car:
//    skids.draw(Draw.ctx);

/** A tyre's mounting point in car-local space, relative to the car centre. */
export interface Wheel {
  /** Distance forward (+) / back (−) of centre, px. */
  along: number;
  /** Distance right (+) / left (−) of centre, px. */
  across: number;
}

/** Tuning for `skidmarks()`: mark lifetime, density, wheel layout and stroke. */
export interface SkidmarksOptions {
  /** Seconds a mark lives before fully fading. `Infinity` = permanent. Default 9. */
  life?: number;
  /** Fade-out window at the end of life, seconds (ignored when permanent). Default 2. */
  fade?: number;
  /** Hard cap on stored segments (oldest drop first). Default 700. */
  max?: number;
  /** Minimum seconds between emissions — throttles density. Default 0.025. */
  emitEvery?: number;
  /** Tyre positions in car-local space. Default: two rear wheels derived from
   *  `rearAxle` / `wheelSpread`. Provide this for any other layout. */
  wheels?: Wheel[];
  /** Convenience for the DEFAULT two rear wheels: axle distance behind centre, px. Default 21. */
  rearAxle?: number;
  /** Convenience for the DEFAULT two rear wheels: half-track offset, px. Default 11. */
  wheelSpread?: number;
  /** Rubber colour. Default "#080c0d". */
  color?: string;
  /** Stroke width, px. Default 3. */
  width?: number;
}

/** Per-step input to `Skidmarks.trace()`: whether the tyres are scrubbing and how dark. */
export interface TraceInput {
  /** Are the tyres scrubbing this step? (No mark laid when false.) */
  marking: boolean;
  /** Darkness 0..1 of fresh rubber (e.g. from slip). Default 0.45. */
  alpha?: number;
}

/** A skid-mark gadget returned by `skidmarks()`: `trace()` each step, `draw()` under the car. */
export interface Skidmarks {
  /** Advance the marks by `dt`, and — if `marking` — lay a segment under each
   *  tyre from its previous position. Call once per fixed step. */
  trace(x: number, y: number, angle: number, input: TraceInput, dt: number): void;
  /** Stroke all live marks (newest darkest). Call in world space, under the car. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Drop every mark (e.g. on a race restart). */
  clear(): void;
  /** How many segments are currently stored. */
  readonly count: number;
}

interface Mark {
  x: number;
  y: number;
  x2: number;
  y2: number;
  life: number;
  alpha: number;
}

/** Create a skid-mark gadget. `trace()` it each step with the car's pose and
 *  whether the tyres are scrubbing; `draw()` it under the car in world space. */
export function skidmarks(options: SkidmarksOptions = {}): Skidmarks {
  const life = options.life ?? 9;
  const permanent = !Number.isFinite(life);
  const fade = options.fade ?? 2;
  const max = options.max ?? 700;
  const emitEvery = options.emitEvery ?? 0.025;
  const color = options.color ?? "#080c0d";
  const width = options.width ?? 3;
  // Default tyre layout: two rear wheels either side of the axle.
  const rearAxle = options.rearAxle ?? 21;
  const spread = options.wheelSpread ?? 11;
  const wheels: Wheel[] = options.wheels ?? [
    { along: -rearAxle, across: -spread },
    { along: -rearAxle, across: spread },
  ];

  const marks: Mark[] = [];
  // The world position each tyre last STAMPED (not last frame) — so the next
  // segment starts exactly where the last one ended and the streak is unbroken.
  // Null between drifts (pen up), so separate slides don't join across the gap.
  let anchor: Array<{ x: number; y: number }> | null = null;
  let timer = 0;

  return {
    get count() {
      return marks.length;
    },
    trace(x, y, angle, input, dt) {
      if (!permanent) {
        for (let i = marks.length - 1; i >= 0; i--) {
          marks[i].life -= dt;
          if (marks[i].life <= 0) marks.splice(i, 1);
        }
      }
      timer -= dt;
      if (!input.marking) {
        anchor = null; // pen up — end the current streak
        return;
      }
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // Each tyre's world position: along the heading + across it (right = +).
      const now = wheels.map((w) => ({
        x: x + c * w.along + s * w.across,
        y: y + s * w.along - c * w.across,
      }));

      if (!anchor) {
        anchor = now; // pen down — start a fresh streak from here (no segment yet)
        return;
      }
      if (timer <= 0) {
        const alpha = input.alpha ?? 0.45;
        for (let i = 0; i < now.length; i++) {
          const p = anchor[i];
          marks.push({ x: p.x, y: p.y, x2: now[i].x, y2: now[i].y, life, alpha });
        }
        if (marks.length > max) marks.splice(0, marks.length - max);
        anchor = now; // advance the anchor so the next segment connects to this one
        timer = emitEvery;
      }
    },
    draw(ctx) {
      if (marks.length === 0) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      for (const m of marks) {
        // Permanent marks stay solid; timed marks fade over their final `fade` s.
        ctx.globalAlpha = permanent ? m.alpha : m.alpha * Math.min(1, m.life / fade);
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x2, m.y2);
        ctx.stroke();
      }
      ctx.restore();
    },
    clear() {
      marks.length = 0;
      anchor = null;
      timer = 0;
    },
  };
}
