import type { App } from "@src/engine/index.js";
import { pointInRect } from "@src/collision/index.js";
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
  /** Swap the `NetMeter` the throughput readings come from, or pass null to
   *  drop back to frame stats only. See `PerfOptions.net`. */
  setNet(meter: NetMeter | null): void;
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
   *  rejoin makes a new meter. Omit this and call `setNet` when there is one;
   *  the sparklines are allocated either way, so switching does not lose the
   *  history or change the overlay's size. */
  net?: NetMeter;
  /** An ECS world (anything with a numeric `size`) whose live entity count
   *  should be shown. */
  world?: { readonly size: number };
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
 *  `NetMeter` to also show throughput. Click it to toggle its dim state:
 *
 *    const Performance = createPerformanceMonitoring(app, { net: room.meter });
 *    Performance.hide(); */
export function plugin(opts: PerfOptions = {}): PerfOverlay {
  const tick = createPerfTracker();
  const wantGraphs = opts.graphs ?? true;
  let net: NetMeter | null = opts.net ?? null;
  const frameSpark = wantGraphs ? createSparkline() : undefined;
  // Allocated up front rather than when a meter arrives: `setNet` must not
  // change the overlay's layout mid-session, and a sparkline nobody pushes to
  // costs one empty array.
  const upSpark = wantGraphs ? createSparkline() : undefined;
  const downSpark = wantGraphs ? createSparkline() : undefined;
  const graphs = wantGraphs ? { frame: frameSpark, up: upSpark, down: downSpark } : undefined;
  let dimmed = false;
  let box: { x: number; y: number; w: number; h: number } | null = null;
  return {
    setNet(meter) {
      net = meter;
    },
    frame(app) {
      const now = performance.now();
      const stats = tick(now);
      const rates = net ? net.sample(now) : undefined;
      frameSpark?.push(stats.frameMs);
      if (rates) {
        upSpark?.push(rates.upBps);
        downSpark?.push(rates.downBps);
      }
      // Click the HUD (its rect from the previous frame) to toggle it dim.
      const p = app.Pointer;
      if (box && p.frameReleased && pointInRect(p.x, p.y, box)) dimmed = !dimmed;
      const vp = app.viewport;
      const ctx = app.ctx;
      ctx.save();
      // Draw in WINDOW space (device px ÷ dpr), not the letterbox's logical
      // space — the perf overlay is a debug HUD, so it sits in the true window
      // top-right corner, unscaled and over the letterbox bars.
      ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
      if (dimmed) ctx.globalAlpha = 0.12;
      const winBox = drawPerfHud(ctx, stats, {
        viewW: app.canvas.width / vp.dpr, // window CSS width
        anchor: opts.anchor ?? "top-right",
        layout: opts.layout,
        net: rates,
        timings: app.timings,
        entities: opts.world?.size,
        heapMB: usedHeapMB(),
        graphs,
      });
      ctx.restore();
      // Map the window-space rect back to logical coords, where the pointer
      // lives, so next frame's click test matches (works over the bars too).
      box = winBox && {
        x: (winBox.x - vp.offsetX) / vp.scale,
        y: (winBox.y - vp.offsetY) / vp.scale,
        w: winBox.w / vp.scale,
        h: winBox.h / vp.scale,
      };
    },
  };
}
