// ---------- Collision helpers ----------
// Pure, allocation-free overlap tests. No engine state — just geometry.

import type { Rect } from "./engine.js";

/** Axis-aligned rectangle overlap (touching edges do NOT count as overlap). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Circle/circle overlap test (centers + radii). Cheaper than it looks — no
 *  sqrt. Handy for coin pickups, blast radii, proximity checks. */
export function circleHit(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}

/** Did a downward-moving edge cross a horizontal threshold this step? True when
 *  `prev` was at/above `threshold` and `next` is at/below it. One-way (guard
 *  with velocity if you only want descents) — the test for landing on a
 *  platform/floor, or a body sinking past a trigger line. */
export function crossedDown(prev: number, next: number, threshold: number): boolean {
  return prev <= threshold && next >= threshold;
}

/** Result of a swept collision: when contact begins and on which face. */
export interface Sweep {
  /** Fraction of the motion (0..1) at which `a` first touches `b`. */
  t: number;
  /** Surface normal of the hit face on `b`: (±1,0) for a vertical face,
   *  (0,±1) for a horizontal one. */
  nx: number;
  ny: number;
}

/** Swept AABB: does box `a`, moving by (`dx`,`dy`) this step, hit static box `b`
 *  along the way? Catches tunneling — a fast body skipping through a thin target
 *  between frames — that a point-in-time `rectsOverlap` misses.
 *
 *  Returns the entry fraction + hit normal, or `null` if the move stays clear.
 *  Note: boxes that *already* overlap at the start report `null` here (their
 *  entry is in the past) — pair with `rectsOverlap` if you also want to catch
 *  the resting-overlap case. For relative motion, pass `a`'s velocity minus
 *  `b`'s. */
export function sweptAABB(a: Rect, dx: number, dy: number, b: Rect): Sweep | null {
  // Entry/exit distances to `b`'s near/far faces along each axis.
  let xEntry: number, xExit: number, yEntry: number, yExit: number;

  if (dx === 0) {
    // No horizontal motion: only collide if already overlapping in x.
    if (a.x + a.w <= b.x || a.x >= b.x + b.w) return null;
    xEntry = -Infinity;
    xExit = Infinity;
  } else {
    const near = dx > 0 ? b.x - (a.x + a.w) : b.x + b.w - a.x;
    const far = dx > 0 ? b.x + b.w - a.x : b.x - (a.x + a.w);
    xEntry = near / dx;
    xExit = far / dx;
  }

  if (dy === 0) {
    if (a.y + a.h <= b.y || a.y >= b.y + b.h) return null;
    yEntry = -Infinity;
    yExit = Infinity;
  } else {
    const near = dy > 0 ? b.y - (a.y + a.h) : b.y + b.h - a.y;
    const far = dy > 0 ? b.y + b.h - a.y : b.y - (a.y + a.h);
    yEntry = near / dy;
    yExit = far / dy;
  }

  const entry = Math.max(xEntry, yEntry);
  const exit = Math.min(xExit, yExit);

  // Miss if the axes never overlap together, the hit is in the past, or beyond
  // this step's motion.
  if (entry > exit || entry > 1 || (xEntry < 0 && yEntry < 0)) return null;
  if (entry < 0) return null;

  // The later-entering axis is the one we actually hit.
  if (xEntry > yEntry) return { t: entry, nx: dx < 0 ? 1 : -1, ny: 0 };
  return { t: entry, nx: 0, ny: dy < 0 ? 1 : -1 };
}
