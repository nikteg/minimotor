export interface NetworkSimulationOptions {
  latency?: number;
  jitter?: number;
  loss?: number;
  duplicate?: number;
  random?: () => number;
}

export interface NetworkSimulationApi {
  readonly pending: number;
  configure(options: NetworkSimulationOptions): void;
  send<T>(value: T, deliver: (value: T) => void): void;
  clear(): void;
  destroy(): void;
}

export function createNetworkSimulation(
  initial: NetworkSimulationOptions = {},
): NetworkSimulationApi {
  let options = { ...initial };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const send = <T>(value: T, deliver: (value: T) => void) => {
    const random = options.random ?? Math.random;
    if (random() < (options.loss ?? 0)) return;
    const copies = random() < (options.duplicate ?? 0) ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      const spread = (random() * 2 - 1) * (options.jitter ?? 0);
      const delay = Math.max(0, (options.latency ?? 0) + spread);
      const timer = setTimeout(() => {
        timers.delete(timer);
        deliver(value);
      }, delay);
      timers.add(timer);
    }
  };
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  return {
    get pending() {
      return timers.size;
    },
    configure(next) {
      options = { ...options, ...next };
    },
    send,
    clear,
    destroy: clear,
  };
}
