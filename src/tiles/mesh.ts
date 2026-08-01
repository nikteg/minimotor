// ---------- Merged collision rects (greedy meshing) ----------
// One rect per solid TILE makes moveAndSlide sweep against hundreds of boxes
// over a plain floor, and leaves an internal edge between every neighboring
// pair for a mover to snag on. Instead, merge runs of identically-behaving
// cells ONCE and cache the result until a cell changes.
//
// Plain solids merge on both axes — the union is the same region with no
// interior faces. One-way platforms merge HORIZONTALLY ONLY: stacking them
// into a tall rect would swallow the lower platform's top surface, which is
// the only face a one-way solid has. Slopes and multi-cell spans never merge;
// they carry their own shape.
//
// Nothing here knows what a rect MEANS: callers hand in a membership grid and
// get merged, indexed rects back, which is why the same code serves collision
// solids and every region tag.

import type { Rect } from "@src/engine/index.js";

/** Tile-grid dimensions the meshing and indexing are relative to. */
export interface GridDims {
  cols: number;
  rows: number;
  /** World size of one tile, px. */
  size: number;
}

export interface MergedIndex<R extends Rect> {
  rects: R[];
  /** Tile row → indices of every rect covering it. */
  byRow: number[][];
  /** Per-query dedupe stamp: one rect can sit in several row buckets. */
  seen: Int32Array;
  epoch: number;
  /** Widest rect in the index — how far left of the query a rect can start
   *  and still reach it, which bounds the binary search in each bucket. */
  maxWidth: number;
}

/** Greedy-mesh a membership grid. Runs are grown right first, then down when
 *  `mergeDown` (never for one-way platforms). */
export function mesh(
  dims: GridDims,
  member: Uint8Array,
  mergeDown: boolean,
  make: (cx: number, cy: number, w: number, h: number) => void,
): void {
  const { cols, rows } = dims;
  const used = new Uint8Array(member.length);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const at = cy * cols + cx;
      if (!member[at] || used[at]) continue;
      let w = 1;
      while (cx + w < cols && member[at + w] && !used[at + w]) w++;
      let h = 1;
      while (mergeDown && cy + h < rows) {
        const row = (cy + h) * cols + cx;
        let whole = true;
        for (let i = 0; i < w; i++) {
          if (!member[row + i] || used[row + i]) {
            whole = false;
            break;
          }
        }
        if (!whole) break;
        h++;
      }
      for (let oy = 0; oy < h; oy++) {
        const start = (cy + oy) * cols + cx;
        used.fill(1, start, start + w);
      }
      make(cx, cy, w, h);
    }
  }
}

/** Sort row-major and bucket by tile row, each bucket ordered by x, so a
 *  query touches only its row band and only the columns it overlaps. */
export function indexRects<R extends Rect>(dims: GridDims, rects: R[]): MergedIndex<R> {
  const { rows, size } = dims;
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  const byRow: number[][] = Array.from({ length: rows }, () => []);
  let maxWidth = 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.w > maxWidth) maxWidth = r.w;
    const first = Math.max(0, Math.floor(r.y / size));
    const last = Math.min(rows - 1, Math.ceil((r.y + r.h) / size) - 1);
    for (let row = first; row <= last; row++) byRow[row].push(i);
  }
  for (const bucket of byRow) bucket.sort((a, b) => rects[a].x - rects[b].x);
  return { rects, byRow, seen: new Int32Array(rects.length), epoch: 0, maxWidth };
}

/** Append every indexed rect overlapping `area` to `out`, each at most once. */
export function queryIndex<R extends Rect>(
  dims: GridDims,
  index: MergedIndex<R>,
  area: Rect,
  out: R[],
): R[] {
  const { rows, size } = dims;
  if (index.epoch > 0x3fffffff) {
    index.seen.fill(0);
    index.epoch = 0;
  }
  const epoch = ++index.epoch;
  const first = Math.max(0, Math.floor(area.y / size));
  const last = Math.min(rows - 1, Math.floor((area.y + area.h) / size));
  const right = area.x + area.w;
  // No rect starting left of this can still reach the query.
  const reach = area.x - index.maxWidth;
  for (let row = first; row <= last; row++) {
    const bucket = index.byRow[row];
    // Binary-search the first rect in this row that could touch the query;
    // buckets are x-ordered, so the scan also stops as soon as one starts
    // past its right edge.
    let lo = 0;
    let hi = bucket.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (index.rects[bucket[mid]].x < reach) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < bucket.length; i++) {
      const at = bucket[i];
      const r = index.rects[at];
      if (r.x >= right) break;
      if (index.seen[at] === epoch) continue;
      index.seen[at] = epoch;
      if (r.x + r.w > area.x && r.y < area.y + area.h && r.y + r.h > area.y) out.push(r);
    }
  }
  return out;
}
