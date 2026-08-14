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
export declare function listMetrics(count: number, rowH: number | ((index: number) => number), gap?: number): ListMetrics;
