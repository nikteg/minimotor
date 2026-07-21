import type { EnginePlugin } from "../engine.js";
import { pointInRect } from "../collision.js";
import { drawPerfHud } from "./hud.js";
import { NetMeter, createNetMeter } from "./net-meter.js";
import { createSparkline } from "./sparkline.js";
import { createPerfTracker } from "./tracker.js";

// ---------- Plugin ----------

/** Options for the Perf plugin. */
export interface PerfOptions {
  /** Corner to draw in. Default `"top-right"`. */
  anchor?: "top-left" | "top-right";
  /** A `NetMeter` to display network throughput alongside the frame stats. */
  net?: NetMeter;
  /** An ECS world (anything with a numeric `size`) to show its live entity
   *  count — e.g. `plugin({ world: Minimotor.World })`. */
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

/** Create a Perf HUD game plugin. Each call owns its own tracker state. Draws in
 *  the top-right corner by default; pass a `NetMeter` to also show throughput.
 *  Click the HUD to dim it out of the way (and click again to restore):
 *
 *    const net = Minimotor.Perf.createNetMeter();
 *    Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin({ net })] });
 *    Minimotor.Loop.run({ update, draw }); */
export function plugin(opts: PerfOptions = {}): EnginePlugin {
  const tick = createPerfTracker();
  const wantGraphs = opts.graphs ?? true;
  const frameSpark = wantGraphs ? createSparkline() : undefined;
  const upSpark = wantGraphs && opts.net ? createSparkline() : undefined;
  const downSpark = wantGraphs && opts.net ? createSparkline() : undefined;
  const graphs = wantGraphs ? { frame: frameSpark, up: upSpark, down: downSpark } : undefined;
  let dimmed = false;
  let box: { x: number; y: number; w: number; h: number } | null = null;
  return {
    name: "perf",
    afterDraw(game) {
      const now = performance.now();
      const stats = tick(now);
      const net = opts.net ? opts.net.sample(now) : undefined;
      frameSpark?.push(stats.frameMs);
      if (net) {
        upSpark?.push(net.upBps);
        downSpark?.push(net.downBps);
      }
      // Click the HUD (its rect from the previous frame) to toggle it dim.
      const p = game.pointer;
      if (box && p.frameReleased && pointInRect(p.x, p.y, box)) dimmed = !dimmed;
      const ctx = game.ctx;
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.12;
      box = drawPerfHud(ctx, stats, {
        viewW: game.viewport.w,
        anchor: opts.anchor ?? "top-right",
        net,
        timings: game.timings,
        entities: opts.world?.size,
        heapMB: usedHeapMB(),
        graphs,
      });
      ctx.restore();
    },
  };
}
