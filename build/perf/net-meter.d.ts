/** Smoothed network rates, per second. */
export interface NetStats {
    /** Outbound messages per second. */
    upMsgs: number;
    /** Inbound messages per second. */
    downMsgs: number;
    /** Outbound bytes per second. */
    upBps: number;
    /** Inbound bytes per second. */
    downBps: number;
}
/** Counts network traffic and reports smoothed per-second rates. Feed it from
 *  your transport code — `meter.sent(bytes)` / `meter.recv(bytes)` — and pass it
 *  to `createPerformanceMonitoring(app, { net })` (or read `sample()` yourself). */
export interface NetMeter {
    /** Record one outbound message of `bytes` (default 0 if size is unknown). */
    sent(bytes?: number): void;
    /** Record one inbound message of `bytes`. */
    recv(bytes?: number): void;
    /** Compute smoothed rates given a monotonic timestamp. Call once per frame. */
    sample(nowMs: number): NetStats;
}
/** Create a network throughput meter. Rates are exponentially smoothed so the
 *  HUD reads steadily rather than flickering frame-to-frame. */
export declare function createNetMeter(): NetMeter;
