export interface Inspection {
  name: string;
  read(): unknown;
}

export interface InspectorApi {
  watch(name: string, read: () => unknown): () => void;
  snapshot(): Record<string, unknown>;
  readonly entries: readonly Inspection[];
}

export function createInspector(): InspectorApi {
  const entries = new Map<string, Inspection>();
  return {
    watch(name, read) {
      entries.set(name, { name, read });
      return () => entries.delete(name);
    },
    snapshot() {
      return Object.fromEntries([...entries].map(([name, entry]) => [name, entry.read()]));
    },
    get entries() {
      return [...entries.values()];
    },
  };
}
