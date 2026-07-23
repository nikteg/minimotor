const WINDOW = 60; // frames of history (matches the perf tracker)

// ---------- Sparkline ----------

/** A tiny fixed-capacity history graph: `push` a sample per frame, `draw`
 *  renders right-aligned bars scaled to the window's max. Ring buffer —
 *  no allocations after creation. */
export interface Sparkline {
  /** Record one sample, evicting the oldest once at capacity. */
  push(v: number): void;
  /** Draw the history as bars in the box `x`,`y`,`w`,`h`, filled with `color`.
   *  Heights scale to the window's max; newest bar sits flush with the right
   *  edge. No-op until the first `push`. */
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void;
}

/** Create a fixed-capacity sparkline backed by a ring buffer — `capacity`
 *  samples of history (default `WINDOW`), no allocations after creation. */
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
