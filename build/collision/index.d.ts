import type { Rect } from "../engine/index.js";
/** Axis-aligned rectangle overlap (touching edges do NOT count as overlap). */
export declare function rectsOverlap(a: Rect, b: Rect): boolean;
/** Circle/circle overlap test (centers + radii). Cheaper than it looks — no
 *  sqrt. Handy for coin pickups, blast radii, proximity checks. */
export declare function circleHit(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean;
/** Is the point inside the rect? Edges count as inside — the natural choice
 *  for pointer hit-testing (a click on a button's border should register). */
export declare function pointInRect(px: number, py: number, r: Rect): boolean;
/** Did a downward-moving edge cross a horizontal threshold this step? True when
 *  `prev` was at/above `threshold` and `next` is at/below it. One-way (guard
 *  with velocity if you only want descents) — the test for landing on a
 *  platform/floor, or a body sinking past a trigger line. */
export declare function crossedDown(prev: number, next: number, threshold: number): boolean;
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
export declare function sweptAABB(a: Rect, dx: number, dy: number, b: Rect): Sweep | null;
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
 *  is inside the rect it pushes out the nearest edge. The result is a reused
 *  scratch object, valid until the next call: read, don't hold. */
export declare function circleRect(cx: number, cy: number, r: number, rect: Rect): Contact | null;
/** Minimum-translation contact between two overlapping circles (normal points
 *  from `b` toward `a`), or `null` if apart. Coincident centres push along +x.
 *  For separating jostling bodies — enemies, physics balls, crowd agents. The
 *  result is a reused scratch object, valid until the next call: read, don't
 *  hold. */
export declare function separateCircles(ax: number, ay: number, ar: number, bx: number, by: number, br: number): Contact | null;
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
 *  against an edge won't jitter or stick — the classic double-bounce bug.
 *  The returned faces are a reused scratch object, valid until the next call:
 *  read, don't hold. */
export declare function bounceInBounds(rect: Rect, vel: {
    x: number;
    y: number;
}, bounds: Rect): BounceFaces;
/** Direction a slope rises toward. `"up-right"` has its low end on the left;
 * `"up-left"` has its low end on the right. */
export type SlopeDirection = "up-left" | "up-right";
/** A static obstacle. `oneWay` platforms collide only when landed on from
 * above. A `slope` is a walkable diagonal surface across the rect. */
export type Solid = Rect & {
    oneWay?: boolean;
    slope?: SlopeDirection;
};
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
export declare function slopeY(slope: Solid & {
    slope: SlopeDirection;
}, x: number): number;
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
/** Apply terse platformer ladder movement. Pressing a vertical `axis` while
 * overlapping a ladder enters it; pressing down while standing on its top
 * enters from above; `autoGrab` can enter on contact instead. Pass the returned
 * boolean back as `active` next step to remain attached while the axis is
 * neutral.
 *
 *     climbing = Collision.climbLadder(player, level, input.axis("up", "down"), {
 *       active: climbing,
 *     });
 *
 * While active this centers the body, sets `vel.y`, and clears `grounded`.
 * Gravity and jump-to-detach remain game policy. */
export declare function climbLadder(body: MoverBody, ladders: Ladders, axis: number, opts?: ClimbLadderOptions): boolean;
/** A `SolidSource` that buckets loose solids into a uniform grid. */
export interface SolidGrid extends SolidSource {
    /** Re-bucket for a changed set of solids. The grid holds the `Solid` objects
     *  themselves, so moving one by mutating its `x`/`y` needs a rebuild — this
     *  is a broadphase for *static* geometry. */
    rebuild(solids: Solid[]): void;
    /** How many solids are currently indexed. */
    readonly size: number;
}
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
export declare function grid(solids: Solid[], cellSize: number): SolidGrid;
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
    vel: {
        x: number;
        y: number;
    };
    /** Resting on a floor — set by `moveAndSlide` to its `down` contact. */
    grounded: boolean;
}
/** A fresh, zeroed `Contacts` — pass it as the `out` argument to `slide` /
 *  `moveAndSlide` when you need a result that outlives the next call. */
export declare function contacts(): Contacts;
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
export declare function slide(rect: Rect, vel: {
    x: number;
    y: number;
}, solids: Solids, out?: Contacts): Contacts;
/** The default platformer path: swept-slides `body` by `body.vel`, zeroes
 *  the blocked velocity components (land/bonk clears `vel.y`, walls clear
 *  `vel.x`), sets `body.grounded`, honors `oneWay`. Still returns the
 *  contacts (wall jumps read `left`/`right`; shake reads `impact`).
 *  Takes an `out` for the same reason `slide` does.
 *
 *  NOT the right call for a top-down game: `grounded`, slopes and `oneWay` are
 *  all gravity-facing policy, and there is no floor to land on. Use `slide`
 *  directly there — it moves and resolves without interpreting a contact:
 *
 *      Collision.slide(player, player.vel, level, contacts); */
export declare function moveAndSlide(body: MoverBody, solids: Solids, out?: Contacts): Contacts;
/** Drop a grounded mover through the one-way platform directly beneath it.
 * Returns `false` without changing the body when it is not standing on a
 * one-way surface, so solid floors can never be dropped through accidentally.
 *
 * Call while the player's drop action is held, before `moveAndSlide`:
 *
 *     if (input.down.down)
 *       Collision.dropThrough(player, level);
 *
 * The tiny downward nudge puts the body below the platform's top-face test;
 * subsequent `moveAndSlide` calls then pass through normally. */
export declare function dropThrough(body: MoverBody, solids: Solids): boolean;
