import type { Room } from "./room.js";
export interface HostStateOptions<T> {
    state: () => T;
    hz?: number;
}
export interface HostState<T> {
    /** Host state locally, or the latest host snapshot for a guest. */
    readonly value: T;
    stop(): void;
}
/** Synchronize shared world state from the current room host. The relay does
 * not know the state schema; a promoted host continues from its local copy. */
export declare function hostState<T>(room: Room<unknown>, options: HostStateOptions<T>): HostState<T>;
