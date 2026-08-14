import type { DrawSprite, Rect } from "../engine/index.js";
import type { PortalTransition } from "../portals/index.js";
import type { Vec2 } from "../math/vec2.js";
import type { AnyComponentInit, Ecs, Entity } from "../ecs/index.js";
import { type Level, type SkinValue, type TileSpec } from "../tiles/index.js";
export interface LDtkEntity {
    __identifier: string;
    __grid: [number, number];
    px: [number, number];
    width: number;
    height: number;
    fieldInstances?: Array<{
        __identifier: string;
        __value: unknown;
    }>;
}
export interface LDtkProjectJson {
    defaultGridSize?: number;
    defs?: {
        entities?: readonly {
            identifier: string;
            tags?: readonly string[];
        }[];
        tilesets?: readonly {
            identifier: string;
            uid: number;
            tileGridSize: number;
            pxWid: number;
            pxHei: number;
            relPath?: string | null;
        }[];
    };
    levels: readonly LDtkLevelJson[];
    worlds?: readonly {
        levels: readonly LDtkLevelJson[];
    }[];
}
export interface LDtkLevelJson {
    identifier: string;
    iid?: string;
    pxWid?: number;
    pxHei?: number;
    fieldInstances?: readonly {
        __identifier: string;
        __value: unknown;
    }[];
    layerInstances?: readonly LDtkLayerJson[] | null;
}
export interface LDtkLayerJson {
    __identifier: string;
    __type: string;
    __gridSize: number;
    __cWid: number;
    __cHei: number;
    __pxTotalOffsetX?: number;
    __pxTotalOffsetY?: number;
    __opacity?: number;
    __tilesetDefUid?: number | null;
    visible?: boolean;
    intGridCsv?: number[];
    entityInstances?: readonly LDtkEntity[];
    gridTiles?: readonly LDtkTileInstance[];
    autoLayerTiles?: readonly LDtkTileInstance[];
}
export interface LDtkTileInstance {
    px: readonly [number, number];
    src: readonly [number, number];
    /** Bit 0 flips X; bit 1 flips Y. */
    f: number;
    /** Per-tile opacity. */
    a?: number;
}
/** A fully painted LDtk Tile/AutoLayer. Its visual cells already live in the
 * LDtk file, so `Draw.tiles(layer)` needs no separate skin. */
export interface LDtkTileLayer {
    readonly skinless: true;
    readonly rect: Rect;
    render(ctx: CanvasRenderingContext2D): void;
}
export interface LDtkGridOptions<L extends Record<number, string> = Record<never, never>, E extends Record<string, string> = Record<never, never>> {
    level: string;
    layer: string;
    /** IntGrid value → level glyph. Zero is empty. */
    values?: L;
    legend?: Record<(L[keyof L] | E[keyof E]) & string, TileSpec>;
    /** Rectangular entity identifier → semantic level glyph. Entity bounds fill
     * grid cells; a legend `span` instead places one multi-cell anchor. */
    entities?: E;
    /** Point entity identifier → spawn-marker glyph (not part of the skin). */
    markers?: Record<string, string>;
}
export interface LDtkEntityData<T extends string = string, A extends string = string, F extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> extends Rect {
    id: string;
    type: T;
    level: A;
    grid: readonly [number, number];
    fields: F;
}
export interface LDtkEntitiesOptions<T extends string = string> {
    level: string;
    /** Entity identifier. Omit to read every entity in the level. */
    type?: T;
}
export interface LDtkTilesOptions {
    level: string;
    layer: string;
    /** Image belonging to the layer's `__tilesetDefUid`. */
    image: CanvasImageSource;
}
export interface LDtkWorldOptions {
    /** Semantic entity/IntGrid layer. Default `"World"`. */
    collision?: string;
    /** Painted Tile/AutoLayer. Default `"Art"`. */
    art?: string;
    /** Tileset image used by the painted layer. */
    image: CanvasImageSource;
    /** Portal entity identifier. Default `"Portal"`. */
    portal?: string;
    /** Destination EntityRef field. Default `"To"`. */
    toField?: string;
    /** Built-in transition field. Default `"Transition"`. */
    transitionField?: string;
    /** Transition duration field in milliseconds. Default `"TransitionMs"`. */
    transitionMsField?: string;
    /** Legacy destination-area field. Default `"Area"`. */
    areaField?: string;
    /** Legacy destination-marker field. Default `"Spawn"`. */
    spawnField?: string;
    /** Entity-definition tag for authored sprites. Default `"mm:sprite"`. */
    spriteTag?: string;
    /** Image-map key field on authored sprites. Default `"Asset"`. */
    assetField?: string;
}
export interface LDtkWorldPortal<A extends string> extends Rect {
    id: string;
    to: {
        area: A;
        spawn: string;
        anchor?: "center" | "feet";
    };
    transition?: PortalTransition;
    transitionMs?: number;
}
export type LDtkPrefabResult = AnyComponentInit | readonly AnyComponentInit[] | null | undefined | false;
export type LDtkFieldMap<T extends string> = Record<T, Readonly<Record<string, unknown>>>;
export type LDtkLevelFields = object;
export type LDtkPrefabs<T extends string, A extends string, F extends LDtkFieldMap<T>> = Partial<{
    [K in T]: (entity: LDtkEntityData<K, A, F[K]>) => LDtkPrefabResult;
}>;
/** Asset map accepted by `LDtkWorld.sprites`. Values may be images directly
 * or loaded sheet assets exposing their source as `.image`. */
export type LDtkSpriteImages<K extends string = string> = Readonly<Record<K, unknown>>;
type LDtkAssetKeys<T extends string, F extends LDtkFieldMap<T>> = {
    [K in T]: F[K] extends {
        readonly Asset: infer Asset extends string;
    } ? Asset : never;
}[T];
export interface LDtkPointData<T extends string, A extends string> extends Vec2 {
    id: string;
    type: T;
    area: A;
}
/** Cached gameplay view of a whole LDtk project. */
export interface LDtkWorld<A extends string = string, T extends string = string, F extends LDtkFieldMap<T> = LDtkFieldMap<T>, LF extends LDtkLevelFields = LDtkLevelFields> {
    readonly areas: readonly A[];
    readonly first: A;
    level(area: A): Level<string>;
    /** Typed custom fields authored on the LDtk level. */
    fields(area: A): LF;
    tiles(area: A): LDtkTileLayer;
    entities<K extends T = T>(type?: K): LDtkEntityData<K, A, F[K]>[];
    /** Entity centers with stable LDtk IIDs, ready for pickups, waypoints, and
     * spawn lists without game-side mapping/index IDs. */
    points<K extends T = T>(type?: K): LDtkPointData<K, A>[];
    /** Turn `mm:sprite` entities into a cached draw list using their `Asset`
     * field as an image-map key. Positions and sizes remain authored in LDtk. */
    sprites(area: A, images: LDtkSpriteImages<LDtkAssetKeys<T, F>>): readonly DrawSprite[];
    /** Instantiate authored entities into an ECS through tiny typed prefab
     * callbacks. Unmapped LDtk entities stay data-only. */
    spawn(ecs: Ecs, prefabs: LDtkPrefabs<T, A, F>, area?: A): Entity[];
    portals(area: A): readonly LDtkWorldPortal<A>[];
    resolve(destination: {
        area: A;
        spawn: string;
    }): Vec2;
}
type LDtkEntityDefinition<P> = P extends {
    defs?: {
        entities?: readonly (infer E)[];
    };
} ? E : never;
type LDtkKnownEntityType<P> = LDtkEntityDefinition<P> extends {
    identifier: infer I extends string;
} ? I : never;
/** Union of every entity identifier in a literal/generated LDtk project type.
 * Falls back to `string` for runtime-loaded untyped JSON. */
export type LDtkEntityType<P> = [LDtkKnownEntityType<P>] extends [never] ? string : LDtkKnownEntityType<P>;
type LDtkDefinitionWithTag<P, T extends string> = LDtkEntityDefinition<P> extends infer E ? E extends {
    tags?: readonly (infer Tag extends string)[];
} ? T extends Tag ? E : never : never : never;
type LDtkDefinitionWithPrefix<P, T extends string> = LDtkEntityDefinition<P> extends infer E ? E extends {
    tags?: readonly (infer Tag extends string)[];
} ? Extract<Tag, `${T}${string}`> extends never ? never : E : never : never;
type LDtkDefinitionIdentifier<D> = D extends {
    identifier: infer I extends string;
} ? I : never;
/** Entity identifiers that produce renderable/collidable level cells through
 * Minimotor's `mm:` behavior tags. */
export type LDtkTileType<P> = LDtkDefinitionIdentifier<LDtkDefinitionWithTag<P, "mm:solid"> | LDtkDefinitionWithTag<P, "mm:one-way"> | LDtkDefinitionWithTag<P, "mm:ladder"> | LDtkDefinitionWithPrefix<P, "mm:slope:">>;
/** Entity identifiers tagged `mm:marker`. */
export type LDtkMarkerType<P> = LDtkDefinitionIdentifier<LDtkDefinitionWithTag<P, "mm:marker">>;
/** Complete visual skin for the semantic cells inferred from an LDtk project. */
export type LDtkSkin<P> = Record<LDtkTileType<P>, SkinValue>;
/** Entity identifiers declared by an LDtk project. Literal/generated project
 * types preserve the returned string union; fetched JSON safely falls back to
 * `string[]`. */
declare function ldtkEntityTypes<const P>(source: P): LDtkEntityType<P>[];
/** Define and runtime-check the visual skin for every semantic `mm:` entity.
 * With a literal/generated project type, missing keys are also a compile
 * error. Runtime-loaded JSON still gets the same completeness check. */
declare function ldtkSkin<const P, const V extends Record<string, SkinValue>>(source: P, values: V & LDtkSkin<P>): V;
/** Read an authored LDtk Tile/AutoLayer. Unlike a semantic collision grid,
 * this layer already contains source pixels, placement, ordering, opacity,
 * and flip bits, so it renders directly with `Draw.tiles(layer)`. */
declare function ldtkTiles(source: unknown, options: LDtkTilesOptions): LDtkTileLayer;
/** Load every LDtk level once as one small gameplay-facing world. Convention
 * defaults keep common projects to `LDtk.world(project, { image })`.
 * `mm:portal` entities may point directly to each other with a `To` EntityRef. */
declare function ldtkWorld<A extends string = string, T extends string = string, F extends LDtkFieldMap<T> = LDtkFieldMap<T>, LF extends LDtkLevelFields = LDtkLevelFields>(source: unknown, options: LDtkWorldOptions): LDtkWorld<A, T, F, LF>;
/** Turn an LDtk IntGrid/entity layer into a semantic level. Entity definitions
 * tagged `mm:solid`, `mm:one-way`, `mm:ladder`, `mm:slope:*`, or `mm:marker`
 * are inferred automatically; their LDtk identifier becomes the level key.
 * No generated TypeScript is required. */
declare function ldtkGrid<L extends Record<number, string>, E extends Record<string, string>>(source: unknown, options: LDtkGridOptions<L, E> & {
    legend: Record<(L[keyof L] | E[keyof E]) & string, TileSpec>;
}): Level<(L[keyof L] | E[keyof E]) & string>;
declare function ldtkGrid(source: unknown, options: LDtkGridOptions): Level<string>;
/** Read authored LDtk entities as plain world-space rectangles. Custom fields
 * become a named record, which is convenient for doors, portals, enemies, and
 * scripted triggers. */
declare function ldtkEntities<const P, const T extends LDtkEntityType<P> = LDtkEntityType<P>>(source: P, options: LDtkEntitiesOptions<T>): LDtkEntityData<T>[];
export declare const grid: typeof ldtkGrid;
export declare const tiles: typeof ldtkTiles;
export declare const world: typeof ldtkWorld;
export declare const entities: typeof ldtkEntities;
export declare const entityTypes: typeof ldtkEntityTypes;
export declare const skin: typeof ldtkSkin;
export type { LDtkEntitiesOptions as EntitiesOptions, LDtkEntity as Entity, LDtkEntityData as EntityData, LDtkEntityType as EntityType, LDtkFieldMap as FieldMap, LDtkGridOptions as GridOptions, LDtkLayerJson as LayerJson, LDtkLevelFields as LevelFields, LDtkLevelJson as LevelJson, LDtkMarkerType as MarkerType, LDtkPointData as PointData, LDtkPrefabResult as PrefabResult, LDtkPrefabs as Prefabs, LDtkProjectJson as ProjectJson, LDtkSkin as Skin, LDtkSpriteImages as SpriteImages, LDtkTileInstance as TileInstance, LDtkTileLayer as TileLayer, LDtkTilesOptions as TilesOptions, LDtkTileType as TileType, LDtkWorld as World, LDtkWorldOptions as WorldOptions, LDtkWorldPortal as WorldPortal, };
