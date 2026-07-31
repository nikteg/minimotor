/** A clock cursor that turns a monotonically increasing source into elapsed quanta.
 * Reading consumes every complete quantum, while `limit` caps only the work
 * returned to the caller so a long idle period cannot cause an update storm. */
export interface LazySteps {
  take(): number;
  reset(): void;
}

export function lazySteps(
  read: () => number,
  quantum = 1,
  limit = Number.POSITIVE_INFINITY,
): LazySteps {
  if (!Number.isFinite(quantum) || quantum <= 0) {
    throw new RangeError("lazySteps: quantum must be a positive finite number");
  }
  let cursor = read();
  return {
    take() {
      const elapsed = Math.floor((read() - cursor) / quantum);
      if (elapsed <= 0) return 0;
      cursor += elapsed * quantum;
      return Math.min(elapsed, limit);
    },
    reset() {
      cursor = read();
    },
  };
}
