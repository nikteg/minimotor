// ---------- Asset store implementation ----------
// Load images and JSON up front, then use them synchronously at runtime.
// `load()` RETURNS the composed resources keyed by your manifest keys, so you
// hold real references and never look anything up by string:
//
//   const Assets = createAssets(app);
//   const { hero, terrain, level } = await Assets.load({
//     hero: {
//       src: "hero.png",
//       aseprite: "hero.json",                              // → tagged Aseprite sheet
//     },
//     terrain: "terrain.png",                               // → HTMLImageElement
//     level:   "level1.json",                               // → parsed JSON
//   });
//   const anim = Animation.play(hero, "idle");  ctx.drawImage(terrain, x, y);
//
// The raw image/JSON is also cached by name, so the string-lookup style still
// works (`Assets.image("terrain")`) — handy for loading in stages. Draw a
// loading bar straight from the live progress, no callback wiring:
//
//   if (Assets.loading) UI.bar(x, y, w, h, Assets.progress);

import {
  fromGrid as animFromGrid,
  type GridAnimationSource,
  type SheetImage,
  type SheetOptions,
} from "@src/anim/index.js";
import {
  sheet as asepriteSheet,
  type Json as AsepriteJson,
  type Sheet as AsepriteSheet,
  type State as AsepriteState,
} from "@src/aseprite/index.js";
import { tint as tintSprite, type SpriteCanvas } from "@src/sprites/raster.js";
import { parseObj } from "@src/render3d/obj.js";
import type { MeshData } from "@src/render3d/mesh.js";

/** A manifest entry: a plain URL, or a `{ src }` spec that composes the loaded
 *  image into a higher-level resource. Extensions decide the loader:
 *  .png/.jpg/.jpeg/.webp/.gif/.bmp → image; .json/.tmj/.tsj/.ldtk → parsed JSON;
 *  .obj → parsed 3D MeshData; .ogg/.mp3/.wav/.m4a → ArrayBuffer (decoded
 *  lazily by `Audio.music`/sfx). */
export type AssetSpec =
  | string
  /** Slice the loaded image into a named-state `Sheet` (Anim.fromGrid). */
  | { src: string; sheet: SheetOptions<string> }
  /** Load an Aseprite-exported PNG plus JSON atlas. */
  | {
      src: string;
      aseprite: string | AsepriteJson;
    }
  /** Pre-render a solid-colour silhouette of the image (Sprites.tint). */
  | { src: string; tint: string }
  /** An image with no composition — same as the bare URL, spelled explicitly. */
  | { src: string };

type AudioUrl = `${string}.${"ogg" | "mp3" | "wav" | "m4a"}`;
type ObjUrl = `${string}.obj`;
type JsonUrl = `${string}.${"json" | "tmj" | "tsj" | "ldtk" | "ldtkl"}`;

/** What a manifest entry loads as — the per-key typing behind
 *  `const art = await Assets.load({ hero: "hero.png" })`. */
export type LoadedAsset<S extends AssetSpec> = S extends {
  sheet: SheetOptions<string>;
}
  ? GridAnimationSource<
      S["sheet"]["states"] extends Record<infer K extends string, unknown> ? K : string
    >
  : S extends { aseprite: infer D }
    ? AsepriteSheet<AsepriteState<D>>
    : S extends { tint: string }
      ? SpriteCanvas
      : S extends ObjUrl | { src: ObjUrl }
        ? MeshData
        : S extends JsonUrl | { src: JsonUrl }
          ? unknown
          : S extends AudioUrl | { src: AudioUrl }
            ? ArrayBuffer
            : HTMLImageElement;

/** The typed record `load()` resolves with: keys from the manifest, value
 *  types from each spec. `art.herp` is a compile error. */
export type Loaded<M extends AssetManifest> = {
  [K in keyof M]: LoadedAsset<M[K]>;
};

/** name → spec. */
export type AssetManifest = Record<string, AssetSpec>;

/** Called after each asset resolves, with completed and total counts. */
export type ProgressFn = (loaded: number, total: number) => void;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const OBJ_EXT = /\.obj$/i;
const JSON_EXT = /\.(json|tmj|tsj|ldtk|ldtkl)$/i;
const AUDIO_EXT = /\.(ogg|mp3|wav|m4a)$/i;

function specSrc(spec: AssetSpec): string {
  return typeof spec === "string" ? spec : spec.src;
}

interface RawAseprite {
  image: SheetImage;
  data: AsepriteJson;
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

async function loadAudio(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Minimotor.Assets: failed to load audio "${url}" (${res.status})`);
  }
  return res.arrayBuffer();
}

async function loadJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Minimotor.Assets: failed to load JSON "${url}" (${res.status})`);
  }
  return res.json();
}

async function loadObj(url: string): Promise<MeshData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Minimotor.Assets: failed to load OBJ "${url}" (${res.status})`);
  }
  return parseObj(await res.text());
}

function loadOne(url: string): Promise<unknown> {
  // Bundlers inline small assets as `data:` URIs (e.g. Vite under
  // `assetsInlineLimit`), which carry a MIME type instead of a file extension —
  // so `new URL("./x.png", import.meta.url)` can resolve to `data:image/png;…`.
  // Route those by MIME so a build-inlined asset loads exactly like its on-disk
  // `.png`/`.json`/`.ogg` form (this is why samples that work in `vite` dev
  // could 'fail to load' once built). `fetch` handles `data:` URIs too.
  if (url.startsWith("data:")) {
    if (/^data:image\//i.test(url)) return loadImage(url);
    if (/^data:application\/json/i.test(url)) return loadJson(url);
    if (/^data:audio\//i.test(url)) return loadAudio(url);
    if (/^data:(?:text\/plain|model\/obj)/i.test(url)) return loadObj(url);
    return loadImage(url); // unknown MIME: images are the common inlined case
  }
  if (IMAGE_EXT.test(url)) return loadImage(url);
  if (OBJ_EXT.test(url)) return loadObj(url);
  if (JSON_EXT.test(url)) return loadJson(url);
  if (AUDIO_EXT.test(url)) return loadAudio(url);
  return Promise.reject(
    new Error(
      `Minimotor.Assets: unknown asset type for "${url}" (expected image, OBJ, JSON map, or audio)`,
    ),
  );
}

// Build the composed resource a spec asks for from its raw (cached) asset.
function compose(spec: AssetSpec, raw: unknown): unknown {
  if (typeof spec === "string") return raw;
  if ("aseprite" in spec) {
    const source = raw as RawAseprite;
    return asepriteSheet(source.image, source.data);
  }
  if ("sheet" in spec) return animFromGrid(raw as SheetImage, spec.sheet);
  if ("tint" in spec) return tintSprite(raw as HTMLImageElement, spec.tint);
  return raw;
}

async function loadSpec(spec: AssetSpec): Promise<{ raw: unknown; cached: unknown }> {
  if (typeof spec !== "string" && "aseprite" in spec) {
    const [image, data] = await Promise.all([
      loadOne(spec.src),
      typeof spec.aseprite === "string" ? loadJson(spec.aseprite) : spec.aseprite,
    ]);
    const raw = { image: image as SheetImage, data: data as AsepriteJson };
    return { raw, cached: image };
  }
  const raw = await loadOne(specSrc(spec));
  return { raw, cached: raw };
}

/** An isolated asset cache. Use `createAssets(app)` for lifecycle ownership,
 * or `createAssetStore()` for an ownerless cache. */
export interface AssetStore {
  /** Load every entry in parallel; resolves with the composed resources keyed
   *  by manifest key. `onProgress` fires as each one completes. The raw
   *  image/JSON also merges into the by-name cache, so `load` can be called in
   *  stages and `image`/`json` still work. */
  load<M extends AssetManifest>(manifest: M, onProgress?: ProgressFn): Promise<Loaded<M>>;
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

/** Create a standalone cache when no app lifecycle should own it. */
export function createAssetStore(): AssetStore {
  const cache = new Map<string, unknown>();
  // Aggregate progress across concurrent/staged loads: reset once everything
  // in flight has settled, so `progress` reads 1 and `loading` reads false.
  let pending = 0;
  let completed = 0;

  const store: AssetStore = {
    async load<M extends AssetManifest>(manifest: M, onProgress?: ProgressFn) {
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
            const { raw, cached } = await loadSpec(manifest[name]);
            cache.set(name, cached);
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
      return result as Loaded<M>;
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
