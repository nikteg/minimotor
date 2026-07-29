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
  const out: Sweep = { t: 0, nx: 0, ny: 0 };
  return sweptAABBInto(a, dx, dy, b, out) ? out : null;
}

/** Allocation-free core of `sweptAABB`: writes the result into `out` and
 *  returns whether the sweep hit — the hot slide loop reuses scratch Sweeps
 *  through this instead of allocating one per candidate solid. */
function sweptAABBInto(a: Rect, dx: number, dy: number, b: Rect, out: Sweep): boolean {
  // Entry/exit distances to `b`'s near/far faces along each axis.
  let xEntry: number, xExit: number, yEntry: number, yExit: number;

  if (dx === 0) {
    // No horizontal motion: only collide if already overlapping in x.
    if (a.x + a.w <= b.x || a.x >= b.x + b.w) return false;
    xEntry = -Infinity;
    xExit = Infinity;
  } else {
    const near = dx > 0 ? b.x - (a.x + a.w) : b.x + b.w - a.x;
    const far = dx > 0 ? b.x + b.w - a.x : b.x - (a.x + a.w);
    xEntry = near / dx;
    xExit = far / dx;
  }

  if (dy === 0) {
    if (a.y + a.h <= b.y || a.y >= b.y + b.h) return false;
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
  if (entry > exit || entry > 1 || entry < 0) return false;

  // The later-entering axis is the one we actually hit.
  out.t = entry;
  if (xEntry > yEntry) {
    out.nx = dx < 0 ? 1 : -1;
    out.ny = 0;
  } else {
    out.nx = 0;
    out.ny = dy < 0 ? 1 : -1;
  }
  return true;
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

// Reused scratch contacts (one per function so neither clobbers the other) —
// valid until the next call: read, don't hold.
const circleRectContact: Contact = { nx: 0, ny: 0, depth: 0 };
const separateContact: Contact = { nx: 0, ny: 0, depth: 0 };

function fillContact(c: Contact, nx: number, ny: number, depth: number): Contact {
  c.nx = nx;
  c.ny = ny;
  c.depth = depth;
  return c;
}

/** Circle-vs-rectangle overlap. Returns the contact normal + penetration depth,
 *  or `null` when clear. The normal points from the rect toward the circle, so
 *  it doubles as the bounce direction — no more `Math.abs(dx) > Math.abs(dy)`
 *  guessing which way to reflect a ball off a brick/paddle/wall. When the centre
 *  is inside the rect it pushes out the nearest edge. The result is a reused
 *  scratch object, valid until the next call: read, don't hold. */
export function circleRect(cx: number, cy: number, r: number, rect: Rect): Contact | null {
  const nearX = cx < rect.x ? rect.x : cx > rect.x + rect.w ? rect.x + rect.w : cx;
  const nearY = cy < rect.y ? rect.y : cy > rect.y + rect.h ? rect.y + rect.h : cy;
  const dx = cx - nearX;
  const dy = cy - nearY;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  const c = circleRectContact;
  if (d2 === 0) {
    // Centre inside the rect: escape via the nearest edge.
    const left = cx - rect.x;
    const right = rect.x + rect.w - cx;
    const top = cy - rect.y;
    const bottom = rect.y + rect.h - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return fillContact(c, -1, 0, r + left);
    if (m === right) return fillContact(c, 1, 0, r + right);
    if (m === top) return fillContact(c, 0, -1, r + top);
    return fillContact(c, 0, 1, r + bottom);
  }
  const d = Math.sqrt(d2);
  return fillContact(c, dx / d, dy / d, r - d);
}

/** Minimum-translation contact between two overlapping circles (normal points
 *  from `b` toward `a`), or `null` if apart. Coincident centres push along +x.
 *  For separating jostling bodies — enemies, physics balls, crowd agents. The
 *  result is a reused scratch object, valid until the next call: read, don't
 *  hold. */
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
  if (d2 === 0) return fillContact(separateContact, 1, 0, r);
  const d = Math.sqrt(d2);
  return fillContact(separateContact, dx / d, dy / d, r - d);
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

// Reused scratch result for bounceInBounds — valid until the next call: read,
// don't hold (same contract as moveAndSlide's contacts).
const bounceFaces: BounceFaces = {
  hit: false,
  left: false,
  right: false,
  top: false,
  bottom: false,
};

/** Keep a moving box inside `bounds`, reflecting its velocity off each wall it
 *  crosses — Pong/Breakout/screensaver bouncing. Mutates `rect.x/y` (clamped
 *  back inside) and `vel.x/y` (negated per hit face), and reports the faces.
 *  Only flips a velocity component that points INTO the wall, so a body pinned
 *  against an edge won't jitter or stick — the classic double-bounce bug.
 *  The returned faces are a reused scratch object, valid until the next call:
 *  read, don't hold. */
export function bounceInBounds(
  rect: Rect,
  vel: { x: number; y: number },
  bounds: Rect,
): BounceFaces {
  const faces = bounceFaces;
  faces.hit = faces.left = faces.right = faces.top = faces.bottom = false;
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

/** Direction a slope rises toward. `"up-right"` has its low end on the left;
 * `"up-left"` has its low end on the right. */
export type SlopeDirection = "up-left" | "up-right";

/** A static obstacle. `oneWay` platforms collide only when landed on from
 * above. A `slope` is a walkable diagonal surface across the rect. */
export type Solid = Rect & { oneWay?: boolean; slope?: SlopeDirection };

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

/** Surface y at world `x` on a slope, clamped to its horizontal extent. */
export function slopeY(slope: Solid & { slope: SlopeDirection }, x: number): number {
  const t = Math.max(0, Math.min(1, (x - slope.x) / slope.w));
  return slope.slope === "up-right" ? slope.y + slope.h * (1 - t) : slope.y + slope.h * t;
}

/** Anything that can append nearby ladder rectangles. Tile levels implement
 * this when their legend contains `{ ladder: true }`. */
export interface LadderSource {
  laddersNear(area: Rect, out: Rect[]): Rect[];
}

/** Ladder rectangles or a queryable level. */
export type Ladders = Rect[] | LadderSource;

/** Options for `climbLadder`. */
export interface ClimbLadderOptions {
  /** Whether the body was already climbing last step. */
  active?: boolean;
  /** Grab an overlapping ladder without vertical input. Default false. */
  autoGrab?: boolean;
  /** Vertical climb speed in px/step. Default 3. */
  speed?: number;
  /** Horizontal centering strength, 0..1. Default 0.35. */
  snap?: number;
  /** Horizontal movement input, -1..1. Any deliberate input detaches from
   *  the ladder and prevents immediate re-entry. */
  horizontal?: number;
}

const ladderCandidates: Rect[] = [];

/** Apply terse platformer ladder movement. Pressing a vertical `axis` while
 * overlapping a ladder enters it; `autoGrab` can enter on contact instead.
 * Pass the returned boolean back as `active` next step to remain attached
 * while the axis is neutral.
 *
 *     climbing = Collision.climbLadder(player, level, input.axis("up", "down"), {
 *       active: climbing,
 *     });
 *
 * While active this centers the body, sets `vel.y`, and clears `grounded`.
 * Gravity and jump-to-detach remain game policy. */
export function climbLadder(
  body: MoverBody,
  ladders: Ladders,
  axis: number,
  opts: ClimbLadderOptions = {},
): boolean {
  if (Math.abs(opts.horizontal ?? 0) > 0.1) return false;
  ladderCandidates.length = 0;
  const area = { x: body.x, y: body.y, w: body.w, h: body.h };
  const candidates = Array.isArray(ladders) ? ladders : ladders.laddersNear(area, ladderCandidates);
  let ladder: Rect | undefined;
  for (const candidate of candidates) {
    if (rectsOverlap(body, candidate)) {
      ladder = candidate;
      break;
    }
  }
  if (!ladder || (!opts.active && !opts.autoGrab && Math.abs(axis) < 0.1)) return false;
  const targetX = ladder.x + (ladder.w - body.w) / 2;
  body.x += (targetX - body.x) * Math.max(0, Math.min(1, opts.snap ?? 0.35));
  body.vel.y = Math.max(-1, Math.min(1, axis)) * (opts.speed ?? 3);
  body.grounded = false;
  return true;
}

// ---------- Uniform-grid broadphase ----------

/** A `SolidSource` that buckets loose solids into a uniform grid. */
export interface SolidGrid extends SolidSource {
  /** Re-bucket for a changed set of solids. The grid holds the `Solid` objects
   *  themselves, so moving one by mutating its `x`/`y` needs a rebuild — this
   *  is a broadphase for *static* geometry. */
  rebuild(solids: Solid[]): void;
  /** How many solids are currently indexed. */
  readonly size: number;
}

// Cell coordinates are shifted positive and packed into one number so buckets
// key off a number instead of a per-lookup string. Exact for |cell| < 2^20,
// which at a 64px cell is ±67M px; past that keys can collide, and a collision
// only ever over-reports — which `solidsNear` explicitly permits.
const CELL_ORIGIN = 1 << 20;
const CELL_SPAN = 1 << 21;

/** Bucket static solids into a uniform grid for O(1)-ish broadphase, so a
 *  sliding body sweeps only the handful of solids near it instead of all of
 *  them. Pass the result anywhere `Solids` is taken:
 *
 *      const level = Collision.grid(crates, 64);   // once, at load
 *      Collision.moveAndSlide(player, level);      // every step
 *
 *  `cellSize` wants to be roughly the size of a typical solid: too small and
 *  big solids land in many buckets, too large and each bucket holds too much.
 *  Solids larger than a cell are indexed in every cell they touch and still
 *  reported once per query. */
export function grid(solids: Solid[], cellSize: number): SolidGrid {
  if (!(cellSize > 0)) throw new Error("Collision.grid: cellSize must be > 0");
  const cells = new Map<number, number[]>();
  let items: Solid[] = [];
  // Per-query stamps dedupe solids that straddle several cells without
  // allocating a Set per call.
  let stamps = new Uint32Array(0);
  let stamp = 0;

  const build = (next: Solid[]): void => {
    cells.clear();
    items = next;
    if (stamps.length < items.length) stamps = new Uint32Array(items.length);
    else stamps.fill(0);
    stamp = 0;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const x0 = Math.floor(s.x / cellSize);
      const x1 = Math.floor((s.x + s.w) / cellSize);
      const y0 = Math.floor(s.y / cellSize);
      const y1 = Math.floor((s.y + s.h) / cellSize);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = (cx + CELL_ORIGIN) * CELL_SPAN + (cy + CELL_ORIGIN);
          const bucket = cells.get(key);
          if (bucket) bucket.push(i);
          else cells.set(key, [i]);
        }
      }
    }
  };
  build(solids);

  return {
    rebuild: build,
    get size() {
      return items.length;
    },
    solidsNear(area, out) {
      if (items.length === 0) return out;
      // Wrap the stamp counter rather than letting it overflow to a value a
      // stale entry might already hold.
      if (stamp === 0xffffffff) {
        stamps.fill(0);
        stamp = 0;
      }
      const mark = ++stamp;
      const x0 = Math.floor(area.x / cellSize);
      const x1 = Math.floor((area.x + area.w) / cellSize);
      const y0 = Math.floor(area.y / cellSize);
      const y1 = Math.floor((area.y + area.h) / cellSize);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const bucket = cells.get((cx + CELL_ORIGIN) * CELL_SPAN + (cy + CELL_ORIGIN));
          if (!bucket) continue;
          for (const i of bucket) {
            if (stamps[i] === mark) continue;
            stamps[i] = mark;
            out.push(items[i]);
          }
        }
      }
      return out;
    },
  };
}

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
// Scratch Sweeps for the slide loop: one per-candidate probe, one best-so-far.
const slideSweep: Sweep = { t: 0, nx: 0, ny: 0 };
const slideBest: Sweep = { t: 0, nx: 0, ny: 0 };

function isSource(s: Solid | SolidSource): s is SolidSource {
  return typeof (s as SolidSource).solidsNear === "function";
}

// Whether an array holds any SolidSource, memoized per array. Levels are
// usually one long-lived array walked every step by every mover, so re-deriving
// this from scratch each call is pure overhead. Keyed by array identity and
// invalidated by length, which covers building up or tearing down a level.
// Swapping a source INTO an existing array in place, without changing its
// length, is the one mutation this won't notice — pass a new array for that.
const plainScan = new WeakMap<object, { len: number; plain: boolean }>();

function isPlain(solids: Array<Solid | SolidSource>): boolean {
  const memo = plainScan.get(solids);
  if (memo && memo.len === solids.length) return memo.plain;
  let plain = true;
  for (const s of solids) {
    if (isSource(s)) {
      plain = false;
      break;
    }
  }
  plainScan.set(solids, { len: solids.length, plain });
  return plain;
}

function gather(solids: Solids, area: Rect): Solid[] {
  if (Array.isArray(solids)) {
    // Fast path: a plain Solid[] with no sources is read-only to the slide
    // loop, so use it as-is — no per-call element copy.
    if (isPlain(solids)) return solids as Solid[];
    slideCandidates.length = 0;
    for (const s of solids) {
      if (isSource(s)) s.solidsNear(area, slideCandidates);
      else slideCandidates.push(s);
    }
    return slideCandidates;
  }
  slideCandidates.length = 0;
  return solids.solidsNear(area, slideCandidates);
}

/** A fresh, zeroed `Contacts` — pass it as the `out` argument to `slide` /
 *  `moveAndSlide` when you need a result that outlives the next call. */
export function contacts(): Contacts {
  return { up: false, down: false, left: false, right: false, impact: 0 };
}

/** Swept move-and-slide: advance `rect` by `vel`, sliding along `solids` —
 *  no tunneling at speed. Returns which sides touched (scratch object).
 *  Deliberately does NOT touch velocity or grounded: what a contact MEANS is
 *  game policy (see `moveAndSlide` for the default).
 *
 *  The default result is one module-wide scratch object, so resolving two
 *  bodies in a step makes the first result alias the second. Pass your own
 *  `out` (see `contacts()`) when you need to keep it:
 *
 *      const hit = Collision.contacts();        // once, per body
 *      Collision.slide(rect, vel, level, hit);  // every step */
export function slide(
  rect: Rect,
  vel: { x: number; y: number },
  solids: Solids,
  out: Contacts = slideContacts,
): Contacts {
  const c = out;
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
    const best = slideBest;
    let hasBest = false;
    for (const s of sols) {
      if (s.slope) continue; // diagonal top face is resolved by moveAndSlide
      if (s.oneWay) {
        if (dy <= 0) continue; // pass through unless falling…
        if (rect.y + rect.h > s.y + SKIN) continue; // …from fully above the top
      }
      if (!sweptAABBInto(rect, dx, dy, s, slideSweep)) continue;
      if (s.oneWay && slideSweep.ny !== -1) continue; // only the top face is solid
      if (!hasBest || slideSweep.t < best.t) {
        best.t = slideSweep.t;
        best.nx = slideSweep.nx;
        best.ny = slideSweep.ny;
        hasBest = true;
      }
    }
    if (!hasBest) {
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
 *  contacts (wall jumps read `left`/`right`; shake reads `impact`).
 *  Takes an `out` for the same reason `slide` does. */
export function moveAndSlide(
  body: MoverBody,
  solids: Solids,
  out: Contacts = slideContacts,
): Contacts {
  const startX = body.x;
  const startY = body.y;
  const dx = body.vel.x;
  const dy = body.vel.y;
  const wasGrounded = body.grounded;
  const c = slide(body, body.vel, solids, out);

  // Slopes are top-only diagonal floors. Catch a downward crossing, or keep a
  // previously grounded body glued to the surface while walking up/down it.
  if (dy >= 0) {
    slideArea.x = Math.min(startX, body.x) - 1;
    slideArea.y = Math.min(startY, body.y) - 1;
    slideArea.w = body.w + Math.abs(body.x - startX) + 2;
    slideArea.h = body.h + Math.abs(body.y - startY) + 2;
    const candidates = gather(solids, slideArea);
    const footX = body.x + body.w / 2;
    const previousBottom = startY + body.h;
    const currentBottom = body.y + body.h;
    let bestY = Infinity;
    for (const slope of candidates) {
      if (
        !slope.slope ||
        footX < slope.x ||
        footX > slope.x + slope.w ||
        body.x + body.w <= slope.x ||
        body.x >= slope.x + slope.w
      ) {
        continue;
      }
      const surface = slopeY(slope as Solid & { slope: SlopeDirection }, footX);
      const crossed = previousBottom <= surface + SKIN && currentBottom >= surface - SKIN;
      const followDistance =
        Math.abs(dx) * (slope.h / Math.max(slope.w, SKIN)) + Math.max(0, dy) + 1;
      const following = wasGrounded && Math.abs(currentBottom - surface) <= followDistance;
      if ((crossed || following) && surface < bestY) bestY = surface;
    }
    if (bestY < Infinity) {
      body.y = bestY - body.h - SKIN;
      c.down = true;
      c.impact = Math.max(c.impact, Math.abs(dy));
    }
  }

  if (c.left || c.right) body.vel.x = 0;
  if (c.up || c.down) body.vel.y = 0;
  body.grounded = c.down;
  return c;
}

/** Drop a grounded mover through the one-way platform directly beneath it.
 * Returns `false` without changing the body when it is not standing on a
 * one-way surface, so solid floors can never be dropped through accidentally.
 *
 * Call on the down+jump edge, before `moveAndSlide`:
 *
 *     if (input.down.down && input.jump.pressed)
 *       Collision.dropThrough(player, level);
 *
 * The tiny downward nudge puts the body below the platform's top-face test;
 * subsequent `moveAndSlide` calls then pass through normally. */
export function dropThrough(body: MoverBody, solids: Solids): boolean {
  const bottom = body.y + body.h;
  slideArea.x = body.x;
  slideArea.y = bottom - 1;
  slideArea.w = body.w;
  slideArea.h = 2;
  const candidates = gather(solids, slideArea);
  for (const solid of candidates) {
    if (
      solid.oneWay &&
      body.x < solid.x + solid.w &&
      body.x + body.w > solid.x &&
      Math.abs(bottom - solid.y) <= 1
    ) {
      body.y += 1;
      body.vel.y = Math.max(body.vel.y, 1);
      body.grounded = false;
      return true;
    }
  }
  return false;
}
