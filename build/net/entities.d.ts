import type { SyncCodec } from "./body-codec.js";
import type { Room } from "./room.js";
export interface SyncEntitiesOptions<E, S extends object> {
    entities: () => Iterable<E>;
    id: (entity: E) => string;
    state: (entity: E) => S;
    hz?: number;
    delayMs?: number | "auto";
    timeoutMs?: number;
    lerp?: (a: S, b: S, t: number) => S;
    extrapolate?: (a: S, b: S, t: number) => S;
    maxExtrapolationMs?: number;
    now?: () => number;
    /** Pack the batch into a binary lane instead of JSON — see `SyncOptions`. */
    codec?: SyncCodec<Array<{
        id: string;
        state: S;
    }>>;
}
export type RemoteEntity<S extends object> = S & {
    id: string;
    owner: string;
};
export interface EntityStates<S extends object> extends Iterable<RemoteEntity<S>> {
    readonly size: number;
    readonly ids: Array<{
        owner: string;
        id: string;
    }>;
    stop(): void;
}
/** Synchronize a dynamic collection. Each peer owns its advertised entities;
 * missing ids despawn automatically and states interpolate independently. */
export declare function syncEntities<E, S extends object>(room: Room<unknown>, options: SyncEntitiesOptions<E, S>): EntityStates<S>;
export interface BindEntitiesOptions<S extends object, T> {
    create(state: RemoteEntity<S>): T;
    apply(target: T, state: RemoteEntity<S>): void;
    destroy?(target: T): void;
}
export interface EntityBinding<T> {
    readonly entities: ReadonlyMap<string, T>;
    update(): void;
    stop(): void;
}
/** Bind synchronized states to live render objects or kinematic physics
 * proxies. Call `update` from the game loop, or use app-bound `Net.bindEntities`
 * to have it scheduled automatically. */
export declare function bindEntities<S extends object, T>(states: EntityStates<S>, options: BindEntitiesOptions<S, T>): EntityBinding<T>;
