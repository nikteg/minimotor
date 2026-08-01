/** Measured geometry shared by list rendering and callers that need to keep a
 * particular variable-height row visible before rendering begins. */
export interface ListMetrics {
  heights: number[];
  tops: number[];
  content: number;
  rowAt(position: number): number;
}

/** Measure a list's rows once. A callback is useful for variable-height rows,
 * while a number keeps the fixed-row path just as cheap and predictable. */
export function listMetrics(
  count: number,
  rowH: number | ((index: number) => number),
  gap = 0,
): ListMetrics {
  const heights = Array.from({ length: count }, (_, index) => {
    const value = typeof rowH === "function" ? rowH(index) : rowH;
    return Number.isFinite(value) ? Math.max(1, value) : 1;
  });
  const tops: number[] = Array.from({ length: count + 1 }, () => 0);
  for (let index = 0; index < count; index++) {
    tops[index + 1] = tops[index] + heights[index] + (index < count - 1 ? gap : 0);
  }
  return {
    heights,
    tops,
    content: tops[count],
    rowAt(position: number): number {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid + 1] <= position) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(lo, Math.max(0, count - 1));
    },
  };
}
