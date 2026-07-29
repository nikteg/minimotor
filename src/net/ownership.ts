import type { Room } from "./room.js";

export interface Owned {
  owner: string;
}

/** Add local ownership to state without mutating it. */
export function own<T extends object>(room: Room<unknown>, state: T): T & Owned {
  return { ...state, owner: room.id };
}

/** Whether this member owns an id or `{ owner }` state. */
export function owns(room: Room<unknown>, value: string | Owned): boolean {
  return (typeof value === "string" ? value : value.owner) === room.id;
}

/** Return copied state with ownership transferred to another member. */
export function transfer<T extends Owned>(state: T, owner: string): T {
  return { ...state, owner };
}

/** Whether this member has the requested authority (the host by default). */
export function hasAuthority(room: Room<unknown>, owner = room.hostId): boolean {
  return owner === room.id;
}

/** Stable member slot while membership is unchanged; useful for spawn points,
 * team colors, and local-player labels without another protocol message. */
export function memberIndex(room: Room<unknown>): number {
  return [room.id, ...room.peers].sort().indexOf(room.id);
}
