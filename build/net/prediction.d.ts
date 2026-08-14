export interface PredictionOptions<S, I> {
    /** Restore an authoritative state in-place. */
    restore(state: S): void;
    /** Apply one input to local state. Must be deterministic for replay. */
    simulate(input: I, dtMs: number): void;
}
export interface PredictedInput<I> {
    sequence: number;
    input: I;
    dtMs: number;
}
export interface Prediction<S, I> {
    readonly sequence: number;
    readonly pending: number;
    readonly corrections: number;
    step(input: I, dtMs: number): PredictedInput<I>;
    reconcile(state: S, acknowledgedSequence: number): void;
    clear(): void;
}
/** Client-side prediction core: number inputs, simulate immediately, then
 * restore authoritative state and replay unacknowledged inputs on correction. */
export declare function createPrediction<S, I>(options: PredictionOptions<S, I>): Prediction<S, I>;
/** Ordered, duplicate-free input inbox for an authoritative host/server. */
export interface InputBuffer<I> {
    push(clientId: string, frame: PredictedInput<I>): boolean;
    drain(clientId: string): PredictedInput<I>[];
    acknowledged(clientId: string): number;
    remove(clientId: string): void;
}
export declare function createInputBuffer<I>(): InputBuffer<I>;
