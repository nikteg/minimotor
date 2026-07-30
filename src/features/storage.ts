import type { Game } from "../engine/app.js";

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

const unavailable: StorageBackend = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function browserBackend(): StorageBackend {
  try {
    return globalThis.localStorage ?? unavailable;
  } catch {
    return unavailable;
  }
}

/** Wrap a browser `Storage` object or another raw string backend. */
export function browserStorage(backend: StorageBackend = browserBackend()): StorageBackend {
  return backend;
}

export function createStorage<const S extends Record<string, StorageBackend>>(
  game: Game,
  options: StorageOptions<S>,
): StorageApi<keyof S & string> {
  type Name = keyof S & string;
  const prefix = options.prefix ?? `minimotor:${game.canvas.id || "game"}:`;
  const names = Object.keys(options.stores) as Name[];
  const areas = new Map<Name, StorageArea>();

  const area = (name: Name): StorageArea => {
    const existing = areas.get(name);
    if (existing) return existing;
    const backend = options.stores[name];
    if (!backend) throw new Error(`Minimotor.Storage: no store named "${name}"`);
    const key = (value: string) => `${prefix}${name}:${value}`;
    const result: StorageArea = {
      async load<T>(item: string, fallback: T): Promise<T> {
        try {
          const raw = await backend.getItem(key(item));
          return raw === null ? fallback : (JSON.parse(raw) as T);
        } catch {
          return fallback;
        }
      },
      async save(item, data) {
        try {
          await backend.setItem(key(item), JSON.stringify(data));
        } catch {
          // Storage is intentionally crash-safe.
        }
      },
      async remove(item) {
        try {
          await backend.removeItem(key(item));
        } catch {
          // Storage is intentionally crash-safe.
        }
      },
    };
    areas.set(name, result);
    return result;
  };

  const defaultArea = area(options.default);
  return {
    names,
    store: area,
    load: defaultArea.load,
    save: defaultArea.save,
    remove: defaultArea.remove,
  };
}

export function createBrowserStorage(
  game: Game,
  backend: StorageBackend = browserStorage(),
): StorageApi<"browser"> {
  return createStorage(game, { stores: { browser: backend }, default: "browser" });
}
