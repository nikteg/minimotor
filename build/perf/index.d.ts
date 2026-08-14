import type { App } from "../engine/app.js";
import type { NetMeter } from "./net-meter.js";
import { type Perf3DSource, type PerfOptions } from "./plugin.js";
export { createNetMeter } from "./net-meter.js";
export { createPerfTracker } from "./tracker.js";
export { createSparkline } from "./sparkline.js";
export type { NetMeter, NetStats } from "./net-meter.js";
export type { PerfStats, PerfTracker } from "./tracker.js";
export type { Sparkline } from "./sparkline.js";
export type { Perf3DFrameStats, Perf3DSource, Perf3DStats, PerfOptions } from "./plugin.js";
export interface PerformanceMonitoringApi {
    readonly visible: boolean;
    /** Attach or replace the active 3D renderer used by the HUD. */
    set3dRenderer(renderer: Perf3DSource | null): void;
    show(): void;
    hide(): void;
    toggle(): boolean;
    /** Point the throughput readings at a `NetMeter`, or null for none. The
     *  monitor is installed once at startup but a room is opened later and
     *  replaced on every rejoin, so the meter is a thing you SET, not a thing you
     *  construct the monitor around. */
    setNetMeter(meter: NetMeter | null): void;
}
export declare function createPerformanceMonitoring(app: App, options?: PerfOptions): PerformanceMonitoringApi;
export * from "./hud.js";
export * from "./plugin.js";
