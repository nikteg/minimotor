import type { Room } from "./room.js";
export interface NetworkTimeOptions {
    intervalMs?: number;
    now?: () => number;
}
export interface NetworkTime {
    /** Host-synchronized monotonic time in ms. */
    readonly now: number;
    readonly offsetMs: number;
    readonly rttMs: number;
    readonly ready: boolean;
    stop(): void;
}
/** Synchronize a lightweight monotonic clock to the current room host using
 * periodic ping/pong samples. Host migration is picked up automatically. */
export declare function networkTime(room: Room<unknown>, options?: NetworkTimeOptions): NetworkTime;
