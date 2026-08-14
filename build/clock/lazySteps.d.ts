/** A clock cursor that turns a monotonically increasing source into elapsed quanta.
 * Reading consumes every complete quantum, while `limit` caps only the work
 * returned to the caller so a long idle period cannot cause an update storm. */
export interface LazySteps {
    take(): number;
    reset(): void;
}
export declare function lazySteps(read: () => number, quantum?: number, limit?: number): LazySteps;
