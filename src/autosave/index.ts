// ---------- Autosave ----------
import type { App } from "@src/engine/app.js";
import type { SnapshotsApi } from "@src/snapshots/index.js";
import type { StorageApi } from "@src/storage/index.js";

export interface AutosaveOptions<N extends string = string> {
  key?: string;
  everySteps?: number;
  store?: N;
}

export interface AutosaveApi {
  save(): Promise<void>;
  load(): Promise<boolean>;
  clear(): Promise<void>;
}

/** Periodically persist explicit snapshots through an explicit storage service. */
export function createAutosave<N extends string>(
  app: App,
  snapshots: SnapshotsApi,
  storage: StorageApi<N>,
  { key = "autosave", everySteps = 300, store }: AutosaveOptions<N> = {},
): AutosaveApi {
  const selected = store ? storage.store(store) : storage;
  const save = () => selected.save(key, snapshots.capture());
  const api: AutosaveApi = {
    save,
    async load() {
      const snapshot = await selected.load<Record<string, unknown> | null>(key, null);
      if (!snapshot) return false;
      snapshots.restore(snapshot);
      return true;
    },
    clear: () => selected.remove(key),
  };
  const every = Math.max(1, everySteps);
  const unsubscribe = app.Loop.onStep(() => {
    if (app.Loop.steps % every === 0) void save();
  });
  app.onDestroy(unsubscribe);
  return api;
}
