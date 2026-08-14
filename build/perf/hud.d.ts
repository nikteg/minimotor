import type { FrameTimings } from "../engine/index.js";
import { NetStats } from "./net-meter.js";
import type { Perf3DStats } from "./plugin.js";
import { Sparkline } from "./sparkline.js";
import { PerfStats } from "./tracker.js";
/** Where the HUD sits, plus optional network stats to include. */
export interface PerfHudOptions {
    /** Viewport width (logical px) — required to anchor to the right edge. */
    viewW?: number;
    /** Corner to draw in. Default `"top-right"`. */
    anchor?: "top-left" | "top-right";
    /** Metric arrangement. `"horizontal"` is a compact horizontal bar.
     * Default `"vertical"`. */
    layout?: "vertical" | "horizontal";
    /** If given, two extra lines show up/down message and byte rates. */
    net?: NetStats;
    /** If given, one extra line shows the engine's update/draw cost and how many
     *  fixed steps ran (`Loop.timings` — the `plugin()` passes it for you). */
    timings?: FrameTimings;
    /** Live entity count to display (pass `world.size`). */
    entities?: number;
    /** Aggregate 3D work for the current frame. */
    render3d?: Perf3DStats;
    /** Used JS heap in MB (Chrome-only `performance.memory`; the `plugin()`
     *  reads it for you where available). */
    heapMB?: number;
    /** History graphs drawn as labeled strips under the text: frame time, 3D CPU
     *  and GPU time, and (with `net`) sent/received traffic. Push samples
     *  yourself each frame; the `plugin()` does this for you. */
    graphs?: {
        frame?: Sparkline;
        render3d?: Sparkline;
        render3dGpu?: Sparkline;
        up?: Sparkline;
        down?: Sparkline;
    };
}
/** Draw a compact perf HUD. Defaults to the top-right corner (pass `viewW` so it
 *  can anchor there); call after your own draw code. Returns the drawn box rect. */
export declare function drawPerfHud(ctx: CanvasRenderingContext2D, stats: PerfStats, opts?: PerfHudOptions): {
    x: number;
    y: number;
    w: number;
    h: number;
};
