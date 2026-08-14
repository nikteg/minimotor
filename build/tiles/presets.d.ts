import type { LadderSource } from "../collision/index.js";
import type { Level, TileSpec } from "./types.js";
/** Climbable region — see `climbable()`. */
export declare const LADDER = "ladder";
/** Hurts on contact. */
export declare const HAZARD = "hazard";
/** Swimmable / buoyant volume. */
export declare const WATER = "water";
/** Low-friction ground. */
export declare const ICE = "ice";
/** Slow-going ground. */
export declare const MUD = "mud";
/** Non-colliding volume a game polls for scripted events. */
export declare const TRIGGER = "trigger";
/** Ordinary blocking terrain. */
export declare const ground: TileSpec;
/** A one-way platform: land on it from above, jump up through it. */
export declare const platform: TileSpec;
/** A climbable column. The exposed top of each run doubles as a one-way
 *  standing surface, so you can step off the top of it onto flat ground. */
export declare const ladder: TileSpec;
/** A climbable column with NO standing surface at the top — for shafts you are
 *  meant to climb straight past. */
export declare const ladderThrough: TileSpec;
/** Damaging, non-blocking (spikes on the floor, lava you fall into). */
export declare const hazard: TileSpec;
/** Solid ground you slide across. Pair with a lower friction in your mover. */
export declare const ice: TileSpec;
/** Solid ground that slows you down. */
export declare const mud: TileSpec;
/** A swimmable volume. */
export declare const water: TileSpec;
/** A pass-through volume your game polls with `level.tagAt`. */
export declare const trigger: TileSpec;
/** Build a spec for any tag of your own — the escape hatch that makes this file
 *  a convenience rather than a gate.
 *
 *      const web = Tiles.tagged("web");
 *      const conveyor = Tiles.tagged("conveyor-right", { solid: true });
 */
export declare function tagged(tag: string, extra?: TileSpec): TileSpec;
/** Present a tagged region as collision's `LadderSource`, so it can be handed
 *  straight to `Collision.climbLadder`. Allocation-free after the first call.
 *
 *      climbing = Collision.climbLadder(player, Tiles.climbable(level), axis);
 *
 *  `tag` defaults to `LADDER`; pass another to reuse the climb behaviour for
 *  vines, ropes or chain-link fences without inventing a second mechanism. */
export declare function climbable(level: Level, tag?: string): LadderSource;
