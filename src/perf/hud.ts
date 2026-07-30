import type { FrameTimings } from "../engine/index.js";
import { NetStats } from "./net-meter.js";
import { Sparkline } from "./sparkline.js";
import { PerfStats } from "./tracker.js";

// ---------- HUD ----------

/** Where the HUD sits, plus optional network stats to include. */
export interface PerfHudOptions {
  /** Viewport width (logical px) — required to anchor to the right edge. */
  viewW?: number;
  /** Corner to draw in. Default `"top-right"`. */
  anchor?: "top-left" | "top-right";
  /** Metric arrangement. `"horizontal"` is a compact horizontal bar.
   * Default `"vertical"`. */
  layout?: "vertical" | "horizontal";
  /** If given, two extra lines show up/down message and byte rates. */
  net?: NetStats;
  /** If given, one extra line shows the engine's update/draw cost and how many
   *  fixed steps ran (`Loop.timings` — the `plugin()` passes it for you). */
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

function drawHorizontalPerfHud(
  ctx: CanvasRenderingContext2D,
  stats: PerfStats,
  opts: PerfHudOptions,
): { x: number; y: number; w: number; h: number } {
  const fpsColor = stats.fps >= 55 ? "#4ecdc4" : stats.fps >= 30 ? "#ffd43b" : "#ff6b6b";
  type Segment = { text: string; color: string; width: number };
  const primary: Segment[] = [
    { text: `FPS ${stats.fps}`, color: fpsColor, width: 52 },
    { text: `FRAME ${stats.frameMs} ms`, color: "#aaa", width: 82 },
    { text: `MIN ${stats.minMs} · MAX ${stats.maxMs} ms`, color: "#777", width: 120 },
  ];
  const secondary: Segment[] = [];
  if (opts.timings) {
    const { updateMs, drawMs, steps } = opts.timings;
    primary.push({
      text: `UPDATE ${updateMs.toFixed(1)} · DRAW ${drawMs.toFixed(1)} ms${
        steps > 1 ? ` ×${steps}` : ""
      }`,
      color: "#aaa",
      width: 166,
    });
  }
  if (opts.entities !== undefined || opts.heapMB !== undefined) {
    const parts: string[] = [];
    if (opts.entities !== undefined) parts.push(`ENTITIES ${opts.entities}`);
    if (opts.heapMB !== undefined) parts.push(`HEAP ${Math.round(opts.heapMB)} MB`);
    secondary.push({ text: parts.join(" · "), color: "#aaa", width: 174 });
  }
  if (opts.net) {
    secondary.push(
      {
        text: `SENT ${kbps(opts.net.upBps)} KB/s · ${rate(opts.net.upMsgs)} msg/s`,
        color: "#4ecdc4",
        width: 156,
      },
      {
        text: `RECEIVED ${kbps(opts.net.downBps)} KB/s · ${rate(opts.net.downMsgs)} msg/s`,
        color: "#ffd43b",
        width: 180,
      },
    );
  }
  const rows = secondary.length ? [primary, secondary] : [primary];

  const sparks = [
    opts.graphs?.frame && { spark: opts.graphs.frame, label: "frame ms", color: "#b197fc" },
    opts.net && opts.graphs?.up && { spark: opts.graphs.up, label: "sent KB/s", color: "#4ecdc4" },
    opts.net &&
      opts.graphs?.down && {
        spark: opts.graphs.down,
        label: "received KB/s",
        color: "#ffd43b",
      },
  ].filter(Boolean) as { spark: Sparkline; label: string; color: string }[];

  ctx.save();
  ctx.font = "10px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const textW = Math.max(
    ...rows.map((segments) => segments.reduce((sum, segment) => sum + segment.width, 0)),
  );
  const boxW = Math.ceil(Math.max(textW + 8, sparks.length ? 300 : 0));
  const textH = 10 + rows.length * 14;
  const boxH = textH + (sparks.length ? 30 : 0);
  const bgX =
    (opts.anchor ?? "top-right") === "top-right" && opts.viewW !== undefined
      ? opts.viewW - 4 - boxW
      : 4;
  const bgY = 4;

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(bgX, bgY, boxW, boxH);
  rows.forEach((segments, row) => {
    let x = bgX + 4;
    for (const segment of segments) {
      ctx.fillStyle = segment.color;
      ctx.fillText(segment.text, x, bgY + 7 + row * 14);
      x += segment.width;
    }
  });

  if (sparks.length) {
    const graphGap = 4;
    const graphW = (boxW - 8 - graphGap * (sparks.length - 1)) / sparks.length;
    sparks.forEach(({ spark, label, color }, index) => {
      const graphX = bgX + 4 + index * (graphW + graphGap);
      ctx.font = "9px monospace";
      ctx.fillStyle = color;
      ctx.fillText(label, graphX, bgY + textH - 1);
      spark.draw(ctx, graphX, bgY + textH + 9, graphW, 16, color);
    });
  }
  ctx.restore();
  return { x: bgX, y: bgY, w: boxW, h: boxH };
}

/** Draw a compact perf HUD. Defaults to the top-right corner (pass `viewW` so it
 *  can anchor there); call after your own draw code. Returns the box rect, so
 *  callers can hit-test it (the plugin's click-to-dim uses this). */
export function drawPerfHud(
  ctx: CanvasRenderingContext2D,
  stats: PerfStats,
  opts: PerfHudOptions = {},
): { x: number; y: number; w: number; h: number } {
  if (opts.layout === "horizontal") return drawHorizontalPerfHud(ctx, stats, opts);

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
  // fillText in the whole app).
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
  return { x: bgX, y: bgY, w: boxW, h: boxH };
}
