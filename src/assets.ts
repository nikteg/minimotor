// ---------- Asset preloading ----------
// Load images and JSON up front, then use them synchronously during the game.
// `load()` RETURNS the composed resources keyed by your manifest keys, so you
// hold real references and never look anything up by string:
//
//   const { hero, terrain, level } = await Minimotor.Assets.load({
//     hero:    { src: "hero.png", sheet: { fw: 32, fh: 32, fps: 8 } }, // → Animation
//     terrain: "terrain.png",                                          // → HTMLImageElement
//     level:   "level1.json",                                          // → parsed JSON
//   });
//   hero.update(dt);  ctx.drawImage(terrain, x, y);
//
// The raw image/JSON is also cached by name, so the string-lookup style still
// works (`Assets.image("terrain")`) — handy for loading in stages. Draw a
// loading bar straight from the live progress, no callback wiring:
//
//   if (Minimotor.Assets.loading) UI.bar(x, y, w, h, Minimotor.Assets.progress);

import { sheet as animSheet, type SheetConfig, type SheetImage } from "./anim.js";
import { tint as tintSprite } from "./sprites.js";

/** A manifest entry: a plain URL, or a `{ src }` spec that composes the loaded
 *  image into a higher-level resource. Extensions decide the loader:
 *  .png/.jpg/.jpeg/.webp/.gif/.bmp → image; .json → parsed JSON. */
export type AssetSpec =
  | string
  /** Slice the loaded image into a sprite-sheet `Animation` (Anim.sheet). */
  | { src: string; sheet: SheetConfig }
  /** Pre-render a solid-colour silhouette of the image (Sprites.tint). */
  | { src: string; tint: string }
  /** An image with no composition — same as the bare URL, spelled explicitly. */
  | { src: string };

/** name → spec. */
export type AssetManifest = Record<string, AssetSpec>;

/** Called after each asset resolves, with completed and total counts. */
export type ProgressFn = (loaded: number, total: number) => void;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const JSON_EXT = /\.json$/i;

function specSrc(spec: AssetSpec): string {
  return typeof spec === "string" ? spec : spec.src;
}

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

// Build the composed resource a spec asks for from its raw (cached) asset.
function compose(spec: AssetSpec, raw: unknown): unknown {
  if (typeof spec === "string") return raw;
  if ("sheet" in spec) return animSheet(raw as SheetImage, spec.sheet);
  if ("tint" in spec) return tintSprite(raw as HTMLImageElement, spec.tint);
  return raw;
}

/** An isolated asset cache. `Minimotor.Assets` is a shared default instance. */
export interface AssetStore {
  /** Load every entry in parallel; resolves with the composed resources keyed
   *  by manifest key. `onProgress` fires as each one completes. The raw
   *  image/JSON also merges into the by-name cache, so `load` can be called in
   *  stages and `image`/`json` still work. */
  load(manifest: AssetManifest, onProgress?: ProgressFn): Promise<Record<string, unknown>>;
  /** Get a loaded raw asset by name (throws if absent). */
  get<T>(name: string): T;
  /** Get a loaded image (throws if absent or not an image). */
  image(name: string): HTMLImageElement;
  /** Get loaded, parsed JSON (throws if absent). */
  json<T = unknown>(name: string): T;
  /** Is `name` loaded? */
  has(name: string): boolean;
  /** Drop everything from the cache. */
  clear(): void;
  /** Load progress across all in-flight `load()` calls, 0..1 (1 when idle). */
  readonly progress: number;
  /** True while any `load()` is still in flight — gate a loading screen on it. */
  readonly loading: boolean;
}

export function createAssets(): AssetStore {
  const cache = new Map<string, unknown>();
  // Aggregate progress across concurrent/staged loads: reset once everything
  // in flight has settled, so `progress` reads 1 and `loading` reads false.
  let pending = 0;
  let completed = 0;

  const store: AssetStore = {
    async load(manifest, onProgress) {
      const names = Object.keys(manifest);
      pending += names.length;
      const total = names.length;
      let loaded = 0;
      const result: Record<string, unknown> = {};
      // allSettled so every item finishes before we touch the shared counters —
      // a rejected asset must still count as "settled" or `loading` would stick.
      const settled = await Promise.allSettled(
        names.map(async (name) => {
          try {
            const raw = await loadOne(specSrc(manifest[name]));
            cache.set(name, raw);
            result[name] = compose(manifest[name], raw);
            loaded++;
            onProgress?.(loaded, total);
          } finally {
            completed++; // counts every settle (success or failure)
          }
        }),
      );
      // The last in-flight load to finish zeroes the aggregate counters.
      if (completed >= pending) {
        pending = 0;
        completed = 0;
      }
      const failure = settled.find((s) => s.status === "rejected");
      if (failure) throw (failure as PromiseRejectedResult).reason;
      return result;
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

    get progress() {
      return pending === 0 ? 1 : completed / pending;
    },

    get loading() {
      return pending > 0;
    },
  };
  return store;
}

/** The default shared asset store (`Minimotor.Assets`). */
export const Assets = createAssets();
