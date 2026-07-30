import type { App } from "../engine/index.js";
import { pointInRect } from "../collision.js";
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
}

export interface PerfOptions {
  /** Corner to draw in. Default `"top-right"`. */
  anchor?: "top-left" | "top-right";
  /** Metric arrangement. `"horizontal"` is a compact horizontal bar.
   * Default `"vertical"`. */
  layout?: "vertical" | "horizontal";
  /** A `NetMeter` to display network throughput alongside the frame stats. */
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
  const frameSpark = wantGraphs ? createSparkline() : undefined;
  const upSpark = wantGraphs && opts.net ? createSparkline() : undefined;
  const downSpark = wantGraphs && opts.net ? createSparkline() : undefined;
  const graphs = wantGraphs ? { frame: frameSpark, up: upSpark, down: downSpark } : undefined;
  let dimmed = false;
  let box: { x: number; y: number; w: number; h: number } | null = null;
  return {
    frame(app) {
      const now = performance.now();
      const stats = tick(now);
      const net = opts.net ? opts.net.sample(now) : undefined;
      frameSpark?.push(stats.frameMs);
      if (net) {
        upSpark?.push(net.upBps);
        downSpark?.push(net.downBps);
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
        net,
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
