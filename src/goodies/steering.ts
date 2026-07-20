// ---------- Steering, aiming and formations ----------
// Positioning things that move or spawn: turning toward a heading, leading a
// moving target, and laying out rings/grids of enemies, bullets or props.

import type { GridPoint } from "./grid.js";
import { wrap, wrappedDelta } from "./wrapping.js";

/** Move an angle toward a target by at most `maxDelta`, taking the shortest
 * route across the -π/π seam. Result is normalized to [-π, π). */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  const delta = wrappedDelta(current, target, Math.PI * 2);
  if (Math.abs(delta) <= maxDelta) return wrap(target, -Math.PI, Math.PI);
  return wrap(current + Math.sign(delta) * Math.max(0, maxDelta), -Math.PI, Math.PI);
}

export interface LeadTarget {
  x: number;
  y: number;
  time: number;
}

/** Predict where to aim a constant-speed projectile at a constant-velocity
 * target. Returns `null` when no future intercept exists. */
export function leadTarget(
  shooterX: number,
  shooterY: number,
  targetX: number,
  targetY: number,
  targetVx: number,
  targetVy: number,
  projectileSpeed: number,
): LeadTarget | null {
  if (!(projectileSpeed > 0)) return null;
  const rx = targetX - shooterX,
    ry = targetY - shooterY;
  const a = targetVx * targetVx + targetVy * targetVy - projectileSpeed * projectileSpeed;
  const b = 2 * (rx * targetVx + ry * targetVy);
  const c = rx * rx + ry * ry;
  let time = Infinity;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) time = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (-b - root) / (2 * a),
        t2 = (-b + root) / (2 * a);
      if (t1 > 0) time = t1;
      if (t2 > 0) time = Math.min(time, t2);
    }
  }
  if (!Number.isFinite(time) || time < 0) return null;
  return { x: targetX + targetVx * time, y: targetY + targetVy * time, time };
}

/** Even points around a circle for bullet rings, radial spawns and arena props. */
export function ringFormation(
  count: number,
  cx: number,
  cy: number,
  radius: number,
  phase = 0,
): Array<GridPoint & { angle: number }> {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = phase + (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle };
  });
}

/** Centered row-major formation for squads, invaders, cards and puzzle pieces. */
export function gridFormation(
  count: number,
  columns: number,
  spacingX: number,
  spacingY: number,
  cx = 0,
  cy = 0,
): GridPoint[] {
  if (count <= 0 || columns <= 0) return [];
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, i) => ({
    x: cx + ((i % columns) - (Math.min(columns, count) - 1) / 2) * spacingX,
    y: cy + (Math.floor(i / columns) - (rows - 1) / 2) * spacingY,
  }));
}

/** The closest item to (x, y) within `maxDist` (default: unbounded), or `null`.
 *  `getPos` reads a `{x, y}` off each item. The everyday targeting / pickup /
 *  interactable-select scan, in one place (and it compares squared distance —
 *  no per-item sqrt). */
export function nearest<T>(
  x: number,
  y: number,
  items: Iterable<T>,
  getPos: (item: T) => { x: number; y: number },
  maxDist = Infinity,
): T | null {
  let best: T | null = null;
  let bestD2 = maxDist * maxDist;
  for (const item of items) {
    const p = getPos(item);
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = item;
    }
  }
  return best;
}

/** Back-and-forth patrol between `min` and `max` along one axis. `tick(dist)`
 *  advances by `dist` (= speed × dt), reverses at each bound without jitter or
 *  overshoot, and returns the new position; `dir` is the current facing (+1 /
 *  -1) for flipping a sprite. Goombas, moving platforms, sweeping hazards. */
export interface Patrol {
  readonly pos: number;
  readonly dir: 1 | -1;
  tick(dist: number): number;
}

export function patrol(
  min: number,
  max: number,
  options: { start?: number; dir?: 1 | -1 } = {},
): Patrol {
  let pos = options.start ?? min;
  let dir: 1 | -1 = options.dir ?? 1;
  return {
    get pos() {
      return pos;
    },
    get dir() {
      return dir;
    },
    tick(dist) {
      pos += dir * dist;
      if (pos <= min) {
        pos = min;
        dir = 1;
      } else if (pos >= max) {
        pos = max;
        dir = -1;
      }
      return pos;
    },
  };
}

/** A fixed-length motion trail — `push(x, y)` each frame, read `points`
 *  (newest first) to draw a fading tail behind a ball/dash/cursor. Bounded ring
 *  so it never grows without limit. */
export interface Trail {
  push(x: number, y: number): void;
  readonly points: ReadonlyArray<{ x: number; y: number }>;
  clear(): void;
}

export function trail(maxLen: number): Trail {
  const points: Array<{ x: number; y: number }> = [];
  return {
    push(x, y) {
      points.unshift({ x, y });
      if (points.length > maxLen) points.pop();
    },
    get points() {
      return points;
    },
    clear() {
      points.length = 0;
    },
  };
}
