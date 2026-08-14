// ---------- HotReload -------------------------------------------------------
// A tiny adapter around bundler HMR. MiniMotor does not depend on Vite at
// runtime; consumers pass the bundler's compatible hot context when available.
//
// The namespace is `HotReload`, so the bridge it returns cannot also be called
// that — `import * as HotReload` and `import type { HotReload }` are the same
// identifier and would collide at any call site that wanted both. The returned
// object is `HotBridge`.
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
export function createHotReload(context) {
    if (!context) {
        return {
            enabled: false,
            restore: () => undefined,
            persist: () => { },
            onDispose: () => { },
        };
    }
    const readers = new Map();
    const cleanups = [];
    context.accept();
    context.dispose((data) => {
        for (const [key, read] of readers)
            data[key] = read();
        for (const cleanup of cleanups)
            cleanup();
    });
    return {
        enabled: true,
        restore(key) {
            return context.data[key];
        },
        persist(key, read) {
            readers.set(key, read);
        },
        onDispose(cleanup) {
            cleanups.push(cleanup);
        },
    };
}
/** Short namespace-friendly spelling: `HotReload.create(...)`. */
export const create = createHotReload;
