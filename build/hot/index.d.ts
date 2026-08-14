/** The small subset of Vite's `import.meta.hot` contract needed by MiniMotor. */
export interface HotModuleContext {
    data: Record<string, unknown>;
    accept(): void;
    dispose(callback: (data: Record<string, unknown>) => void): void;
}
export interface HotBridge {
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
 * const hot = HotReload.create((import.meta as ImportMeta & { hot?: HotModuleContext }).hot);
 * const previous = hot.restore<{ score: number }>("game");
 * let score = previous?.score ?? 0;
 * hot.persist("game", () => ({ score }));
 * hot.onDispose(() => app.destroy());
 * ```
 *
 * In production, the returned bridge is a no-op and state simply starts from
 * the caller's defaults. MiniMotor never assumes a specific bundler. */
export declare function createHotReload(context?: HotModuleContext): HotBridge;
/** Short namespace-friendly spelling: `HotReload.create(...)`. */
export declare const create: typeof createHotReload;
