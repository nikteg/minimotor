import type { Room } from "./room.js";
/** Options for `socketRoom`. */
export interface SocketRoomOptions {
    /** Room name — appended as `?room=`; the server groups by it. */
    room?: string;
    /** Reject if the server hasn't welcomed us in this long (ms). Default 8000. */
    timeoutMs?: number;
    /** Reopen the socket when it drops. Default true. */
    reconnect?: boolean;
    /** Retry delay in ms, doubled after each failed attempt. Default 500. */
    retryMs?: number;
    /** Ceiling for the doubling retry delay. Default 8000. */
    maxRetryMs?: number;
    /** Resolve to a one-player local room if the initial connection fails. */
    fallback?: "local";
}
/** Join a room hosted by a dedicated server. Resolves on the server's welcome
 *  and gives back the same `Room` every Net primitive already speaks. */
export declare function socketRoom<Msg = unknown>(url: string, opts?: SocketRoomOptions): Promise<Room<Msg>>;
