export interface RollbackApi {
  save<T>(step: number, state: T): void;
  load<T>(step: number): T | undefined;
  discardBefore(step: number): void;
  clear(): void;
}

export function createRollback(): RollbackApi {
  const history = new Map<number, unknown>();
  return {
    save(step, state) {
      history.set(step, structuredClone(state));
    },
    load<T>(step: number) {
      const state = history.get(step);
      return state === undefined ? undefined : (structuredClone(state) as T);
    },
    discardBefore(step) {
      for (const at of history.keys()) if (at < step) history.delete(at);
    },
    clear() {
      history.clear();
    },
  };
}
