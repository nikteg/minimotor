// ---------- Performance monitoring HUD ----------
// Lightweight FPS / frame-time tracker with optional on-canvas overlay.
// Tracks rolling min/max/avg over a configurable window.

import type { EngineShape } from "./engine.js";

export interface PerfStats {
  fps: number;
  frameMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

const WINDOW = 60; // frames of history
const times: number[] = [];

let lastTime = 0;
let current: PerfStats = { fps: 60, frameMs: 16.7, minMs: 16.7, maxMs: 16.7, avgMs: 16.7 };

/** Call once per frame (e.g. before draw). Returns current stats. */
export function tickPerf(nowMs: number): PerfStats {
  if (lastTime === 0) {
    lastTime = nowMs;
    return current;
  }
  const dt = nowMs - lastTime;
  lastTime = nowMs;
  times.push(dt);
  if (times.length > WINDOW) times.shift();

  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  current = {
    fps: Math.round(1000 / avg),
    frameMs: Math.round(dt * 10) / 10,
    minMs: Math.round(Math.min(...times) * 10) / 10,
    maxMs: Math.round(Math.max(...times) * 10) / 10,
    avgMs: Math.round(avg * 10) / 10,
  };
  return current;
}

/** Draw a compact HUD overlay in the top-left corner.
 *  Pass the 2D context. Call after your own draw code. */
export function drawPerfHud(ctx: CanvasRenderingContext2D, stats: PerfStats): void {
  const x = 8;
  const y = 8;
  const lineH = 14;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - 4, y - 4, 130, lineH * 4 + 8);

  ctx.font = "11px monospace";
  ctx.textBaseline = "top";

  const color = stats.fps >= 55 ? "#4ecdc4" : stats.fps >= 30 ? "#ffd43b" : "#ff6b6b";

  ctx.fillStyle = color;
  ctx.fillText(`FPS  ${stats.fps}`, x, y);
  ctx.fillStyle = "#aaa";
  ctx.fillText(`frame  ${stats.frameMs} ms`, x, y + lineH);
  ctx.fillText(`min   ${stats.minMs} ms`, x, y + lineH * 2);
  ctx.fillText(`max   ${stats.maxMs} ms`, x, y + lineH * 3);
}

// ---------- HOC ----------

export type StartFn = (update: () => void, draw: () => void) => void;

/** Higher-order wrapper around Engine.start — returns a start function
 *  that automatically ticks the perf tracker each frame and draws the
 *  HUD overlay on top of your own draw code.
 *
 *    const start = Minimotor.Perf.withHud(Minimotor.Engine);
 *    start(update, draw);
 *
 *  or inline:
 *
 *    Minimotor.Perf.withHud(Minimotor.Engine)(update, draw); */
export function withHud(engine: Pick<EngineShape, "start" | "ctx">): StartFn {
  return (update, draw) => {
    let stats: PerfStats = current;
    engine.start(update, () => {
      stats = tickPerf(performance.now());
      draw();
      if (engine.ctx) drawPerfHud(engine.ctx, stats);
    });
  };
}
