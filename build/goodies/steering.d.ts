import type { GridPoint } from "./grid.js";
/** Move an angle toward a target by at most `maxDelta`, taking the shortest
 * route across the -π/π seam. Result is normalized to [-π, π). */
export declare function approachAngle(current: number, target: number, maxDelta: number): number;
/** A firing solution: the intercept point and when the shot lands. */
export interface LeadTarget {
    /** Aim-point x — where the target will be at `time`. */
    x: number;
    /** Aim-point y. */
    y: number;
    /** Time until impact, in the same time units as the velocities/speed passed
     *  in. Always `> 0`. */
    time: number;
}
/** Predict where to aim a constant-speed projectile at a constant-velocity
 * target. Returns `null` when no future intercept exists. */
export declare function leadTarget(shooterX: number, shooterY: number, targetX: number, targetY: number, targetVx: number, targetVy: number, projectileSpeed: number): LeadTarget | null;
/** Even points around a circle for bullet rings, radial spawns and arena props. */
export declare function ringFormation(count: number, cx: number, cy: number, radius: number, phase?: number): Array<GridPoint & {
    angle: number;
}>;
/** Centered row-major formation for squads, invaders, cards and puzzle pieces. */
export declare function gridFormation(count: number, columns: number, spacingX: number, spacingY: number, cx?: number, cy?: number): GridPoint[];
/** The closest item to (x, y) within `maxDist` (default: unbounded), or `null`.
 *  `getPos` reads a `{x, y}` off each item. The everyday targeting / pickup /
 *  interactable-select scan, in one place (and it compares squared distance —
 *  no per-item sqrt). */
export declare function nearest<T>(x: number, y: number, items: Iterable<T>, getPos: (item: T) => {
    x: number;
    y: number;
}, maxDist?: number): T | null;
