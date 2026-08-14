import type { App } from "../engine/index.js";
import type { NetMeter } from "./net-meter.js";
/** Options for the performance monitor. */
/** A per-frame overlay: given the app, draw on top of the finished frame.
 *  Subscribed with `app.onFrame` by the feature that owns it. */
export interface PerfOverlay {
    frame(app: App): void;
    set3dRenderer(renderer: Perf3DSource | null): void;
    /** Swap the `NetMeter` the throughput readings come from, or null to drop
     *  back to frame stats only. Exists for the same reason `set3dRenderer` does:
     *  the thing being measured is not there yet when the overlay is installed,
     *  and is replaced during the session. See `PerfOptions.net`. */
    setNet(meter: NetMeter | null): void;
}
/** Per-frame aggregate supplied by a 3D renderer. */
export interface Perf3DFrameStats {
    readonly viewports: number;
    readonly drawCalls: number;
    readonly triangles: number;
    readonly culled: number;
    /** CPU time spent encoding/submitting 3D work, in milliseconds. */
    readonly cpuMs: number;
    /** GPU execution time when timestamp queries are supported. */
    readonly gpuMs?: number;
}
/** 3D counters displayed by the performance monitor. */
export interface Perf3DStats extends Perf3DFrameStats {
    readonly backend: string;
}
/** A renderer-owned source for aggregate 3D counters. */
export interface Perf3DSource {
    readonly backend: string;
    consumeFrameStats(): Perf3DFrameStats;
}
export interface PerfOptions {
    /** Corner to draw in. Default `"top-right"`. */
    anchor?: "top-left" | "top-right";
    /** Metric arrangement. `"horizontal"` is a compact horizontal bar.
     * Default `"vertical"`. */
    layout?: "vertical" | "horizontal";
    /** A `NetMeter` to display network throughput alongside the frame stats.
     *
     *  A meter that does not exist yet is the normal case, not an edge one — a
     *  game's room is opened long after its overlay is installed, and every
     *  rejoin makes a new one. Omit this and call `setNet` when there is a meter;
     *  the sparklines are allocated either way, so switching cannot lose the
     *  history or resize the overlay mid-session. */
    net?: NetMeter;
    /** An ECS world (anything with a numeric `size`) whose live entity count
     *  should be shown. */
    world?: {
        readonly size: number;
    };
    /** The initial 3D renderer, if one already exists. Use `set3dRenderer` when
     *  the renderer is created asynchronously or replaced. */
    render3d?: Perf3DSource;
    /** Draw history sparklines (frame time; up/down traffic with `net`).
     *  Default true. */
    graphs?: boolean;
}
/** Internal engine adapter used by `createPerformanceMonitoring`. Each call owns
 *  its tracker state. The HUD draws in the top-right corner by default; pass a
 *  `NetMeter` to also show throughput:
 *
 *    const Performance = createPerformanceMonitoring(app, { net: room.meter });
 *    Performance.hide(); */
export declare function plugin(opts?: PerfOptions): PerfOverlay;
