// ---------- Collision helpers ----------
// Pure, allocation-free overlap tests. No engine state — just geometry.

import type { Rect } from "./engine/index.js";

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

/** Is the point inside the rect? Edges count as inside — the natural choice
 *  for pointer hit-testing (a click on a button's border should register). */
export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
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
  /** `y` component of that hit-face normal (see `nx`). */
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

/** A contact: unit normal (pointing OUT of the obstacle, toward the mover) and
 *  penetration `depth` — add `nx*depth, ny*depth` to the mover to separate it. */
export interface Contact {
  /** `x` of the unit normal, pointing out of the obstacle toward the mover. */
  nx: number;
  /** `y` of the unit normal, pointing out of the obstacle toward the mover. */
  ny: number;
  /** Penetration depth along the normal; slide `nx*depth, ny*depth` to separate. */
  depth: number;
}

/** Circle-vs-rectangle overlap. Returns the contact normal + penetration depth,
 *  or `null` when clear. The normal points from the rect toward the circle, so
 *  it doubles as the bounce direction — no more `Math.abs(dx) > Math.abs(dy)`
 *  guessing which way to reflect a ball off a brick/paddle/wall. When the centre
 *  is inside the rect it pushes out the nearest edge. */
export function circleRect(cx: number, cy: number, r: number, rect: Rect): Contact | null {
  const nearX = cx < rect.x ? rect.x : cx > rect.x + rect.w ? rect.x + rect.w : cx;
  const nearY = cy < rect.y ? rect.y : cy > rect.y + rect.h ? rect.y + rect.h : cy;
  const dx = cx - nearX;
  const dy = cy - nearY;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 === 0) {
    // Centre inside the rect: escape via the nearest edge.
    const left = cx - rect.x;
    const right = rect.x + rect.w - cx;
    const top = cy - rect.y;
    const bottom = rect.y + rect.h - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { nx: -1, ny: 0, depth: r + left };
    if (m === right) return { nx: 1, ny: 0, depth: r + right };
    if (m === top) return { nx: 0, ny: -1, depth: r + top };
    return { nx: 0, ny: 1, depth: r + bottom };
  }
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, depth: r - d };
}

/** Minimum-translation contact between two overlapping circles (normal points
 *  from `b` toward `a`), or `null` if apart. Coincident centres push along +x.
 *  For separating jostling bodies — enemies, physics balls, crowd agents. */
export function separateCircles(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): Contact | null {
  const dx = ax - bx;
  const dy = ay - by;
  const d2 = dx * dx + dy * dy;
  const r = ar + br;
  if (d2 >= r * r) return null;
  if (d2 === 0) return { nx: 1, ny: 0, depth: r };
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, depth: r - d };
}

/** Which walls a body bounced off this step. */
export interface BounceFaces {
  /** True if any wall was bounced off this step (`left || right || top || bottom`). */
  hit: boolean;
  /** Bounced off the left wall of `bounds` this step. */
  left: boolean;
  /** Bounced off the right wall of `bounds` this step. */
  right: boolean;
  /** Bounced off the top wall of `bounds` this step. */
  top: boolean;
  /** Bounced off the bottom wall of `bounds` this step. */
  bottom: boolean;
}

/** Keep a moving box inside `bounds`, reflecting its velocity off each wall it
 *  crosses — Pong/Breakout/screensaver bouncing. Mutates `rect.x/y` (clamped
 *  back inside) and `vel.x/y` (negated per hit face), and reports the faces.
 *  Only flips a velocity component that points INTO the wall, so a body pinned
 *  against an edge won't jitter or stick — the classic double-bounce bug. */
export function bounceInBounds(
  rect: Rect,
  vel: { x: number; y: number },
  bounds: Rect,
): BounceFaces {
  const faces: BounceFaces = { hit: false, left: false, right: false, top: false, bottom: false };
  if (rect.x < bounds.x) {
    rect.x = bounds.x;
    if (vel.x < 0) vel.x = -vel.x;
    faces.left = faces.hit = true;
  } else if (rect.x + rect.w > bounds.x + bounds.w) {
    rect.x = bounds.x + bounds.w - rect.w;
    if (vel.x > 0) vel.x = -vel.x;
    faces.right = faces.hit = true;
  }
  if (rect.y < bounds.y) {
    rect.y = bounds.y;
    if (vel.y < 0) vel.y = -vel.y;
    faces.top = faces.hit = true;
  } else if (rect.y + rect.h > bounds.y + bounds.h) {
    rect.y = bounds.y + bounds.h - rect.h;
    if (vel.y > 0) vel.y = -vel.y;
    faces.bottom = faces.hit = true;
  }
  return faces;
}

// ---------- Move-and-slide (platformer resolution) ----------
// Two altitudes (API_PLAN #13/#14):
//   slide()         — MECHANISM: swept move, slides along solids, reports
//                     contacts. Touches nothing but position.
//   moveAndSlide()  — POLICY: the default path — reads body.vel, zeroes the
//                     blocked components, sets body.grounded. Custom policy
//                     (bounce, sticky walls) drops down to slide().

/** A static obstacle. `oneWay` platforms collide only when landed on from
 *  above (pass through from below/sides) — the classic jump-through shelf. */
export type Solid = Rect & { oneWay?: boolean };

/** Anything that can answer "which solids are near this area?" — tile maps
 *  implement this for O(1) broadphase. `out` is appended to and returned. */
export interface SolidSource {
  /** Append every `Solid` overlapping `area` (broadphase) to `out` and return
   *  it. Over-reporting is fine; the sweep discards non-hits. */
  solidsNear(area: Rect, out: Solid[]): Solid[];
}

/** Solids for slide/moveAndSlide: a plain array, a source (tile map), or a
 *  mixed array of both — `[level, movingPlatform]`. */
export type Solids = Solid[] | SolidSource | Array<Solid | SolidSource>;

/** Which sides touched during a slide, plus the entry speed (px/step) into
 *  the first blocking surface — 0 when contact-free. Reused scratch object:
 *  read, don't hold. */
export interface Contacts {
  /** Blocked moving up — the mover's top hit a ceiling (bonk). */
  up: boolean;
  /** Blocked moving down — landed on a floor/platform (`grounded`). */
  down: boolean;
  /** Blocked moving left — hit a wall on the left. */
  left: boolean;
  /** Blocked moving right — hit a wall on the right. */
  right: boolean;
  /** Entry speed (px/step) into the first blocking surface; `0` if contact-free. */
  impact: number;
}

/** A body moveAndSlide can drive: position + size + velocity + grounded.
 *  Structural — any plain object with the fields qualifies. */
export interface MoverBody extends Rect {
  /** Velocity in px/step; `moveAndSlide` zeroes the blocked components. */
  vel: { x: number; y: number };
  /** Resting on a floor — set by `moveAndSlide` to its `down` contact. */
  grounded: boolean;
}

const SKIN = 0.0001; // nudge off surfaces so floats don't re-collide
const slideContacts: Contacts = { up: false, down: false, left: false, right: false, impact: 0 };
const slideArea: Rect = { x: 0, y: 0, w: 0, h: 0 };
const slideCandidates: Solid[] = [];

function isSource(s: Solid | SolidSource): s is SolidSource {
  return typeof (s as SolidSource).solidsNear === "function";
}

function gather(solids: Solids, area: Rect): Solid[] {
  slideCandidates.length = 0;
  if (Array.isArray(solids)) {
    for (const s of solids) {
      if (isSource(s)) s.solidsNear(area, slideCandidates);
      else slideCandidates.push(s);
    }
  } else {
    solids.solidsNear(area, slideCandidates);
  }
  return slideCandidates;
}

/** Swept move-and-slide: advance `rect` by `vel`, sliding along `solids` —
 *  no tunneling at speed. Returns which sides touched (scratch object).
 *  Deliberately does NOT touch velocity or grounded: what a contact MEANS is
 *  game policy (see `moveAndSlide` for the default). */
export function slide(rect: Rect, vel: { x: number; y: number }, solids: Solids): Contacts {
  const c = slideContacts;
  c.up = c.down = c.left = c.right = false;
  c.impact = 0;

  let dx = vel.x;
  let dy = vel.y;

  slideArea.x = Math.min(rect.x, rect.x + dx) - 1;
  slideArea.y = Math.min(rect.y, rect.y + dy) - 1;
  slideArea.w = rect.w + Math.abs(dx) + 2;
  slideArea.h = rect.h + Math.abs(dy) + 2;
  const sols = gather(solids, slideArea);

  // Up to 3 passes: each finds the earliest contact, advances to it, kills
  // the blocked component and continues with the tangential remainder.
  for (let iter = 0; iter < 3 && (dx !== 0 || dy !== 0); iter++) {
    let best: Sweep | null = null;
    for (const s of sols) {
      if (s.oneWay) {
        if (dy <= 0) continue; // pass through unless falling…
        if (rect.y + rect.h > s.y + SKIN) continue; // …from fully above the top
      }
      const hit = sweptAABB(rect, dx, dy, s);
      if (!hit) continue;
      if (s.oneWay && hit.ny !== -1) continue; // only the top face is solid
      if (!best || hit.t < best.t) best = hit;
    }
    if (!best) {
      rect.x += dx;
      rect.y += dy;
      break;
    }
    rect.x += dx * best.t;
    rect.y += dy * best.t;
    const rem = 1 - best.t;
    if (best.nx !== 0) {
      if (best.nx < 0) c.right = true;
      else c.left = true;
      c.impact = Math.max(c.impact, Math.abs(dx));
      rect.x += best.nx * SKIN;
      dx = 0;
      dy *= rem;
    } else {
      if (best.ny < 0) c.down = true;
      else c.up = true;
      c.impact = Math.max(c.impact, Math.abs(dy));
      rect.y += best.ny * SKIN;
      dy = 0;
      dx *= rem;
    }
  }
  return c;
}

/** The default platformer path: swept-slides `body` by `body.vel`, zeroes
 *  the blocked velocity components (land/bonk clears `vel.y`, walls clear
 *  `vel.x`), sets `body.grounded`, honors `oneWay`. Still returns the
 *  contacts (wall jumps read `left`/`right`; shake reads `impact`). */
export function moveAndSlide(body: MoverBody, solids: Solids): Contacts {
  const c = slide(body, body.vel, solids);
  if (c.left || c.right) body.vel.x = 0;
  if (c.up || c.down) body.vel.y = 0;
  body.grounded = c.down;
  return c;
}
