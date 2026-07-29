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
export function createPrediction<S, I>(options: PredictionOptions<S, I>): Prediction<S, I> {
  let sequence = 0;
  let corrections = 0;
  const pending: PredictedInput<I>[] = [];
  return {
    get sequence() {
      return sequence;
    },
    get pending() {
      return pending.length;
    },
    get corrections() {
      return corrections;
    },
    step(input, dtMs) {
      const frame = { sequence: ++sequence, input, dtMs };
      pending.push(frame);
      options.simulate(input, dtMs);
      return frame;
    },
    reconcile(state, acknowledgedSequence) {
      corrections++;
      options.restore(state);
      while (pending.length && pending[0].sequence <= acknowledgedSequence) pending.shift();
      for (const frame of pending) options.simulate(frame.input, frame.dtMs);
    },
    clear() {
      pending.length = 0;
    },
  };
}

/** Ordered, duplicate-free input inbox for an authoritative host/server. */
export interface InputBuffer<I> {
  push(clientId: string, frame: PredictedInput<I>): boolean;
  drain(clientId: string): PredictedInput<I>[];
  acknowledged(clientId: string): number;
  remove(clientId: string): void;
}

export function createInputBuffer<I>(): InputBuffer<I> {
  const queues = new Map<string, PredictedInput<I>[]>();
  const acknowledged = new Map<string, number>();
  return {
    push(clientId, frame) {
      if (frame.sequence <= (acknowledged.get(clientId) ?? 0)) return false;
      let queue = queues.get(clientId);
      if (!queue) queues.set(clientId, (queue = []));
      if (queue.some((item) => item.sequence === frame.sequence)) return false;
      queue.push(frame);
      queue.sort((a, b) => a.sequence - b.sequence);
      return true;
    },
    drain(clientId) {
      const queue = queues.get(clientId) ?? [];
      const ready: PredictedInput<I>[] = [];
      let next = (acknowledged.get(clientId) ?? 0) + 1;
      while (queue[0]?.sequence === next) {
        ready.push(queue.shift()!);
        next++;
      }
      if (queue.length === 0) queues.delete(clientId);
      if (ready.length) acknowledged.set(clientId, ready[ready.length - 1].sequence);
      return ready;
    },
    acknowledged(clientId) {
      return acknowledged.get(clientId) ?? 0;
    },
    remove(clientId) {
      queues.delete(clientId);
      acknowledged.delete(clientId);
    },
  };
}
