import { type RoomNotice } from "../frame.js";
import type { ConnectionRequest, ServerSocket } from "./room.js";
/** A socket that can carry binary frames — `ws`'s WebSocket satisfies it. */
export interface BinarySocket extends ServerSocket {
    send(data: string | Uint8Array): void;
}
/** A server of binary-capable sockets — `ws`'s WebSocketServer fits. */
export interface BinarySocketServer {
    on(event: "connection", handler: (socket: BinarySocket, request?: ConnectionRequest) => void): void;
}
/** One connected member. */
export interface RoomMember {
    readonly id: string;
    /** The `?room=` it asked for; members only ever see their own group. */
    readonly group: string;
    readonly socket: BinarySocket;
}
/** Hooks for a server that wants to observe or police the traffic. */
export interface RoomsOptions {
    /** A member joined, after it is in the roster. */
    onJoin?(member: RoomMember): void;
    /** A member left, after it is out of the roster. */
    onLeave?(member: RoomMember): void;
    /** Inspect a frame before it is forwarded. Return false to drop it — the
     *  hook for anti-cheat or rate limiting. `tag` is empty for JSON app
     *  messages; `payload` is undecoded bytes. */
    onFrame?(member: RoomMember, tag: string, payload: Uint8Array): boolean | void;
}
/** A live view of the rooms a server is hosting. */
export interface Rooms {
    /** Members of one group. */
    members(group: string): RoomMember[];
    /** The member currently owning shared state for a group. */
    host(group: string): string | null;
    /** Send a control notice to one member. */
    notify(member: RoomMember, notice: RoomNotice): void;
}
/** Host a set of rooms on a WebSocket server. Clients connect with
 *  `Net.socketRoom(url, { room })`. */
export declare function rooms(server: BinarySocketServer, options?: RoomsOptions): Rooms;
