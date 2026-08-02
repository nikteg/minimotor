import type { App } from "@src/engine/index.js";
import { drawPerfHud } from "./hud.js";
import type { NetMeter } from "./net-meter.js";
import { createSparkline } from "./sparkline.js";
import { createPerfTracker } from "./tracker.js";

// ---------- Plugin ----------

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
  world?: { readonly size: number };
  /** The initial 3D renderer, if one already exists. Use `set3dRenderer` when
   *  the renderer is created asynchronously or replaced. */
  render3d?: Perf3DSource;
  /** Draw history sparklines (frame time; up/down traffic with `net`).
   *  Default true. */
  graphs?: boolean;
}

// Chrome-only heap gauge; everywhere else this stays undefined and the HUD
// simply omits the number.
function usedHeapMB(): number | undefined {
  const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  const used = mem?.usedJSHeapSize;
  return typeof used === "number" ? used / (1024 * 1024) : undefined;
}

/** Internal engine adapter used by `createPerformanceMonitoring`. Each call owns
 *  its tracker state. The HUD draws in the top-right corner by default; pass a
 *  `NetMeter` to also show throughput:
 *
 *    const Performance = createPerformanceMonitoring(app, { net: room.meter });
 *    Performance.hide(); */
export function plugin(opts: PerfOptions = {}): PerfOverlay {
  const tick = createPerfTracker();
  const wantGraphs = opts.graphs ?? true;
  const frameSpark = wantGraphs ? createSparkline() : undefined;
  const render3dSpark = wantGraphs ? createSparkline() : undefined;
  const render3dGpuSpark = wantGraphs ? createSparkline() : undefined;
  const upSpark = wantGraphs ? createSparkline() : undefined;
  const downSpark = wantGraphs ? createSparkline() : undefined;
  const graphs = wantGraphs
    ? {
        frame: frameSpark,
        render3d: render3dSpark,
        render3dGpu: render3dGpuSpark,
        up: upSpark,
        down: downSpark,
      }
    : undefined;
  let render3d = opts.render3d ?? null;
  let meter: NetMeter | null = opts.net ?? null;
  return {
    set3dRenderer(renderer) {
      render3d = renderer;
    },
    setNet(next) {
      meter = next;
    },
    frame(app) {
      const now = performance.now();
      const stats = tick(now);
      const net = meter ? meter.sample(now) : undefined;
      const render3dStats = render3d
        ? { ...render3d.consumeFrameStats(), backend: render3d.backend }
        : undefined;
      frameSpark?.push(stats.frameMs);
      if (net) {
        upSpark?.push(net.upBps);
        downSpark?.push(net.downBps);
      }
      if (render3dStats) render3dSpark?.push(render3dStats.cpuMs);
      if (render3dStats?.gpuMs !== undefined) render3dGpuSpark?.push(render3dStats.gpuMs);
      const vp = app.viewport;
      const ctx = app.ctx;
      ctx.save();
      // Draw in WINDOW space (device px ÷ dpr), not the letterbox's logical
      // space — the perf overlay is a debug HUD, so it sits in the true window
      // top-right corner, unscaled and over the letterbox bars.
      ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
      drawPerfHud(ctx, stats, {
        viewW: app.canvas.width / vp.dpr, // window CSS width
        anchor: opts.anchor ?? "top-right",
        layout: opts.layout,
        net,
        timings: app.timings,
        entities: opts.world?.size,
        heapMB: usedHeapMB(),
        render3d: render3dStats,
        graphs,
      });
      ctx.restore();
    },
  };
}
