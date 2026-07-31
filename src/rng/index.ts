export interface Rng {
  seed: number;
  random(): number;
  integer(min: number, max: number): number;
  choose<T>(values: readonly T[]): T;
}

export function createRng(seed = 0x6d2b79f5): Rng {
  let state = seed >>> 0;
  const api: Rng = {
    get seed() {
      return state;
    },
    set seed(value) {
      state = value >>> 0;
    },
    random() {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    integer(min, max) {
      return Math.floor(api.random() * (max - min + 1)) + min;
    },
    choose(values) {
      if (values.length === 0) throw new Error("Minimotor: cannot choose from an empty list");
      return values[Math.floor(api.random() * values.length)];
    },
  };
  return api;
}
