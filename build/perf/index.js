// ---------- Performance monitoring ----------
// FPS / frame-time monitoring. `createPerformanceMonitoring(app)` owns the HUD
// lifecycle; the standalone tracker/meter factories stay available for custom
// displays.
import { plugin } from "./plugin.js";
export { createNetMeter } from "./net-meter.js";
export { createPerfTracker } from "./tracker.js";
export { createSparkline } from "./sparkline.js";
export function createPerformanceMonitoring(app, options = {}) {
    const monitor = plugin(options);
    let visible = true;
    // The HUD paints on top of the finished frame, so it runs on `onFrame` —
    // which also fires on paused frames, keeping the readout live while paused.
    app.onFrame(() => {
        if (visible)
            monitor.frame(app);
    });
    return {
        get visible() {
            return visible;
        },
        set3dRenderer(renderer) {
            monitor.set3dRenderer(renderer);
        },
        show() {
            visible = true;
        },
        hide() {
            visible = false;
        },
        toggle() {
            visible = !visible;
            return visible;
        },
        setNetMeter(meter) {
            monitor.setNet(meter);
        },
    };
}
export * from "./hud.js";
export * from "./plugin.js";
