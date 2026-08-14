// ---------- Tile presets: the batteries ----------
// The tiles CORE (`grid`, `Level`, `TileSpec`) deliberately knows no game
// concepts. It knows collision geometry — because `Collision.Solid` has those
// exact fields — plus two open-ended mechanisms: string TAGS naming regions,
// and `standOnTop` for "the top of this run is standable".
//
// Everything a game actually says out loud lives HERE, and every entry below is
// ordinary data written in terms of that core. Nothing in this file is
// privileged: `ladder` is six words of object literal, and your own
// `{ tags: ["web"] }` is exactly as much of a first-class citizen.
//
// That split is what keeps the engine from silently growing a genre. The core
// cannot learn a new noun by accident — there is nowhere in it to put one — and
// `tiles.core.test.ts` fails the build if one appears anyway. Meanwhile the
// batteries can grow without limit, because adding one costs nothing but a line
// of data.
//
//     import { Tiles } from "minimotor";
//
//     const level = Tiles.grid(map, {
//       size: 16,
//       legend: {
//         "#": Tiles.ground,
//         "=": Tiles.platform,
//         H: Tiles.ladder,
//         "~": Tiles.hazard,
//       },
//     });
//
//     Collision.moveAndSlide(player, level);                      // solids
//     climbing = Collision.climbLadder(player, Tiles.climbable(level), axis);
//     if (level.tagAt(player.x, player.y, Tiles.HAZARD)) hurt();
// ---------- tag names ----------
// Exported as constants so a typo is a build error rather than a region that
// silently never matches.
/** Climbable region — see `climbable()`. */
export const LADDER = "ladder";
/** Hurts on contact. */
export const HAZARD = "hazard";
/** Swimmable / buoyant volume. */
export const WATER = "water";
/** Low-friction ground. */
export const ICE = "ice";
/** Slow-going ground. */
export const MUD = "mud";
/** Non-colliding volume a game polls for scripted events. */
export const TRIGGER = "trigger";
// ---------- ready-made specs ----------
/** Ordinary blocking terrain. */
export const ground = { solid: true };
/** A one-way platform: land on it from above, jump up through it. */
export const platform = { solid: true, oneWay: true };
/** A climbable column. The exposed top of each run doubles as a one-way
 *  standing surface, so you can step off the top of it onto flat ground. */
export const ladder = { tags: [LADDER], standOnTop: true };
/** A climbable column with NO standing surface at the top — for shafts you are
 *  meant to climb straight past. */
export const ladderThrough = { tags: [LADDER] };
/** Damaging, non-blocking (spikes on the floor, lava you fall into). */
export const hazard = { tags: [HAZARD] };
/** Solid ground you slide across. Pair with a lower friction in your mover. */
export const ice = { solid: true, tags: [ICE] };
/** Solid ground that slows you down. */
export const mud = { solid: true, tags: [MUD] };
/** A swimmable volume. */
export const water = { tags: [WATER] };
/** A pass-through volume your game polls with `level.tagAt`. */
export const trigger = { tags: [TRIGGER] };
/** Build a spec for any tag of your own — the escape hatch that makes this file
 *  a convenience rather than a gate.
 *
 *      const web = Tiles.tagged("web");
 *      const conveyor = Tiles.tagged("conveyor-right", { solid: true });
 */
export function tagged(tag, extra = {}) {
    return { ...extra, tags: [...(extra.tags ?? []), tag] };
}
// ---------- adapters onto collision ----------
/** One cached view per (level, tag) pair. Keyed on the level so a view is
 *  allocated once and stays valid across frames; `rectsNear` does its own
 *  invalidation underneath, so nothing here goes stale after `set()`. */
const views = new WeakMap();
/** Present a tagged region as collision's `LadderSource`, so it can be handed
 *  straight to `Collision.climbLadder`. Allocation-free after the first call.
 *
 *      climbing = Collision.climbLadder(player, Tiles.climbable(level), axis);
 *
 *  `tag` defaults to `LADDER`; pass another to reuse the climb behaviour for
 *  vines, ropes or chain-link fences without inventing a second mechanism. */
export function climbable(level, tag = LADDER) {
    let byTag = views.get(level);
    if (!byTag)
        views.set(level, (byTag = new Map()));
    let view = byTag.get(tag);
    if (!view) {
        byTag.set(tag, (view = {
            laddersNear: (area, out) => level.rectsNear(tag, area, out),
        }));
    }
    return view;
}
