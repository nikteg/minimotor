export interface StateBinding<T = unknown> {
  save(): T;
  load(value: T): void;
}

export interface SnapshotsApi {
  register<T>(name: string, binding: StateBinding<T>): () => void;
  capture(): Record<string, unknown>;
  restore(snapshot: Readonly<Record<string, unknown>>): void;
}

export function createSnapshots(): SnapshotsApi {
  const bindings = new Map<string, StateBinding>();
  return {
    register(name, binding) {
      if (bindings.has(name)) throw new Error(`Minimotor: duplicate snapshot binding "${name}"`);
      bindings.set(name, binding as StateBinding);
      return () => bindings.delete(name);
    },
    capture() {
      const snapshot: Record<string, unknown> = {};
      for (const [name, binding] of bindings) snapshot[name] = structuredClone(binding.save());
      return snapshot;
    },
    restore(snapshot) {
      for (const [name, value] of Object.entries(snapshot))
        bindings.get(name)?.load(structuredClone(value));
    },
  };
}
