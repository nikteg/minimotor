// ---------- Nine-slice reporting ----------
//
// The analysis produces integers; this turns them into something an agent can
// act on without seeing the screen. Three registers, cheapest first:
//
//  1. Findings — one line each, with the corrected number inline. This is the
//     output that actually gets acted on.
//  2. Slice strips — one character per source column/row, with `|` at the inset
//     boundaries. `AAA|BCBCBC|AAA` says everything about a frame's structure in
//     one line, and a phase break is visible as a broken alternation.
//  3. Images — a zoomed source crop with inset guides, and the frame composed
//     at awkward sizes. Written only on request, for the cases where looking is
//     genuinely faster than reading.

import type { AxisReport, Finding, Insets, Rect, RegionReport } from "./analyze.js";
import { compose } from "./analyze.js";
import type { Pixels } from "./png.js";

const STRIP_WIDTH = 96;

/** Collapse the middle of a long strip on a period boundary, so the surviving
 *  characters still show the true phase either side of the ellipsis. */
function elide(strip: string, lead: number, trail: number, period: number): string {
  const center = strip.slice(lead, strip.length - trail);
  if (strip.length <= STRIP_WIDTH)
    return `${strip.slice(0, lead)}|${center}|${strip.slice(strip.length - trail)}`;
  const budget = Math.max(period * 2, Math.floor((STRIP_WIDTH - lead - trail) / 2));
  const head = center.slice(0, budget);
  const tail = center.slice(Math.max(budget, center.length - budget));
  return `${strip.slice(0, lead)}|${head}…${tail}|${strip.slice(strip.length - trail)}`;
}

/** The verdict for one axis. Three outcomes, not two: a band can repeat cleanly,
 *  repeat out of phase (the slit), or not repeat at all — in which case it is
 *  tiled whole and only the wrap seam decides whether that looks right. */
function verdict(report: AxisReport): string {
  if (report.center <= 0) return "BAD (no centre band)";
  if (!report.periodic) {
    return `whole (unique ${report.center}px band, tiled entire; seam ${report.seam.toFixed(1)}×)`;
  }
  const repeats = report.center / report.period;
  return repeats % 1 === 0
    ? `ok (${repeats} whole repeats)`
    : `BAD (${report.center} / ${report.period} = ${repeats.toFixed(2)} repeats)`;
}

function formatAxis(report: AxisReport, size: number): string {
  const names = report.axis === "x" ? ["left", "right"] : ["top", "bottom"];
  const head =
    `  ${report.axis}  span=${size} ${names[0]}=${report.lead} ${names[1]}=${report.trail} ` +
    `centre=${report.center} period=${report.periodic ? report.period : "none"} ${verdict(report)}`;
  const strip = `      ${elide(report.keys, report.lead, report.trail, Math.max(1, report.period))}`;
  return `${head}\n${strip}`;
}

const LEVEL_ORDER: Record<Finding["level"], number> = { error: 0, warning: 1, info: 2 };

/** Sort findings by severity, keeping declaration order inside a level. */
export const rank = (findings: readonly Finding[]): Finding[] =>
  [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

/** One region as text: geometry, both axes, then its findings. */
export function formatRegion(report: RegionReport): string {
  const { rect, insets } = report;
  const lines = [
    `${report.name}  rect ${rect.sx},${rect.sy} ${rect.sw}×${rect.sh}  ` +
      `insets L${insets.left} T${insets.top} R${insets.right} B${insets.bottom}  ` +
      `min-size ${insets.left + insets.right}×${insets.top + insets.bottom}`,
    formatAxis(report.x, rect.sw),
    formatAxis(report.y, rect.sh),
  ];
  for (const finding of rank(report.findings)) {
    lines.push(`  ${finding.level}: [${finding.code}] ${finding.message}`);
    if (finding.fix) lines.push(`    fix: ${finding.fix}`);
  }
  return lines.join("\n");
}

const SHADES = " .:-=+*#%@";

/** A one-character-per-pixel map of the region, banded by the insets. Only
 *  worth printing for small frames; big ones say nothing a strip does not. */
export function pixelMap(image: Pixels, rect: Rect, insets: Insets): string | undefined {
  if (rect.sw > 100 || rect.sh > 48) return undefined;
  const rows: string[] = [];
  const bar = (fill: string) =>
    fill.repeat(insets.left) +
    "+" +
    fill.repeat(Math.max(0, rect.sw - insets.left - insets.right)) +
    "+" +
    fill.repeat(insets.right);
  for (let y = 0; y < rect.sh; y++) {
    if (y === insets.top || y === rect.sh - insets.bottom) rows.push(bar("-"));
    let row = "";
    for (let x = 0; x < rect.sw; x++) {
      if (x === insets.left || x === rect.sw - insets.right) row += "|";
      const at = ((rect.sy + y) * image.width + rect.sx + x) * 4;
      const alpha = image.data[at + 3];
      if (alpha === 0) row += " ";
      else {
        const luma =
          (image.data[at] * 0.299 + image.data[at + 1] * 0.587 + image.data[at + 2] * 0.114) / 255;
        row +=
          SHADES[Math.max(1, Math.min(SHADES.length - 1, Math.round(luma * (SHADES.length - 1))))];
      }
    }
    rows.push(row);
  }
  return rows.join("\n");
}

const GUIDE: [number, number, number, number] = [255, 0, 255, 255];
const CHECKER: [number, number, number, number][] = [
  [40, 40, 48, 255],
  [56, 56, 64, 255],
];

function put(target: Pixels, x: number, y: number, rgba: readonly number[]): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const at = (y * target.width + x) * 4;
  const alpha = rgba[3] / 255;
  target.data[at] = Math.round(target.data[at] * (1 - alpha) + rgba[0] * alpha);
  target.data[at + 1] = Math.round(target.data[at + 1] * (1 - alpha) + rgba[1] * alpha);
  target.data[at + 2] = Math.round(target.data[at + 2] * (1 - alpha) + rgba[2] * alpha);
  target.data[at + 3] = Math.max(target.data[at + 3], rgba[3]);
}

/** Draw `source` into `target` at `zoom`, over a checkerboard so transparent
 *  pixels are distinguishable from black ones. */
function stamp(target: Pixels, source: Pixels, ox: number, oy: number, zoom: number): void {
  for (let y = 0; y < source.height * zoom; y++) {
    for (let x = 0; x < source.width * zoom; x++) {
      const at = (Math.floor(y / zoom) * source.width + Math.floor(x / zoom)) * 4;
      put(target, ox + x, oy + y, CHECKER[(Math.floor(x / 4) + Math.floor(y / 4)) % 2]);
      const alpha = source.data[at + 3];
      if (alpha > 0) {
        put(target, ox + x, oy + y, [
          source.data[at],
          source.data[at + 1],
          source.data[at + 2],
          alpha,
        ]);
      }
    }
  }
}

const crop = (image: Pixels, rect: Rect): Pixels => {
  const out: Pixels = {
    width: rect.sw,
    height: rect.sh,
    data: new Uint8Array(rect.sw * rect.sh * 4),
  };
  for (let y = 0; y < rect.sh; y++) {
    const from = ((rect.sy + y) * image.width + rect.sx) * 4;
    out.data.set(image.data.subarray(from, from + rect.sw * 4), y * rect.sw * 4);
  }
  return out;
};

/** The source frame, zoomed, with the four inset cuts drawn across it. */
export function annotate(image: Pixels, rect: Rect, insets: Insets, zoom = 8): Pixels {
  const target: Pixels = {
    width: rect.sw * zoom,
    height: rect.sh * zoom,
    data: new Uint8Array(rect.sw * zoom * rect.sh * zoom * 4),
  };
  stamp(target, crop(image, rect), 0, 0, zoom);
  for (const x of [insets.left, rect.sw - insets.right]) {
    for (let y = 0; y < target.height; y++) put(target, x * zoom, y, GUIDE);
  }
  for (const y of [insets.top, rect.sh - insets.bottom]) {
    for (let x = 0; x < target.width; x++) put(target, x, y * zoom, GUIDE);
  }
  return target;
}

/** A contact sheet of the frame composed at sizes chosen to expose wrap bugs:
 *  the minimum, an exact multiple of the centre band, and two sizes that land
 *  mid-tile so the clipped final repeat is visible. */
export function previewSheet(image: Pixels, rect: Rect, insets: Insets, zoom = 4): Pixels {
  const centerW = Math.max(1, rect.sw - insets.left - insets.right);
  const centerH = Math.max(1, rect.sh - insets.top - insets.bottom);
  const minW = insets.left + insets.right;
  const minH = insets.top + insets.bottom;
  const sizes = [
    { w: Math.max(1, minW), h: Math.max(1, minH) },
    { w: minW + centerW * 3, h: minH + centerH * 2 },
    { w: minW + centerW * 3 + 1, h: minH + centerH * 2 + 1 },
    { w: minW + Math.round(centerW * 4.5), h: minH + Math.round(centerH * 2.5) },
  ];
  const gap = 8;
  const width = sizes.reduce((total, size) => total + size.w * zoom + gap, gap);
  const height = Math.max(...sizes.map((size) => size.h * zoom)) + gap * 2;
  const sheet: Pixels = { width, height, data: new Uint8Array(width * height * 4) };
  let x = gap;
  for (const size of sizes) {
    stamp(sheet, compose(image, rect, insets, size.w, size.h), x, gap, zoom);
    x += size.w * zoom + gap;
  }
  return sheet;
}
