// ---------- Performance monitoring HUD ----------
// Lightweight FPS / frame-time tracker with optional on-canvas overlay, plus an
// optional network throughput meter. Tracks rolling min/max/avg over a window.

import type { EnginePlugin, FrameTimings } from "./engine.js";
import { lerp } from "./mathf.js";

export interface PerfStats {
  fps: number;
  frameMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

const WINDOW = 60; // frames of history

/** A per-frame perf sampler with its own private rolling history.
 *  Each tracker is independent — no shared module state. */
export interface PerfTracker {
  /** Call once per frame with a monotonic timestamp. Returns current stats. */
  (nowMs: number): PerfStats;
}

/** Create an isolated FPS/frame-time tracker. Ring buffer + running sum: a
 *  perf tool shouldn't do O(n) shifts and allocations per frame itself. */
export function createPerfTracker(window = WINDOW): PerfTracker {
  const times = new Float64Array(window);
  let head = 0; // next slot to overwrite
  let count = 0;
  let sum = 0;
  let lastTime = 0;
  let current: PerfStats = { fps: 60, frameMs: 16.7, minMs: 16.7, maxMs: 16.7, avgMs: 16.7 };

  return function tick(nowMs: number): PerfStats {
    if (lastTime === 0) {
      lastTime = nowMs;
      return current;
    }
    const dt = nowMs - lastTime;
    lastTime = nowMs;

    if (count === window) sum -= times[head];
    else count++;
    times[head] = dt;
    head = (head + 1) % window;
    sum += dt;

    // Min/max over ≤`window` entries — a plain loop, no spread/allocs. (A
    // monotonic deque would be O(1), but at 60 entries the loop is simpler.)
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i++) {
      const t = times[i];
      if (t < min) min = t;
      if (t > max) max = t;
    }

    const avg = sum / count;
    current = {
      fps: Math.round(1000 / avg),
      frameMs: Math.round(dt * 10) / 10,
      minMs: Math.round(min * 10) / 10,
      maxMs: Math.round(max * 10) / 10,
      avgMs: Math.round(avg * 10) / 10,
    };
    return current;
  };
}

// ---------- Network throughput meter ----------

/** Smoothed network rates, per second. */
export interface NetStats {
  /** Outbound messages per second. */
  upMsgs: number;
  /** Inbound messages per second. */
  downMsgs: number;
  /** Outbound bytes per second. */
  upBps: number;
  /** Inbound bytes per second. */
  downBps: number;
}

/** Counts network traffic and reports smoothed per-second rates. Feed it from
 *  your transport code — `meter.sent(bytes)` / `meter.recv(bytes)` — and pass it
 *  to `Perf.plugin({ net })` (or read `sample()` yourself). */
export interface NetMeter {
  /** Record one outbound message of `bytes` (default 0 if size is unknown). */
  sent(bytes?: number): void;
  /** Record one inbound message of `bytes`. */
  recv(bytes?: number): void;
  /** Compute smoothed rates given a monotonic timestamp. Call once per frame. */
  sample(nowMs: number): NetStats;
}

/** Create a network throughput meter. Rates are exponentially smoothed so the
 *  HUD reads steadily rather than flickering frame-to-frame. */
export function createNetMeter(): NetMeter {
  let mUp = 0;
  let bUp = 0;
  let mDown = 0;
  let bDown = 0;
  // Snapshot at the previous sample, to diff against.
  let lastT = 0;
  let lmUp = 0;
  let lbUp = 0;
  let lmDown = 0;
  let lbDown = 0;
  let stats: NetStats = { upMsgs: 0, downMsgs: 0, upBps: 0, downBps: 0 };

  return {
    sent(bytes = 0) {
      mUp++;
      bUp += bytes;
    },
    recv(bytes = 0) {
      mDown++;
      bDown += bytes;
    },
    sample(nowMs) {
      if (lastT === 0) {
        lastT = nowMs;
        return stats;
      }
      const dt = nowMs - lastT;
      if (dt <= 0) return stats;
      const perSec = (d: number) => (d / dt) * 1000;
      const k = 0.2; // smoothing toward the latest instantaneous rate
      // Exponential smoothing never reaches zero on its own — snap the tail so
      // idle links read (and graph) as exactly 0 instead of a noise floor.
      const smooth = (prev: number, next: number, eps: number) => {
        const v = lerp(prev, next, k);
        return v < eps ? 0 : v;
      };
      stats = {
        upMsgs: smooth(stats.upMsgs, perSec(mUp - lmUp), 0.01),
        downMsgs: smooth(stats.downMsgs, perSec(mDown - lmDown), 0.01),
        upBps: smooth(stats.upBps, perSec(bUp - lbUp), 1),
        downBps: smooth(stats.downBps, perSec(bDown - lbDown), 1),
      };
      lastT = nowMs;
      lmUp = mUp;
      lbUp = bUp;
      lmDown = mDown;
      lbDown = bDown;
      return stats;
    },
  };
}

// ---------- Sparkline ----------

/** A tiny fixed-capacity history graph: `push` a sample per frame, `draw`
 *  renders right-aligned bars scaled to the window's max. Ring buffer —
 *  no allocations after creation. */
export interface Sparkline {
  push(v: number): void;
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void;
}

export function createSparkline(capacity = WINDOW): Sparkline {
  const vals = new Float64Array(capacity);
  let head = 0; // next slot to overwrite
  let count = 0;
  return {
    push(v) {
      vals[head] = v;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
    },
    draw(ctx, x, y, w, h, color) {
      if (count === 0) return;
      let max = 0;
      for (let i = 0; i < count; i++) if (vals[i] > max) max = vals[i];
      if (max <= 0) max = 1;
      const bw = w / capacity;
      ctx.fillStyle = color;
      // Oldest sample first, newest ending flush with the right edge.
      for (let i = 0; i < count; i++) {
        const v = vals[(head - count + i + 2 * capacity) % capacity];
        const bh = Math.max(1, (v / max) * h);
        ctx.fillRect(x + (capacity - count + i) * bw, y + h - bh, Math.max(1, bw - 1), bh);
      }
    },
  };
}

// ---------- HUD ----------

/** Where the HUD sits, plus optional network stats to include. */
export interface PerfHudOptions {
  /** Viewport width (logical px) — required to anchor to the right edge. */
  viewW?: number;
  /** Corner to draw in. Default `"top-right"`. */
  anchor?: "top-left" | "top-right";
  /** If given, two extra lines show up/down message and byte rates. */
  net?: NetStats;
  /** If given, one extra line shows the engine's update/draw cost and how many
   *  fixed steps ran (`Game.timings` — the `plugin()` passes it for you). */
  timings?: FrameTimings;
  /** Live entity count to display (pass `world.size`). */
  entities?: number;
  /** Used JS heap in MB (Chrome-only `performance.memory`; the `plugin()`
   *  reads it for you where available). */
  heapMB?: number;
  /** History graphs drawn as labeled strips under the text: frame time, and
   *  (with `net`) sent/received traffic. Push samples yourself each frame; the
   *  `plugin()` does this for you. */
  graphs?: { frame?: Sparkline; up?: Sparkline; down?: Sparkline };
}

const rate = (perSec: number) => Math.round(perSec);
const kbps = (bps: number) => (bps / 1024).toFixed(1);

/** Draw a compact perf HUD. Defaults to the top-right corner (pass `viewW` so it
 *  can anchor there); call after your own draw code. */
export function drawPerfHud(
  ctx: CanvasRenderingContext2D,
  stats: PerfStats,
  opts: PerfHudOptions = {},
): void {
  const net = opts.net;
  const timings = opts.timings;
  const anchor = opts.anchor ?? "top-right";
  const lineH = 14;
  const boxW = net ? 176 : 148;
  const memLine = opts.entities !== undefined || opts.heapMB !== undefined;
  const rows = 4 + (timings ? 1 : 0) + (memLine ? 1 : 0) + (net ? 2 : 0);
  const frameSpark = opts.graphs?.frame;
  const upSpark = net && opts.graphs?.up;
  const downSpark = net && opts.graphs?.down;
  // Each graph is a labeled strip: 10px caption + 16px bars + 4px gap.
  const graphH = 16;
  const stripH = 10 + graphH + 4;
  let boxH = lineH * rows + 8;
  if (frameSpark) boxH += stripH;
  if (upSpark) boxH += stripH;
  if (downSpark) boxH += stripH;

  // Anchor to the right edge when we know the width; otherwise fall back to left.
  const bgX = anchor === "top-right" && opts.viewW !== undefined ? opts.viewW - 4 - boxW : 4;
  const bgY = 4;
  const x = bgX + 4;
  const y = 8;

  // The HUD changes font/baseline/align/fillStyle; restore so no state leaks
  // into the next frame's user draw (a leaked textBaseline shifts every
  // fillText in the whole game).
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(bgX, bgY, boxW, boxH);

  ctx.font = "11px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const color = stats.fps >= 55 ? "#4ecdc4" : stats.fps >= 30 ? "#ffd43b" : "#ff6b6b";
  ctx.fillStyle = color;
  ctx.fillText(`FPS  ${stats.fps}`, x, y);
  ctx.fillStyle = "#aaa";
  ctx.fillText(`frame  ${stats.frameMs} ms`, x, y + lineH);
  ctx.fillText(`min   ${stats.minMs} ms`, x, y + lineH * 2);
  ctx.fillText(`max   ${stats.maxMs} ms`, x, y + lineH * 3);
  let row = 4;

  if (timings) {
    // What the frame time was spent on: your update steps vs your draw. `×N`
    // marks catch-up frames that ran more than one fixed step.
    const upd = timings.updateMs.toFixed(1);
    const drw = timings.drawMs.toFixed(1);
    const xn = timings.steps > 1 ? `  ×${timings.steps}` : "";
    ctx.fillText(`upd ${upd}  drw ${drw} ms${xn}`, x, y + lineH * row++);
  }

  if (memLine) {
    const parts: string[] = [];
    if (opts.entities !== undefined) parts.push(`ents ${opts.entities}`);
    if (opts.heapMB !== undefined) parts.push(`heap ${Math.round(opts.heapMB)} MB`);
    ctx.fillText(parts.join("  "), x, y + lineH * row++);
  }

  if (net) {
    ctx.fillStyle = "#4ecdc4";
    ctx.fillText(`↑ ${rate(net.upMsgs)}/s  ${kbps(net.upBps)} KB/s`, x, y + lineH * row++);
    ctx.fillStyle = "#ffd43b";
    ctx.fillText(`↓ ${rate(net.downMsgs)}/s  ${kbps(net.downBps)} KB/s`, x, y + lineH * row++);
  }

  // Labeled history strips, one metric per graph — each in its own color so
  // they can't be confused at a glance.
  let graphY = bgY + lineH * rows + 8;
  const graphW = boxW - 8;
  const strip = (spark: Sparkline, label: string, barColor: string) => {
    ctx.font = "9px monospace";
    ctx.fillStyle = barColor;
    ctx.fillText(label, x, graphY);
    spark.draw(ctx, x, graphY + 10, graphW, graphH, barColor);
    graphY += stripH;
  };
  if (frameSpark) strip(frameSpark, "frame ms", "#b197fc");
  if (upSpark) strip(upSpark, "↑ sent KB/s", "#4ecdc4");
  if (downSpark) strip(downSpark, "↓ received KB/s", "#ffd43b");
  ctx.restore();
}

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
 *  the top-right corner by default; pass a `NetMeter` to also show throughput:
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
      drawPerfHud(game.ctx, stats, {
        viewW: game.viewport.w,
        anchor: opts.anchor ?? "top-right",
        net,
        timings: game.timings,
        entities: opts.world?.size,
        heapMB: usedHeapMB(),
        graphs,
      });
    },
  };
}
