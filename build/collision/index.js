// ---------- Collision helpers ----------
// Pure, allocation-free overlap tests. No engine state — just geometry.
/** Axis-aligned rectangle overlap (touching edges do NOT count as overlap). */
export function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
/** Circle/circle overlap test (centers + radii). Cheaper than it looks — no
 *  sqrt. Handy for coin pickups, blast radii, proximity checks. */
export function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy < r * r;
}
/** Is the point inside the rect? Edges count as inside — the natural choice
 *  for pointer hit-testing (a click on a button's border should register). */
export function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
/** Did a downward-moving edge cross a horizontal threshold this step? True when
 *  `prev` was at/above `threshold` and `next` is at/below it. One-way (guard
 *  with velocity if you only want descents) — the test for landing on a
 *  platform/floor, or a body sinking past a trigger line. */
export function crossedDown(prev, next, threshold) {
    return prev <= threshold && next >= threshold;
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
export function sweptAABB(a, dx, dy, b) {
    const out = { t: 0, nx: 0, ny: 0 };
    return sweptAABBInto(a, dx, dy, b, out) ? out : null;
}
/** Allocation-free core of `sweptAABB`: writes the result into `out` and
 *  returns whether the sweep hit — the hot slide loop reuses scratch Sweeps
 *  through this instead of allocating one per candidate solid. */
function sweptAABBInto(a, dx, dy, b, out) {
    // Entry/exit distances to `b`'s near/far faces along each axis.
    let xEntry, xExit, yEntry, yExit;
    if (dx === 0) {
        // No horizontal motion: only collide if already overlapping in x.
        if (a.x + a.w <= b.x || a.x >= b.x + b.w)
            return false;
        xEntry = -Infinity;
        xExit = Infinity;
    }
    else {
        const near = dx > 0 ? b.x - (a.x + a.w) : b.x + b.w - a.x;
        const far = dx > 0 ? b.x + b.w - a.x : b.x - (a.x + a.w);
        xEntry = near / dx;
        xExit = far / dx;
    }
    if (dy === 0) {
        if (a.y + a.h <= b.y || a.y >= b.y + b.h)
            return false;
        yEntry = -Infinity;
        yExit = Infinity;
    }
    else {
        const near = dy > 0 ? b.y - (a.y + a.h) : b.y + b.h - a.y;
        const far = dy > 0 ? b.y + b.h - a.y : b.y - (a.y + a.h);
        yEntry = near / dy;
        yExit = far / dy;
    }
    const entry = Math.max(xEntry, yEntry);
    const exit = Math.min(xExit, yExit);
    // Miss if the axes never overlap together, the hit is in the past, or beyond
    // this step's motion.
    if (entry > exit || entry > 1 || entry < 0)
        return false;
    // The later-entering axis is the one we actually hit.
    out.t = entry;
    if (xEntry > yEntry) {
        out.nx = dx < 0 ? 1 : -1;
        out.ny = 0;
    }
    else {
        out.nx = 0;
        out.ny = dy < 0 ? 1 : -1;
    }
    return true;
}
// Reused scratch contacts (one per function so neither clobbers the other) —
// valid until the next call: read, don't hold.
const circleRectContact = { nx: 0, ny: 0, depth: 0 };
const separateContact = { nx: 0, ny: 0, depth: 0 };
function fillContact(c, nx, ny, depth) {
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
export function circleRect(cx, cy, r, rect) {
    const nearX = cx < rect.x ? rect.x : cx > rect.x + rect.w ? rect.x + rect.w : cx;
    const nearY = cy < rect.y ? rect.y : cy > rect.y + rect.h ? rect.y + rect.h : cy;
    const dx = cx - nearX;
    const dy = cy - nearY;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r)
        return null;
    const c = circleRectContact;
    if (d2 === 0) {
        // Centre inside the rect: escape via the nearest edge.
        const left = cx - rect.x;
        const right = rect.x + rect.w - cx;
        const top = cy - rect.y;
        const bottom = rect.y + rect.h - cy;
        const m = Math.min(left, right, top, bottom);
        if (m === left)
            return fillContact(c, -1, 0, r + left);
        if (m === right)
            return fillContact(c, 1, 0, r + right);
        if (m === top)
            return fillContact(c, 0, -1, r + top);
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
export function separateCircles(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const d2 = dx * dx + dy * dy;
    const r = ar + br;
    if (d2 >= r * r)
        return null;
    if (d2 === 0)
        return fillContact(separateContact, 1, 0, r);
    const d = Math.sqrt(d2);
    return fillContact(separateContact, dx / d, dy / d, r - d);
}
// Reused scratch result for bounceInBounds — valid until the next call: read,
// don't hold (same contract as moveAndSlide's contacts).
const bounceFaces = {
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
export function bounceInBounds(rect, vel, bounds) {
    const faces = bounceFaces;
    faces.hit = faces.left = faces.right = faces.top = faces.bottom = false;
    if (rect.x < bounds.x) {
        rect.x = bounds.x;
        if (vel.x < 0)
            vel.x = -vel.x;
        faces.left = faces.hit = true;
    }
    else if (rect.x + rect.w > bounds.x + bounds.w) {
        rect.x = bounds.x + bounds.w - rect.w;
        if (vel.x > 0)
            vel.x = -vel.x;
        faces.right = faces.hit = true;
    }
    if (rect.y < bounds.y) {
        rect.y = bounds.y;
        if (vel.y < 0)
            vel.y = -vel.y;
        faces.top = faces.hit = true;
    }
    else if (rect.y + rect.h > bounds.y + bounds.h) {
        rect.y = bounds.y + bounds.h - rect.h;
        if (vel.y > 0)
            vel.y = -vel.y;
        faces.bottom = faces.hit = true;
    }
    return faces;
}
/** Surface y at world `x` on a slope, clamped to its horizontal extent. */
export function slopeY(slope, x) {
    const t = Math.max(0, Math.min(1, (x - slope.x) / slope.w));
    return slope.slope === "up-right" ? slope.y + slope.h * (1 - t) : slope.y + slope.h * t;
}
const ladderCandidates = [];
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
export function climbLadder(body, ladders, axis, opts = {}) {
    if (Math.abs(opts.horizontal ?? 0) > 0.1)
        return false;
    ladderCandidates.length = 0;
    const enteringDown = !opts.active && axis > 0.1;
    // A grounded body merely touches a ladder cap, so probe one pixel below
    // its feet when Down expresses intent to enter it.
    const area = {
        x: body.x,
        y: body.y,
        w: body.w,
        h: body.h + (enteringDown ? 1 : 0),
    };
    const candidates = Array.isArray(ladders) ? ladders : ladders.laddersNear(area, ladderCandidates);
    let ladder;
    for (const candidate of candidates) {
        const touchesTop = enteringDown &&
            body.x < candidate.x + candidate.w &&
            body.x + body.w > candidate.x &&
            Math.abs(body.y + body.h - candidate.y) <= 1;
        if (rectsOverlap(body, candidate) || touchesTop) {
            ladder = candidate;
            break;
        }
    }
    if (!ladder || (!opts.active && !opts.autoGrab && Math.abs(axis) < 0.1))
        return false;
    const targetX = ladder.x + (ladder.w - body.w) / 2;
    body.x += (targetX - body.x) * Math.max(0, Math.min(1, opts.snap ?? 0.35));
    body.vel.y = Math.max(-1, Math.min(1, axis)) * (opts.speed ?? 3);
    body.grounded = false;
    return true;
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
export function grid(solids, cellSize) {
    if (!(cellSize > 0))
        throw new Error("Collision.grid: cellSize must be > 0");
    const cells = new Map();
    let items = [];
    // Per-query stamps dedupe solids that straddle several cells without
    // allocating a Set per call.
    let stamps = new Uint32Array(0);
    let stamp = 0;
    const build = (next) => {
        cells.clear();
        items = next;
        if (stamps.length < items.length)
            stamps = new Uint32Array(items.length);
        else
            stamps.fill(0);
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
                    if (bucket)
                        bucket.push(i);
                    else
                        cells.set(key, [i]);
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
            if (items.length === 0)
                return out;
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
                    if (!bucket)
                        continue;
                    for (const i of bucket) {
                        if (stamps[i] === mark)
                            continue;
                        stamps[i] = mark;
                        out.push(items[i]);
                    }
                }
            }
            return out;
        },
    };
}
const SKIN = 0.0001; // nudge off surfaces so floats don't re-collide
const slideContacts = {
    up: false,
    down: false,
    left: false,
    right: false,
    impact: 0,
};
const slideArea = { x: 0, y: 0, w: 0, h: 0 };
const slideCandidates = [];
// Scratch Sweeps for the slide loop: one per-candidate probe, one best-so-far.
const slideSweep = { t: 0, nx: 0, ny: 0 };
const slideBest = { t: 0, nx: 0, ny: 0 };
function isSource(s) {
    return typeof s.solidsNear === "function";
}
// Whether an array holds any SolidSource, memoized per array. Levels are
// usually one long-lived array walked every step by every mover, so re-deriving
// this from scratch each call is pure overhead. Keyed by array identity and
// invalidated by length, which covers building up or tearing down a level.
// Swapping a source INTO an existing array in place, without changing its
// length, is the one mutation this won't notice — pass a new array for that.
const plainScan = new WeakMap();
function isPlain(solids) {
    const memo = plainScan.get(solids);
    if (memo && memo.len === solids.length)
        return memo.plain;
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
function gather(solids, area) {
    if (Array.isArray(solids)) {
        // Fast path: a plain Solid[] with no sources is read-only to the slide
        // loop, so use it as-is — no per-call element copy.
        if (isPlain(solids))
            return solids;
        slideCandidates.length = 0;
        for (const s of solids) {
            if (isSource(s))
                s.solidsNear(area, slideCandidates);
            else
                slideCandidates.push(s);
        }
        return slideCandidates;
    }
    slideCandidates.length = 0;
    return solids.solidsNear(area, slideCandidates);
}
function connectedSlopeAtSide(solids, solid, movingRight) {
    const edge = movingRight ? solid.x : solid.x + solid.w;
    for (const candidate of solids) {
        if (!candidate.slope)
            continue;
        const slopeEdge = movingRight ? candidate.x + candidate.w : candidate.x;
        if (Math.abs(slopeEdge - edge) <= SKIN &&
            Math.abs(slopeY(candidate, edge) - solid.y) <= SKIN) {
            return candidate;
        }
    }
}
/** A mover climbing a slope touches the adjoining plateau's vertical face
 * before its center reaches the endpoint. That face is walkable only while
 * the mover's feet are following the connected slope surface. */
function crossesWalkableSlopeSide(rect, dx, dy, solid, solids, sweep) {
    if (sweep.nx === 0 || dy < 0)
        return false;
    const slope = connectedSlopeAtSide(solids, solid, sweep.nx < 0);
    if (!slope)
        return false;
    const x = rect.x + dx * sweep.t;
    const footX = x + rect.w / 2;
    const bottom = rect.y + dy * sweep.t + rect.h;
    const surface = slopeY(slope, footX);
    const ratio = slope.h / Math.max(slope.w, SKIN);
    // On a narrow/steep slope the body's center is already meaningfully above
    // the endpoint when its leading edge first enters. Include that half-width
    // footprint so grounded bodies can transition onto slopes steeper than 1:1.
    const follow = (Math.abs(dx) + rect.w / 2) * ratio + Math.max(0, dy) + 1;
    return Math.abs(bottom - surface) <= follow + SKIN;
}
/** A fresh, zeroed `Contacts` — pass it as the `out` argument to `slide` /
 *  `moveAndSlide` when you need a result that outlives the next call. */
export function contacts() {
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
export function slide(rect, vel, solids, out = slideContacts) {
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
            if (s.slope)
                continue; // diagonal top face is resolved by moveAndSlide
            if (s.oneWay) {
                if (dy <= 0)
                    continue; // pass through unless falling…
                if (rect.y + rect.h > s.y + SKIN)
                    continue; // …from fully above the top
            }
            if (!sweptAABBInto(rect, dx, dy, s, slideSweep))
                continue;
            if (s.oneWay && slideSweep.ny !== -1)
                continue; // only the top face is solid
            if (crossesWalkableSlopeSide(rect, dx, dy, s, sols, slideSweep))
                continue;
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
            if (best.nx < 0)
                c.right = true;
            else
                c.left = true;
            c.impact = Math.max(c.impact, Math.abs(dx));
            rect.x += best.nx * SKIN;
            dx = 0;
            dy *= rem;
        }
        else {
            if (best.ny < 0)
                c.down = true;
            else
                c.up = true;
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
 *  Takes an `out` for the same reason `slide` does.
 *
 *  NOT the right call for a top-down game: `grounded`, slopes and `oneWay` are
 *  all gravity-facing policy, and there is no floor to land on. Use `slide`
 *  directly there — it moves and resolves without interpreting a contact:
 *
 *      Collision.slide(player, player.vel, level, contacts); */
export function moveAndSlide(body, solids, out = slideContacts) {
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
            if (!slope.slope ||
                footX < slope.x ||
                footX > slope.x + slope.w ||
                body.x + body.w <= slope.x ||
                body.x >= slope.x + slope.w) {
                continue;
            }
            const surface = slopeY(slope, footX);
            const crossed = previousBottom <= surface + SKIN && currentBottom >= surface - SKIN;
            const ratio = slope.h / Math.max(slope.w, SKIN);
            const followDistance = (Math.abs(dx) + body.w / 2) * ratio + Math.max(0, dy) + 1;
            const following = wasGrounded && Math.abs(currentBottom - surface) <= followDistance;
            if ((crossed || following) && surface < bestY)
                bestY = surface;
        }
        if (bestY < Infinity) {
            body.y = bestY - body.h - SKIN;
            c.down = true;
            c.impact = Math.max(c.impact, Math.abs(dy));
        }
        // Once the feet cross the endpoint, transfer slope support to the
        // adjoining flat top. Until then the slope branch above remains in charge.
        if (wasGrounded && !c.down && dx !== 0) {
            const movingRight = dx > 0;
            const footX = body.x + body.w / 2;
            const currentBottom = body.y + body.h;
            for (const solid of candidates) {
                if (solid.slope || solid.oneWay)
                    continue;
                const edge = movingRight ? solid.x : solid.x + solid.w;
                if ((movingRight ? footX < edge : footX > edge) ||
                    !connectedSlopeAtSide(candidates, solid, movingRight)) {
                    continue;
                }
                const follow = Math.abs(dx) + Math.max(0, dy) + 1;
                if (body.x < solid.x + solid.w &&
                    body.x + body.w > solid.x &&
                    Math.abs(currentBottom - solid.y) <= follow) {
                    body.y = solid.y - body.h - SKIN;
                    c.down = true;
                    c.impact = Math.max(c.impact, Math.abs(dy));
                    break;
                }
            }
        }
    }
    if (c.left || c.right)
        body.vel.x = 0;
    if (c.up || c.down)
        body.vel.y = 0;
    body.grounded = c.down;
    return c;
}
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
export function dropThrough(body, solids) {
    const bottom = body.y + body.h;
    slideArea.x = body.x;
    slideArea.y = bottom - 1;
    slideArea.w = body.w;
    slideArea.h = 2;
    const candidates = gather(solids, slideArea);
    for (const solid of candidates) {
        if (solid.oneWay &&
            body.x < solid.x + solid.w &&
            body.x + body.w > solid.x &&
            Math.abs(bottom - solid.y) <= 1) {
            body.y += 1;
            body.vel.y = Math.max(body.vel.y, 1);
            body.grounded = false;
            return true;
        }
    }
    return false;
}
