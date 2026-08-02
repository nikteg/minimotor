// ---------- Performance monitoring ----------
// FPS / frame-time monitoring. `createPerformanceMonitoring(app)` owns the HUD
// lifecycle; the standalone tracker/meter factories stay available for custom
// displays.

import type { App } from "@src/engine/app.js";
import { plugin, type Perf3DSource, type PerfOptions } from "./plugin.js";

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
}

export function createPerformanceMonitoring(
  app: App,
  options: PerfOptions = {},
): PerformanceMonitoringApi {
  const monitor = plugin(options);
  let visible = true;
  // The HUD paints on top of the finished frame, so it runs on `onFrame` —
  // which also fires on paused frames, keeping the readout live while paused.
  app.onFrame(() => {
    if (visible) monitor.frame(app);
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
  };
}

export * from "./hud.js";
export * from "./plugin.js";
