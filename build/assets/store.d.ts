import { type GridAnimationSource, type SheetOptions } from "../anim/index.js";
import { type Json as AsepriteJson, type Sheet as AsepriteSheet, type State as AsepriteState } from "../aseprite/index.js";
import { type SpriteCanvas } from "../sprites/raster.js";
import type { MeshData } from "../render3d/mesh.js";
/** A manifest entry: a plain URL, or a `{ src }` spec that composes the loaded
 *  image into a higher-level resource. Extensions decide the loader:
 *  .png/.jpg/.jpeg/.webp/.gif/.bmp → image; .json/.tmj/.tsj/.ldtk → parsed JSON;
 *  .obj → parsed 3D MeshData; .ogg/.mp3/.wav/.m4a → ArrayBuffer (decoded
 *  lazily by `Audio.music`/sfx). */
export type AssetSpec = string
/** Slice the loaded image into a named-state `Sheet` (Anim.fromGrid). */
 | {
    src: string;
    sheet: SheetOptions<string>;
}
/** Load an Aseprite-exported PNG plus JSON atlas. */
 | {
    src: string;
    aseprite: string | AsepriteJson;
}
/** Pre-render a solid-colour silhouette of the image (Sprites.tint). */
 | {
    src: string;
    tint: string;
}
/** An image with no composition — same as the bare URL, spelled explicitly. */
 | {
    src: string;
};
type AudioUrl = `${string}.${"ogg" | "mp3" | "wav" | "m4a"}`;
type ObjUrl = `${string}.obj`;
type JsonUrl = `${string}.${"json" | "tmj" | "tsj" | "ldtk" | "ldtkl"}`;
/** What a manifest entry loads as — the per-key typing behind
 *  `const art = await Assets.load({ hero: "hero.png" })`. */
export type LoadedAsset<S extends AssetSpec> = S extends {
    sheet: SheetOptions<string>;
} ? GridAnimationSource<S["sheet"]["states"] extends Record<infer K extends string, unknown> ? K : string> : S extends {
    aseprite: infer D;
} ? AsepriteSheet<AsepriteState<D>> : S extends {
    tint: string;
} ? SpriteCanvas : S extends ObjUrl | {
    src: ObjUrl;
} ? MeshData : S extends JsonUrl | {
    src: JsonUrl;
} ? unknown : S extends AudioUrl | {
    src: AudioUrl;
} ? ArrayBuffer : HTMLImageElement;
/** The typed record `load()` resolves with: keys from the manifest, value
 *  types from each spec. `art.herp` is a compile error. */
export type Loaded<M extends AssetManifest> = {
    [K in keyof M]: LoadedAsset<M[K]>;
};
/** name → spec. */
export type AssetManifest = Record<string, AssetSpec>;
/** Called after each asset resolves, with completed and total counts. */
export type ProgressFn = (loaded: number, total: number) => void;
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
export declare function createAssetStore(): AssetStore;
export {};
