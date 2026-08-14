import { drawPerfHud } from "./hud.js";
import { createSparkline } from "./sparkline.js";
import { createPerfTracker } from "./tracker.js";
// Chrome-only heap gauge; everywhere else this stays undefined and the HUD
// simply omits the number.
function usedHeapMB() {
    const mem = performance.memory;
    const used = mem?.usedJSHeapSize;
    return typeof used === "number" ? used / (1024 * 1024) : undefined;
}
/** Internal engine adapter used by `createPerformanceMonitoring`. Each call owns
 *  its tracker state. The HUD draws in the top-right corner by default; pass a
 *  `NetMeter` to also show throughput:
 *
 *    const Performance = createPerformanceMonitoring(app, { net: room.meter });
 *    Performance.hide(); */
export function plugin(opts = {}) {
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
    let meter = opts.net ?? null;
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
            if (render3dStats)
                render3dSpark?.push(render3dStats.cpuMs);
            if (render3dStats?.gpuMs !== undefined)
                render3dGpuSpark?.push(render3dStats.gpuMs);
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
