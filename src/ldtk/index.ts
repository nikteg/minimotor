// ---------- LDtk ----------
// Editor-format parsing stays here; returned levels and tile layers implement
// the generic Collision/Draw contracts from Tiles.

import type { DrawSprite, Rect } from "../engine/index.js";
import { blitPixelAligned } from "../engine/pixel-raster.js";
import type { PortalTransition } from "../portals.js";
import type { Vec2 } from "../vec2.js";
import type { AnyComponentInit, Ecs, Entity } from "../ecs/index.js";
import { grid as tileGrid, type Level, type SkinValue, type TileSpec } from "../tiles/index.js";

const EMPTY = ".";

function assertImportGlyphs(values: Record<number, string>, source: string): void {
  for (const glyph of Object.values(values)) {
    if (glyph.length !== 1 || glyph === EMPTY || glyph === " ") {
      throw new Error(`${source}: imported grid glyphs must be one non-empty character`);
    }
  }
}

export interface LDtkEntity {
  __identifier: string;
  __grid: [number, number];
  px: [number, number];
  width: number;
  height: number;
  fieldInstances?: Array<{ __identifier: string; __value: unknown }>;
}

export interface LDtkProjectJson {
  defaultGridSize?: number;
  defs?: {
    entities?: readonly { identifier: string; tags?: readonly string[] }[];
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
  worlds?: readonly { levels: readonly LDtkLevelJson[] }[];
}

export interface LDtkLevelJson {
  identifier: string;
  iid?: string;
  pxWid?: number;
  pxHei?: number;
  fieldInstances?: readonly { __identifier: string; __value: unknown }[];
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

export interface LDtkGridOptions<
  L extends Record<number, string> = Record<never, never>,
  E extends Record<string, string> = Record<never, never>,
> {
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

export interface LDtkEntityData<
  T extends string = string,
  A extends string = string,
  F extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> extends Rect {
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
  to: { area: A; spawn: string; anchor?: "center" | "feet" };
  transition?: PortalTransition;
  transitionMs?: number;
}

export type LDtkPrefabResult =
  | AnyComponentInit
  | readonly AnyComponentInit[]
  | null
  | undefined
  | false;

export type LDtkFieldMap<T extends string> = Record<T, Readonly<Record<string, unknown>>>;
export type LDtkLevelFields = object;

export type LDtkPrefabs<T extends string, A extends string, F extends LDtkFieldMap<T>> = Partial<{
  [K in T]: (entity: LDtkEntityData<K, A, F[K]>) => LDtkPrefabResult;
}>;

/** Asset map accepted by `LDtkWorld.sprites`. Values may be images directly
 * or loaded sheet assets exposing their source as `.image`. */
export type LDtkSpriteImages<K extends string = string> = Readonly<Record<K, unknown>>;

type LDtkAssetKeys<T extends string, F extends LDtkFieldMap<T>> = {
  [K in T]: F[K] extends { readonly Asset: infer Asset extends string } ? Asset : never;
}[T];

export interface LDtkPointData<T extends string, A extends string> extends Vec2 {
  id: string;
  type: T;
  area: A;
}

/** Cached gameplay view of a whole LDtk project. */
export interface LDtkWorld<
  A extends string = string,
  T extends string = string,
  F extends LDtkFieldMap<T> = LDtkFieldMap<T>,
  LF extends LDtkLevelFields = LDtkLevelFields,
> {
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
  resolve(destination: { area: A; spawn: string }): Vec2;
}

type LDtkEntityDefinition<P> = P extends {
  defs?: { entities?: readonly (infer E)[] };
}
  ? E
  : never;

type LDtkKnownEntityType<P> =
  LDtkEntityDefinition<P> extends { identifier: infer I extends string } ? I : never;

/** Union of every entity identifier in a literal/generated LDtk project type.
 * Falls back to `string` for runtime-loaded untyped JSON. */
export type LDtkEntityType<P> = [LDtkKnownEntityType<P>] extends [never]
  ? string
  : LDtkKnownEntityType<P>;

type LDtkDefinitionWithTag<P, T extends string> =
  LDtkEntityDefinition<P> extends infer E
    ? E extends { tags?: readonly (infer Tag extends string)[] }
      ? T extends Tag
        ? E
        : never
      : never
    : never;

type LDtkDefinitionWithPrefix<P, T extends string> =
  LDtkEntityDefinition<P> extends infer E
    ? E extends { tags?: readonly (infer Tag extends string)[] }
      ? Extract<Tag, `${T}${string}`> extends never
        ? never
        : E
      : never
    : never;

type LDtkDefinitionIdentifier<D> = D extends { identifier: infer I extends string } ? I : never;

/** Entity identifiers that produce renderable/collidable level cells through
 * Minimotor's `mm:` behavior tags. */
export type LDtkTileType<P> = LDtkDefinitionIdentifier<
  | LDtkDefinitionWithTag<P, "mm:solid">
  | LDtkDefinitionWithTag<P, "mm:one-way">
  | LDtkDefinitionWithTag<P, "mm:ladder">
  | LDtkDefinitionWithPrefix<P, "mm:slope:">
>;

/** Entity identifiers tagged `mm:marker`. */
export type LDtkMarkerType<P> = LDtkDefinitionIdentifier<LDtkDefinitionWithTag<P, "mm:marker">>;

/** Complete visual skin for the semantic cells inferred from an LDtk project. */
export type LDtkSkin<P> = Record<LDtkTileType<P>, SkinValue>;

function ldtkTagMap(project: LDtkProjectJson): {
  legend: Record<string, TileSpec>;
  entities: Record<string, string>;
  markers: Record<string, string>;
} {
  const legend: Record<string, TileSpec> = {};
  const entities: Record<string, string> = {};
  const markers: Record<string, string> = {};
  for (const definition of project.defs?.entities ?? []) {
    const tags = definition.tags ?? [];
    const value = (prefix: string) =>
      tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
    if (tags.includes("mm:marker")) {
      markers[definition.identifier] = definition.identifier;
      continue;
    }
    const slope = value("mm:slope:");
    const span = value("mm:span:")?.split("x").map(Number);
    const semantic =
      tags.includes("mm:solid") ||
      tags.includes("mm:one-way") ||
      tags.includes("mm:ladder") ||
      slope === "up-right" ||
      slope === "up-left";
    if (!semantic) continue;
    legend[definition.identifier] = {
      ...(tags.includes("mm:solid") ? { solid: true } : {}),
      ...(tags.includes("mm:one-way") ? { solid: true, oneWay: true } : {}),
      ...(tags.includes("mm:ladder") ? { ladder: true } : {}),
      ...(slope === "up-right" || slope === "up-left" ? { slope } : {}),
      ...(span?.length === 2 &&
      Number.isInteger(span[0]) &&
      Number.isInteger(span[1]) &&
      span[0] > 0 &&
      span[1] > 0
        ? { span: [span[0], span[1]] as const }
        : {}),
    };
    entities[definition.identifier] = definition.identifier;
  }
  return { legend, entities, markers };
}

/** Entity identifiers declared by an LDtk project. Literal/generated project
 * types preserve the returned string union; fetched JSON safely falls back to
 * `string[]`. */
function ldtkEntityTypes<const P>(source: P): LDtkEntityType<P>[] {
  const project = source as LDtkProjectJson;
  if (!project?.defs) {
    throw new Error("LDtk.entityTypes: expected parsed LDtk project JSON");
  }
  return (project.defs.entities ?? []).map(
    (definition) => definition.identifier as LDtkEntityType<P>,
  );
}

/** Define and runtime-check the visual skin for every semantic `mm:` entity.
 * With a literal/generated project type, missing keys are also a compile
 * error. Runtime-loaded JSON still gets the same completeness check. */
function ldtkSkin<const P, const V extends Record<string, SkinValue>>(
  source: P,
  values: V & LDtkSkin<P>,
): V {
  const project = source as LDtkProjectJson;
  if (!project || !Array.isArray(project.levels)) {
    throw new Error("LDtk.skin: expected parsed LDtk project JSON");
  }
  const required = Object.keys(ldtkTagMap(project).legend);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(values, key));
  if (missing.length > 0) {
    throw new Error(`LDtk.skin: missing ${missing.map((key) => `"${key}"`).join(", ")}`);
  }
  return values;
}

/** Read an authored LDtk Tile/AutoLayer. Unlike a semantic collision grid,
 * this layer already contains source pixels, placement, ordering, opacity,
 * and flip bits, so it renders directly with `Draw.tiles(layer)`. */
function ldtkTiles(source: unknown, options: LDtkTilesOptions): LDtkTileLayer {
  const project = source as LDtkProjectJson;
  if (!project || !Array.isArray(project.levels)) {
    throw new Error("LDtk.tiles: expected parsed LDtk project JSON");
  }
  const levels: LDtkLevelJson[] = [
    ...project.levels,
    ...(project.worlds ?? []).flatMap((world) => world.levels),
  ];
  const level = levels.find(
    (entry) => entry.identifier === options.level || entry.iid === options.level,
  );
  if (!level) throw new Error(`LDtk.tiles: no level named "${options.level}"`);
  const layer = (level.layerInstances ?? []).find((entry) => entry.__identifier === options.layer);
  if (!layer) throw new Error(`LDtk.tiles: no layer named "${options.layer}"`);
  const tiles = [...(layer.autoLayerTiles ?? []), ...(layer.gridTiles ?? [])];
  const sourceSize =
    project.defs?.tilesets?.find((tileset) => tileset.uid === layer.__tilesetDefUid)
      ?.tileGridSize ?? layer.__gridSize;
  const offsetX = layer.__pxTotalOffsetX ?? 0;
  const offsetY = layer.__pxTotalOffsetY ?? 0;
  const rect = {
    x: offsetX,
    y: offsetY,
    w: level.pxWid ?? layer.__cWid * layer.__gridSize,
    h: level.pxHei ?? layer.__cHei * layer.__gridSize,
  };

  return {
    skinless: true,
    rect,
    render(ctx) {
      if (layer.visible === false) return;
      const previousSmoothing = ctx.imageSmoothingEnabled;
      const previousAlpha = ctx.globalAlpha;
      ctx.imageSmoothingEnabled = false;
      try {
        for (const tile of tiles) {
          const x = tile.px[0] + offsetX;
          const y = tile.px[1] + offsetY;
          const size = layer.__gridSize;
          const flipX = (tile.f & 1) !== 0;
          const flipY = (tile.f & 2) !== 0;
          ctx.globalAlpha = previousAlpha * (layer.__opacity ?? 1) * (tile.a ?? 1);
          if (!flipX && !flipY) {
            blitPixelAligned(
              ctx,
              options.image,
              tile.src[0],
              tile.src[1],
              sourceSize,
              sourceSize,
              x,
              y,
              size,
              size,
            );
            continue;
          }
          ctx.save();
          ctx.translate(x + (flipX ? size : 0), y + (flipY ? size : 0));
          ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          blitPixelAligned(
            ctx,
            options.image,
            tile.src[0],
            tile.src[1],
            sourceSize,
            sourceSize,
            0,
            0,
            size,
            size,
          );
          ctx.restore();
        }
      } finally {
        ctx.globalAlpha = previousAlpha;
        ctx.imageSmoothingEnabled = previousSmoothing;
      }
    },
  };
}

/** Load every LDtk level once as one small gameplay-facing world. Convention
 * defaults keep common projects to `LDtk.world(project, { image })`.
 * `mm:portal` entities may point directly to each other with a `To` EntityRef. */
function ldtkWorld<
  A extends string = string,
  T extends string = string,
  F extends LDtkFieldMap<T> = LDtkFieldMap<T>,
  LF extends LDtkLevelFields = LDtkLevelFields,
>(source: unknown, options: LDtkWorldOptions): LDtkWorld<A, T, F, LF> {
  const project = source as LDtkProjectJson;
  if (!project || !Array.isArray(project.levels)) {
    throw new Error("LDtk.world: expected parsed LDtk project JSON");
  }
  const sourceLevels: LDtkLevelJson[] = [
    ...project.levels,
    ...(project.worlds ?? []).flatMap((world) => world.levels),
  ];
  if (sourceLevels.length === 0) throw new Error("LDtk.world: project has no levels");
  const areas = sourceLevels.map((level) => level.identifier as A);
  const known = new Set<string>(areas);
  const collisionLayer = options.collision ?? "World";
  const artLayer = options.art ?? "Art";
  const portalType =
    options.portal ??
    project.defs?.entities?.find((definition) => definition.tags?.includes("mm:portal"))
      ?.identifier ??
    "Portal";
  const toField = options.toField ?? "To";
  const transitionField = options.transitionField ?? "Transition";
  const transitionMsField = options.transitionMsField ?? "TransitionMs";
  const areaField = options.areaField ?? "Area";
  const spawnField = options.spawnField ?? "Spawn";
  const spriteTag = options.spriteTag ?? "mm:sprite";
  const assetField = options.assetField ?? "Asset";
  const levels = new Map<A, Level<string>>();
  const levelFields = new Map<A, LF>();
  const art = new Map<A, LDtkTileLayer>();
  const portals = new Map<A, LDtkWorldPortal<A>[]>();
  const allEntities: LDtkEntityData[] = [];
  const spriteTypes = new Set(
    (project.defs?.entities ?? [])
      .filter((definition) => definition.tags?.includes(spriteTag))
      .map((definition) => definition.identifier),
  );
  const spriteCache = new WeakMap<object, Map<A, readonly DrawSprite[]>>();

  for (const area of areas) {
    const sourceLevel = sourceLevels.find((entry) => entry.identifier === area)!;
    levelFields.set(
      area,
      Object.fromEntries(
        (sourceLevel.fieldInstances ?? []).map((field) => [field.__identifier, field.__value]),
      ) as LF,
    );
    levels.set(area, ldtkGrid(source, { level: area, layer: collisionLayer }));
    art.set(
      area,
      ldtkTiles(source, {
        level: area,
        layer: artLayer,
        image: options.image,
      }),
    );
    const entities = ldtkEntities(source, { level: area });
    allEntities.push(...entities);
  }

  const byId = new Map(allEntities.map((entity) => [entity.id, entity]));
  const transition = (entity: LDtkEntityData): LDtkWorldPortal<A>["transition"] | undefined => {
    const raw = entity.fields[transitionField];
    if (raw === undefined || raw === null || raw === "") return undefined;
    const key = String(raw)
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();
    if (
      key === "none" ||
      key === "fade" ||
      key === "wipe-left" ||
      key === "wipe-right" ||
      key === "wipe-up" ||
      key === "wipe-down"
    ) {
      return key;
    }
    throw new Error(
      `LDtk.world: portal "${entity.id}" has invalid ${transitionField} "${String(raw)}"`,
    );
  };

  for (const area of areas) {
    const entities = allEntities.filter((entity) => entity.level === area);
    portals.set(
      area,
      entities
        .filter((entity) => entity.type === portalType)
        .map((entity) => {
          const reference = entity.fields[toField] as
            | { entityIid?: unknown; levelIid?: unknown }
            | null
            | undefined;
          const target =
            reference && typeof reference.entityIid === "string"
              ? byId.get(reference.entityIid)
              : undefined;
          const destination = target?.level ?? entity.fields[areaField];
          const spawn = target?.id ?? entity.fields[spawnField];
          if (typeof destination !== "string" || !known.has(destination)) {
            throw new Error(`LDtk.world: portal "${entity.id}" needs a valid ${toField} EntityRef`);
          }
          if (typeof spawn !== "string") {
            throw new Error(`LDtk.world: portal "${entity.id}" needs a valid ${toField} EntityRef`);
          }
          const rawMs = entity.fields[transitionMsField];
          const transitionMs =
            typeof rawMs === "number" && Number.isFinite(rawMs) && rawMs >= 0 ? rawMs : undefined;
          return {
            id: entity.id,
            x: entity.x,
            y: entity.y,
            w: entity.w,
            h: entity.h,
            to: {
              area: destination as A,
              spawn,
              ...(target ? { anchor: "feet" as const } : {}),
            },
            transition: transition(entity),
            transitionMs,
          };
        }),
    );
  }

  const get = <T>(map: Map<A, T>, area: A, kind: string): T => {
    const value = map.get(area);
    if (!value) throw new Error(`LDtk.world: no ${kind} for area "${area}"`);
    return value;
  };

  return {
    areas,
    first: areas[0],
    level: (area) => get(levels, area, "level"),
    fields: (area) => get(levelFields, area, "level fields"),
    tiles: (area) => get(art, area, "tile layer"),
    entities: <K extends T = T>(type?: K) =>
      (type
        ? allEntities.filter((entity) => entity.type === type)
        : [...allEntities]) as LDtkEntityData<K, A, F[K]>[],
    points: <K extends T = T>(type?: K) =>
      (type ? allEntities.filter((entity) => entity.type === type) : allEntities).map((entity) => ({
        id: entity.id,
        type: entity.type as K,
        area: entity.level as A,
        x: entity.x + entity.w / 2,
        y: entity.y + entity.h / 2,
      })),
    sprites(area, images) {
      let byArea = spriteCache.get(images);
      if (!byArea) {
        byArea = new Map();
        spriteCache.set(images, byArea);
      }
      const cached = byArea.get(area);
      if (cached) return cached;
      const sprites = allEntities
        .filter((entity) => entity.level === area && spriteTypes.has(entity.type))
        .map((entity): DrawSprite => {
          const asset = entity.fields[assetField];
          if (typeof asset !== "string") {
            throw new Error(`LDtk.world: sprite "${entity.id}" needs a string ${assetField} field`);
          }
          const source = (images as Readonly<Record<string, unknown>>)[asset];
          const img =
            source && typeof source === "object" && "image" in source && source.image
              ? source.image
              : source;
          if (!img || typeof img !== "object" || !("width" in img) || !("height" in img)) {
            throw new Error(
              `LDtk.world: sprite "${entity.id}" references missing image "${asset}"`,
            );
          }
          const z = entity.fields.Z;
          return {
            x: entity.x,
            y: entity.y,
            w: entity.w,
            h: entity.h,
            img: img as DrawSprite["img"],
            ax: 0,
            ay: 0,
            ...(typeof z === "number" ? { z } : {}),
          };
        });
      byArea.set(area, sprites);
      return sprites;
    },
    spawn(ecs, prefabs, area) {
      const spawned: Entity[] = [];
      for (const entity of allEntities) {
        if (area !== undefined && entity.level !== area) continue;
        const prefab = prefabs[entity.type as T] as
          | ((value: LDtkEntityData<T, A, F[T]>) => LDtkPrefabResult)
          | undefined;
        const result = prefab?.(entity as LDtkEntityData<T, A, F[T]>);
        if (!result) continue;
        spawned.push(ecs.spawn(...(Array.isArray(result) ? result : [result])));
      }
      return spawned;
    },
    portals: (area) => get(portals, area, "portals"),
    resolve(destination) {
      const entity = byId.get(destination.spawn);
      if (entity && entity.level === destination.area) {
        return { x: entity.x + entity.w / 2, y: entity.y + entity.h };
      }
      return get(levels, destination.area, "level").spawnOne(destination.spawn);
    },
  };
}

/** Turn an LDtk IntGrid/entity layer into a semantic level. Entity definitions
 * tagged `mm:solid`, `mm:one-way`, `mm:ladder`, `mm:slope:*`, or `mm:marker`
 * are inferred automatically; their LDtk identifier becomes the level key.
 * No generated TypeScript is required. */
function ldtkGrid<L extends Record<number, string>, E extends Record<string, string>>(
  source: unknown,
  options: LDtkGridOptions<L, E> & {
    legend: Record<(L[keyof L] | E[keyof E]) & string, TileSpec>;
  },
): Level<(L[keyof L] | E[keyof E]) & string>;
function ldtkGrid(source: unknown, options: LDtkGridOptions): Level<string>;
function ldtkGrid<L extends Record<number, string>, E extends Record<string, string>>(
  source: unknown,
  options: LDtkGridOptions<L, E>,
): Level<string> {
  const project = source as LDtkProjectJson;
  if (!project || !Array.isArray(project.levels)) {
    throw new Error("LDtk.grid: expected parsed LDtk project JSON");
  }
  const tagged = ldtkTagMap(project);
  const values = (options.values ?? {}) as Record<number, string>;
  const legend = {
    ...tagged.legend,
    ...options.legend,
  } as Record<string, TileSpec>;
  const entityKinds = { ...tagged.entities, ...options.entities };
  const markerKinds = { ...tagged.markers, ...options.markers };
  assertImportGlyphs(values, "LDtk.grid");
  const levels: LDtkLevelJson[] = [
    ...project.levels,
    ...(project.worlds ?? []).flatMap((world) => world.levels),
  ];
  const sourceLevel = levels.find(
    (entry) => entry.identifier === options.level || entry.iid === options.level,
  );
  if (!sourceLevel) throw new Error(`LDtk.grid: no level named "${options.level}"`);
  const layers = sourceLevel.layerInstances ?? [];
  const layer = layers.find((entry) => entry.__identifier === options.layer);
  if (!layer) throw new Error(`LDtk.grid: no layer named "${options.layer}"`);
  const cells = Array.from({ length: layer.__cHei }, (_, cy) =>
    Array.from(
      { length: layer.__cWid },
      (_, cx) => values[layer.intGridCsv?.[cy * layer.__cWid + cx] ?? 0] ?? EMPTY,
    ),
  );
  for (const entityLayer of layers) {
    for (const entity of entityLayer.entityInstances ?? []) {
      const semanticKey = entityKinds[entity.__identifier];
      const key = semanticKey ?? markerKinds[entity.__identifier];
      if (key === undefined) continue;
      const cx = Math.floor(
        (entity.px[0] + (entityLayer.__pxTotalOffsetX ?? 0)) / layer.__gridSize,
      );
      const cy = Math.floor(
        (entity.px[1] + (entityLayer.__pxTotalOffsetY ?? 0)) / layer.__gridSize,
      );
      const spec = legend[key];
      const fillCols =
        semanticKey === undefined || spec?.span
          ? 1
          : Math.max(1, Math.ceil(entity.width / layer.__gridSize));
      const fillRows =
        semanticKey === undefined || spec?.span
          ? 1
          : Math.max(1, Math.ceil(entity.height / layer.__gridSize));
      for (let oy = 0; oy < fillRows; oy++) {
        for (let ox = 0; ox < fillCols; ox++) {
          if (cells[cy + oy]?.[cx + ox] !== EMPTY) {
            throw new Error(
              `LDtk.grid: entity "${entity.__identifier}" overlaps collision at (${cx + ox}, ${cy + oy})`,
            );
          }
          cells[cy + oy][cx + ox] = key;
        }
      }
    }
  }
  return tileGrid(cells, {
    size: layer.__gridSize,
    legend,
  });
}

/** Read authored LDtk entities as plain world-space rectangles. Custom fields
 * become a named record, which is convenient for doors, portals, enemies, and
 * scripted triggers. */
function ldtkEntities<const P, const T extends LDtkEntityType<P> = LDtkEntityType<P>>(
  source: P,
  options: LDtkEntitiesOptions<T>,
): LDtkEntityData<T>[] {
  const project = source as LDtkProjectJson;
  if (!project || !Array.isArray(project.levels)) {
    throw new Error("LDtk.entities: expected parsed LDtk project JSON");
  }
  const levels: LDtkLevelJson[] = [
    ...project.levels,
    ...(project.worlds ?? []).flatMap((world) => world.levels),
  ];
  const level = levels.find(
    (entry) => entry.identifier === options.level || entry.iid === options.level,
  );
  if (!level) throw new Error(`LDtk.entities: no level named "${options.level}"`);
  const out: LDtkEntityData<T>[] = [];
  for (const layer of level.layerInstances ?? []) {
    for (const entity of layer.entityInstances ?? []) {
      if (options.type && entity.__identifier !== options.type) continue;
      out.push({
        id: (entity as LDtkEntity & { iid?: string }).iid ?? `${entity.__identifier}@${entity.px}`,
        type: entity.__identifier as T,
        level: level.identifier,
        grid: entity.__grid,
        x: entity.px[0] + (layer.__pxTotalOffsetX ?? 0),
        y: entity.px[1] + (layer.__pxTotalOffsetY ?? 0),
        w: entity.width,
        h: entity.height,
        fields: Object.fromEntries(
          (entity.fieldInstances ?? []).map((field) => [field.__identifier, field.__value]),
        ),
      });
    }
  }
  return out;
}

export const grid = ldtkGrid;
export const tiles = ldtkTiles;
export const world = ldtkWorld;
export const entities = ldtkEntities;
export const entityTypes = ldtkEntityTypes;
export const skin = ldtkSkin;

export type {
  LDtkEntitiesOptions as EntitiesOptions,
  LDtkEntity as Entity,
  LDtkEntityData as EntityData,
  LDtkEntityType as EntityType,
  LDtkFieldMap as FieldMap,
  LDtkGridOptions as GridOptions,
  LDtkLayerJson as LayerJson,
  LDtkLevelFields as LevelFields,
  LDtkLevelJson as LevelJson,
  LDtkMarkerType as MarkerType,
  LDtkPointData as PointData,
  LDtkPrefabResult as PrefabResult,
  LDtkPrefabs as Prefabs,
  LDtkProjectJson as ProjectJson,
  LDtkSkin as Skin,
  LDtkSpriteImages as SpriteImages,
  LDtkTileInstance as TileInstance,
  LDtkTileLayer as TileLayer,
  LDtkTilesOptions as TilesOptions,
  LDtkTileType as TileType,
  LDtkWorld as World,
  LDtkWorldOptions as WorldOptions,
  LDtkWorldPortal as WorldPortal,
};
