export type ReplicationMode = "reliable" | "unreliable" | "interpolated" | "predicted" | "owner";

export type ReplicationSchema<T extends object> = {
  [K in keyof T]?: ReplicationMode;
};

export interface ReplicatedObject<T extends object = object> {
  readonly id: string;
  readonly value: T;
  readonly schema: ReplicationSchema<T>;
}

export interface ReplicationApi {
  sync<T extends object>(id: string, value: T, schema: ReplicationSchema<T>): () => void;
  get<T extends object>(id: string): ReplicatedObject<T> | undefined;
  readonly objects: readonly ReplicatedObject[];
}

export function createReplication(): ReplicationApi {
  const objects = new Map<string, ReplicatedObject>();
  return {
    sync(id, value, schema) {
      objects.set(id, { id, value, schema } as ReplicatedObject);
      return () => objects.delete(id);
    },
    get<T extends object>(id: string) {
      return objects.get(id) as ReplicatedObject<T> | undefined;
    },
    get objects() {
      return [...objects.values()];
    },
  };
}
