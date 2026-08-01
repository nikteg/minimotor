// ---------- Hot reload ------------------------------------------------------
// A tiny adapter around bundler HMR. MiniMotor does not depend on Vite at
// runtime; consumers pass the bundler's compatible hot context when available.

/** The small subset of Vite's `import.meta.hot` contract needed by MiniMotor. */
export interface HotModuleContext {
  data: Record<string, unknown>;
  accept(): void;
  dispose(callback: (data: Record<string, unknown>) => void): void;
}

export interface HotReload {
  /** False during production/full-page loads where no HMR context exists. */
  readonly enabled: boolean;
  /** Read state saved by the previous module instance. */
  restore<T>(key: string): T | undefined;
  /** Register a serializable state reader for the next module replacement. */
  persist<T>(key: string, read: () => T): void;
  /** Run cleanup when this module instance is replaced. */
  onDispose(cleanup: () => void): void;
}

/** Create a bundler-independent HMR state bridge.
 *
 * ```ts
 * const hot = Hot.create((import.meta as ImportMeta & { hot?: HotModuleContext }).hot);
 * const previous = hot.restore<{ score: number }>("game");
 * let score = previous?.score ?? 0;
 * hot.persist("game", () => ({ score }));
 * hot.onDispose(() => app.destroy());
 * ```
 *
 * In production, the returned bridge is a no-op and state simply starts from
 * the caller's defaults. MiniMotor never assumes a specific bundler. */
export function createHotReload(context?: HotModuleContext): HotReload {
  if (!context) {
    return {
      enabled: false,
      restore: () => undefined,
      persist: () => {},
      onDispose: () => {},
    };
  }

  const readers = new Map<string, () => unknown>();
  const cleanups: (() => void)[] = [];
  context.accept();
  context.dispose((data) => {
    for (const [key, read] of readers) data[key] = read();
    for (const cleanup of cleanups) cleanup();
  });
  return {
    enabled: true,
    restore<T>(key: string): T | undefined {
      return context.data[key] as T | undefined;
    },
    persist<T>(key: string, read: () => T): void {
      readers.set(key, read);
    },
    onDispose(cleanup: () => void): void {
      cleanups.push(cleanup);
    },
  };
}

/** Short namespace-friendly spelling: `Hot.create(...)`. */
export const create = createHotReload;
