export interface InputContextApi {
  readonly active: string;
  set(name: string): void;
  is(name: string): boolean;
  within<T>(name: string, run: () => T): T;
}

export function createInputContext(initial = "gameplay"): InputContextApi {
  let active = initial;
  return {
    get active() {
      return active;
    },
    set(name) {
      active = name;
    },
    is(name) {
      return active === name;
    },
    within(name, run) {
      const previous = active;
      active = name;
      try {
        return run();
      } finally {
        active = previous;
      }
    },
  };
}
