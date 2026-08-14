/** Add local ownership to state without mutating it. */
export function own(room, state) {
    return { ...state, owner: room.id };
}
/** Whether this member owns an id or `{ owner }` state. */
export function owns(room, value) {
    return (typeof value === "string" ? value : value.owner) === room.id;
}
/** Return copied state with ownership transferred to another member. */
export function transfer(state, owner) {
    return { ...state, owner };
}
/** Whether this member has the requested authority (the host by default). */
export function hasAuthority(room, owner = room.hostId) {
    return owner === room.id;
}
/** Stable member slot while membership is unchanged; useful for spawn points,
 * team colors, and local-player labels without another protocol message. */
export function memberIndex(room) {
    return [room.id, ...room.peers].sort().indexOf(room.id);
}
