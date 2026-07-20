// ---------- Asset preloading ----------
// Load images and JSON up front, cache them by name, then fetch synchronously
// during the game. Kind is inferred from the URL extension.
//
//   await Minimotor.Assets.load(
//     { hero: "hero.png", level: "level1.json" },
//     (done, total) => showBar(done / total),
//   );
//   const img = Minimotor.Assets.image("hero");
//   const data = Minimotor.Assets.json("level");

/** name → URL. Extensions decide the loader: .png/.jpg/.jpeg/.webp/.gif/.bmp →
 *  image; .json → parsed JSON. */
export type AssetManifest = Record<string, string>;

/** Called after each asset resolves, with completed and total counts. */
export type ProgressFn = (loaded: number, total: number) => void;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const JSON_EXT = /\.json$/i;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener(
      "error",
      () => reject(new Error(`Minimotor.Assets: failed to load image "${url}"`)),
      { once: true },
    );
    img.src = url;
  });
}

async function loadJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Minimotor.Assets: failed to load JSON "${url}" (${res.status})`);
  }
  return res.json();
}

function loadOne(url: string): Promise<unknown> {
  if (IMAGE_EXT.test(url)) return loadImage(url);
  if (JSON_EXT.test(url)) return loadJson(url);
  return Promise.reject(
    new Error(`Minimotor.Assets: unknown asset type for "${url}" (expected image or .json)`),
  );
}

/** An isolated asset cache. `Minimotor.Assets` is a shared default instance. */
export interface AssetStore {
  /** Load every entry in the manifest in parallel; resolves when all are ready.
   *  `onProgress` fires as each one completes. Loaded assets merge into the
   *  cache, so `load` can be called in stages. */
  load(manifest: AssetManifest, onProgress?: ProgressFn): Promise<void>;
  /** Get a loaded asset by name (throws if absent). */
  get<T>(name: string): T;
  /** Get a loaded image (throws if absent or not an image). */
  image(name: string): HTMLImageElement;
  /** Get loaded, parsed JSON (throws if absent). */
  json<T = unknown>(name: string): T;
  /** Is `name` loaded? */
  has(name: string): boolean;
  /** Drop everything from the cache. */
  clear(): void;
}

export function createAssets(): AssetStore {
  const cache = new Map<string, unknown>();

  const store: AssetStore = {
    async load(manifest, onProgress) {
      const names = Object.keys(manifest);
      const total = names.length;
      let loaded = 0;
      await Promise.all(
        names.map(async (name) => {
          const asset = await loadOne(manifest[name]);
          cache.set(name, asset);
          loaded++;
          onProgress?.(loaded, total);
        }),
      );
    },

    get<T>(name: string): T {
      if (!cache.has(name)) {
        throw new Error(`Minimotor.Assets: "${name}" is not loaded (call load() first)`);
      }
      return cache.get(name) as T;
    },

    image(name) {
      const a = store.get<unknown>(name);
      if (!(a instanceof HTMLImageElement)) {
        throw new Error(`Minimotor.Assets: "${name}" is not an image`);
      }
      return a;
    },

    json<T = unknown>(name: string): T {
      return store.get<T>(name);
    },

    has(name) {
      return cache.has(name);
    },

    clear() {
      cache.clear();
    },
  };
  return store;
}

/** The default shared asset store (`Minimotor.Assets`). */
export const Assets = createAssets();
