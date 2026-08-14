import { type PeerStates, type Room, type SyncOptions } from "./room.js";
import { type EntityStates, type SyncEntitiesOptions } from "./entities.js";
/** Lightweight game bodies use nested velocity; Physics2D bodies use flat
 * velocity. State sync accepts either shape. */
export type SyncBody = {
    x: number;
    y: number;
    vel: {
        x: number;
        y: number;
    };
} | {
    x: number;
    y: number;
    vx: number;
    vy: number;
};
type Metadata = "w" | "h" | "rot" | "spin" | "grounded" | "facing" | "color" | "active" | "state" | "area";
export interface BodySnapshot {
    x: number;
    y: number;
    vx: number;
    vy: number;
    w?: number;
    h?: number;
    rot?: number;
    spin?: number;
    grounded?: boolean;
    facing?: number;
    color?: string;
    active?: boolean;
    /** Discrete presentation/gameplay state, such as `"climb"` or `"death"`. */
    state?: string;
    /** Current level/area id. A change is a teleport boundary, not a motion
     * sample to interpolate across. */
    area?: string;
}
/** The shallow, JSON-safe body state sent by `syncBody`. Every numeric field
 * is interpolated by `Net.sync`; optional simulation metadata is preserved. */
export type BodyState<B extends SyncBody = SyncBody> = BodySnapshot & Pick<B, Extract<keyof B, Metadata>>;
/** Convert a lightweight or Physics2D body into interpolation-friendly state. */
export declare function bodyState<B extends SyncBody>(body: B): BodyState<B>;
/** Blend body snapshots, taking the shortest arc for Physics2D rotation. */
export declare function lerpBodyState<T extends BodySnapshot>(a: T, b: T, t: number): T;
/** Project body position/rotation from its two newest snapshots. Velocity units
 * do not matter: projection derives motion from the observed positions. */
export declare function extrapolateBodyState<T extends BodySnapshot>(a: T, b: T, t: number): T;
/** Apply a snapshot to a lightweight body or remote Physics2D proxy. */
export declare function applyBodyState<B extends SyncBody>(body: B, state: BodySnapshot): B;
export type SyncBodyOptions<B extends SyncBody> = Omit<SyncOptions<BodyState<B>>, "state">;
/** Replicate a lightweight or Physics2D body with one call. Defaults to 60 Hz
 * plus 50ms-bounded snapshot extrapolation for responsive motion; adaptive
 * jitter restores buffering when needed. Pass a getter when the body instance
 * can be replaced on respawn. */
export declare function syncBody<B extends SyncBody>(room: Room<unknown>, body: B | (() => B), options?: SyncBodyOptions<B>): PeerStates<BodyState<B>>;
export type SyncBodiesOptions<B extends SyncBody> = Omit<SyncEntitiesOptions<B, BodyState<B>>, "entities" | "state">;
/** Replicate a dynamic collection of lightweight or Physics2D bodies. */
export declare function syncBodies<B extends SyncBody>(room: Room<unknown>, bodies: () => Iterable<B>, options: SyncBodiesOptions<B>): EntityStates<BodyState<B>>;
export {};
