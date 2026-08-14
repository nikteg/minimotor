import type { Room } from "./room.js";
export interface Owned {
    owner: string;
}
/** Add local ownership to state without mutating it. */
export declare function own<T extends object>(room: Room<unknown>, state: T): T & Owned;
/** Whether this member owns an id or `{ owner }` state. */
export declare function owns(room: Room<unknown>, value: string | Owned): boolean;
/** Return copied state with ownership transferred to another member. */
export declare function transfer<T extends Owned>(state: T, owner: string): T;
/** Whether this member has the requested authority (the host by default). */
export declare function hasAuthority(room: Room<unknown>, owner?: string | null): boolean;
/** Stable member slot while membership is unchanged; useful for spawn points,
 * team colors, and local-player labels without another protocol message. */
export declare function memberIndex(room: Room<unknown>): number;
