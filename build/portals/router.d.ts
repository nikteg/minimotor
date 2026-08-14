import type { App, Rect } from "../engine/index.js";
import type { SceneStack } from "../scenes/index.js";
import { type Transition } from "../transitions/index.js";
import type { Vec2 } from "../math/vec2.js";
export interface PortalDestination<A extends string> {
    /** Destination area/level id. */
    area: A;
    /** Spawn marker queried from the destination level. */
    spawn: string;
    /** How the resolved point anchors a rectangular body. Default `"center"`. */
    anchor?: "center" | "feet";
}
export type PortalTransition = "none" | "fade" | "wipe-left" | "wipe-right" | "wipe-up" | "wipe-down";
export interface Portal<A extends string> extends Rect {
    id?: string;
    to: PortalDestination<A>;
    /** Overrides the router's default covering transition. */
    transition?: Transition | PortalTransition;
    transitionMs?: number;
}
export interface PortalBody<A extends string> {
    x: number;
    y: number;
    area: A;
    w?: number;
    h?: number;
    vel?: {
        x: number;
        y: number;
    };
    vx?: number;
    vy?: number;
    grounded?: boolean;
}
export interface PortalArea<A extends string, S extends string> {
    /** Scene shown for this area. Multiple areas may share one scene. */
    scene: S;
    /** Anything with `spawnOne`, including `Tiles.Level`. */
    level: {
        spawnOne(marker: string): Vec2;
    };
    portals: readonly Portal<A>[];
    resolve?(destination: PortalDestination<A>): Vec2;
}
/** Structural world source. `LDtk.world` implements this directly. */
export interface PortalWorld<A extends string> {
    level(area: A): {
        spawnOne(marker: string): Vec2;
    };
    portals(area: A): readonly Portal<A>[];
    resolve?(destination: PortalDestination<A>): Vec2;
}
export interface PortalTravel<A extends string> {
    from: A;
    to: A;
    spawn: string;
    portal?: Portal<A>;
}
export interface PortalOptions<A extends string, S extends string, B extends PortalBody<A>> {
    body: B | (() => B);
    scenes: Pick<SceneStack<S>, "go" | "active">;
    /** Explicit areas, or pass a `world` such as `LDtk.world`. */
    areas?: Record<A, PortalArea<A, S>>;
    world?: PortalWorld<A>;
    /** Scene used by world-backed areas. A constant supports one shared gameplay
     * scene; a resolver supports one scene per area. Defaults to the area id. */
    scene?: S | ((area: A) => S);
    /** Detect portals automatically after each fixed gameplay step. Default
     * true. Set false for manual/isolated simulation and call `update()`. */
    auto?: boolean;
    /** Default scene-cover transition. */
    transition?: Transition;
    /** Body bounds for trigger overlap. The default uses top-left `x/y/w/h`;
     * bodies without `w/h` are treated as center points. */
    bounds?(body: B): Rect;
    /** Place a body at a resolved destination. */
    place?(body: B, spawn: Vec2, destination: PortalDestination<A>): void;
    /** Runs after area/position changes and before the destination scene enters.
     * Snap the camera or swap area-owned systems here. */
    onTravel?(travel: PortalTravel<A>): void;
    /** Runs when travel begins, before a covering transition starts. */
    beforeTravel?(travel: PortalTravel<A>): void;
    /** Runs after the destination has been fully revealed. */
    afterTravel?(travel: PortalTravel<A>): void;
    /** Runtime owner injected by the Portals feature. */
    app?: Pick<App, "onStep" | "onDestroy">;
}
export interface PortalRouter<A extends string> {
    readonly area: A;
    /** Detect and enter an overlapping portal. Returns true on travel. */
    update(): boolean;
    /** Travel directly (save games, scripted doors, server commands). */
    travel(destination: PortalDestination<A>): void;
    /** True when another replicated object occupies our current area. */
    sameArea(other: {
        area?: string;
    }): boolean;
    /** Stop automatic detection. Direct `travel()` remains available. */
    dispose(): void;
}
/** Create an area router. Detection runs automatically after fixed gameplay
 * updates. `LDtk.world` supplies authored `mm:portal` destinations and
 * transitions directly. A portal disarms until the body leaves every
 * destination trigger, preventing paired doors from bouncing straight back. */
export declare function createPortalRouter<A extends string, S extends string, B extends PortalBody<A>>(options: PortalOptions<A, S, B>): PortalRouter<A>;
