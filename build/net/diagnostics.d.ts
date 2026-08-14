import type { Room } from "./room.js";
import { type NetMeter } from "../perf/net-meter.js";
export interface RoomStats {
    sentMessages: number;
    receivedMessages: number;
    sentBytes: number;
    receivedBytes: number;
    lastReceivedAt: number;
}
export type MonitoredRoom<M> = Room<M> & {
    readonly stats: Readonly<RoomStats>;
    /** Pass directly to `createPerformanceMonitoring(app, { net: room.meter })`. */
    readonly meter: NetMeter;
};
/** Wrap a room with cumulative message/byte diagnostics. Pass the returned
 * room to other Net utilities so all of their traffic is counted. */
export declare function monitorRoom<M>(room: Room<M>, now?: () => number): MonitoredRoom<M>;
export interface NetworkSimulationOptions {
    latencyMs?: number;
    jitterMs?: number;
    loss?: number;
    random?: () => number;
}
/** Wrap a Room with artificial latency, jitter, and packet loss. Intended for
 * development; production code should pass the original room. */
export declare function simulateNetwork<M>(room: Room<M>, options?: NetworkSimulationOptions): Room<M>;
