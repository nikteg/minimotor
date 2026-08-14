import type { App } from "../engine/app.js";
type Awaitable<T> = T | PromiseLike<T>;
/** Raw string storage. Async-first so browser, IndexedDB, cloud, and server
 * backends share one honest contract. */
export interface StorageBackend {
    getItem(key: string): Awaitable<string | null>;
    setItem(key: string, value: string): Awaitable<void>;
    removeItem(key: string): Awaitable<void>;
}
export interface StorageArea {
    load<T>(key: string, fallback: T): Promise<T>;
    save(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
}
export interface StorageApi<N extends string = string> extends StorageArea {
    readonly names: readonly N[];
    store(name: N): StorageArea;
}
export interface StorageOptions<S extends Record<string, StorageBackend>> {
    stores: S;
    default: keyof S & string;
    /** Prefix applied before the store name and key. Defaults to
     * `minimotor:<canvas-id>:`. */
    prefix?: string;
}
/** Wrap a browser `Storage` object or another raw string backend. */
export declare function browserStorage(backend?: StorageBackend): StorageBackend;
export declare function createStorage<const S extends Record<string, StorageBackend>>(app: App, options: StorageOptions<S>): StorageApi<keyof S & string>;
export declare function createBrowserStorage(app: App, backend?: StorageBackend): StorageApi<"browser">;
export * from "./local.js";
