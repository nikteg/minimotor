// ---------- Performance monitoring ----------
// FPS / frame-time monitoring. `createPerformanceMonitoring(app)` owns the HUD
// lifecycle; the standalone tracker/meter factories stay available for custom
// displays.

import type { App } from "../engine/app.js";
import { plugin, type PerfOptions } from "../perf/plugin.js";

export { createNetMeter } from "../perf/net-meter.js";
export { createPerfTracker } from "../perf/tracker.js";
export { createSparkline } from "../perf/sparkline.js";
export type { NetMeter, NetStats } from "../perf/net-meter.js";
export type { PerfStats, PerfTracker } from "../perf/tracker.js";
export type { Sparkline } from "../perf/sparkline.js";
export type { PerfOptions } from "../perf/plugin.js";

export interface PerformanceMonitoringApi {
  readonly visible: boolean;
  show(): void;
  hide(): void;
  toggle(): boolean;
}

export function createPerformanceMonitoring(
  app: App,
  options: PerfOptions = {},
): PerformanceMonitoringApi {
  const monitor = plugin(options);
  let visible = true;
  app.use({
    name: "PerformanceMonitoring",
    onInit: monitor.onInit,
    beforeUpdate: monitor.beforeUpdate,
    afterUpdate: monitor.afterUpdate,
    beforeDraw: monitor.beforeDraw,
    afterDraw(app) {
      if (visible) monitor.afterDraw?.(app);
    },
    onResize: monitor.onResize,
    onDestroy: monitor.onDestroy,
  });
  return {
    get visible() {
      return visible;
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
  };
}
