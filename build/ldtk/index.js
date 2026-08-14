// ---------- LDtk ----------
// Editor-format parsing stays here; returned levels and tile layers implement
// the generic Collision/Draw contracts from Tiles.
import { blitPixelAligned } from "../engine/pixel-raster.js";
import { grid as tileGrid } from "../tiles/index.js";
import { LADDER } from "../tiles/presets.js";
import { EMPTY, isEmptyChar } from "../tiles/glyphs.js";
function assertImportGlyphs(values, source) {
    for (const glyph of Object.values(values)) {
        if (glyph.length !== 1 || isEmptyChar(glyph)) {
            throw new Error(`${source}: imported grid glyphs must be one non-empty character`);
        }
    }
}
function ldtkTagMap(project) {
    const legend = {};
    const entities = {};
    const markers = {};
    for (const definition of project.defs?.entities ?? []) {
        const tags = definition.tags ?? [];
        const value = (prefix) => tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
        if (tags.includes("mm:marker")) {
            markers[definition.identifier] = definition.identifier;
            continue;
        }
        const slope = value("mm:slope:");
        const span = value("mm:span:")?.split("x").map(Number);
        // Anything the geometry tags below do not claim becomes a region TAG
        // verbatim: `mm:ladder` → "ladder", `mm:ice` → "ice", `mm:your-idea` →
        // "your-idea". Naming a new region concept in LDtk therefore needs no
        // change here and none in `Tiles` — read it back with `level.rectsNear`.
        // Tags that already mean something specific. The first two are collision
        // geometry, handled just below; the rest name an entity's ROLE in the
        // project rather than a property of the space it covers, and must not
        // become legend entries — a `mm:portal` is read by `world.portals()`, and
        // turning it into a tile would stamp its glyph over the floor beneath it.
        const CLAIMED = new Set(["mm:solid", "mm:one-way", "mm:marker", "mm:sprite", "mm:portal"]);
        const regionTags = tags
            .filter((tag) => tag.startsWith("mm:") && !CLAIMED.has(tag) && !tag.includes(":", 3))
            .map((tag) => tag.slice(3));
        const semantic = tags.includes("mm:solid") ||
            tags.includes("mm:one-way") ||
            regionTags.length > 0 ||
            slope === "up-right" ||
            slope === "up-left";
        if (!semantic)
            continue;
        legend[definition.identifier] = {
            ...(tags.includes("mm:solid") ? { solid: true } : {}),
            ...(tags.includes("mm:one-way") ? { solid: true, oneWay: true } : {}),
            ...(regionTags.length > 0 ? { tags: regionTags } : {}),
            // A climbable run's exposed top has always doubled as a standing surface;
            // keep that, expressed through the generic mechanism.
            ...(regionTags.includes(LADDER) ? { standOnTop: true } : {}),
            ...(slope === "up-right" || slope === "up-left" ? { slope } : {}),
            ...(span?.length === 2 &&
                Number.isInteger(span[0]) &&
                Number.isInteger(span[1]) &&
                span[0] > 0 &&
                span[1] > 0
                ? { span: [span[0], span[1]] }
                : {}),
        };
        entities[definition.identifier] = definition.identifier;
    }
    return { legend, entities, markers };
}
/** Entity identifiers declared by an LDtk project. Literal/generated project
 * types preserve the returned string union; fetched JSON safely falls back to
 * `string[]`. */
function ldtkEntityTypes(source) {
    const project = source;
    if (!project?.defs) {
        throw new Error("LDtk.entityTypes: expected parsed LDtk project JSON");
    }
    return (project.defs.entities ?? []).map((definition) => definition.identifier);
}
/** Define and runtime-check the visual skin for every semantic `mm:` entity.
 * With a literal/generated project type, missing keys are also a compile
 * error. Runtime-loaded JSON still gets the same completeness check. */
function ldtkSkin(source, values) {
    const project = source;
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
function ldtkTiles(source, options) {
    const project = source;
    if (!project || !Array.isArray(project.levels)) {
        throw new Error("LDtk.tiles: expected parsed LDtk project JSON");
    }
    const levels = [
        ...project.levels,
        ...(project.worlds ?? []).flatMap((world) => world.levels),
    ];
    const level = levels.find((entry) => entry.identifier === options.level || entry.iid === options.level);
    if (!level)
        throw new Error(`LDtk.tiles: no level named "${options.level}"`);
    const layer = (level.layerInstances ?? []).find((entry) => entry.__identifier === options.layer);
    if (!layer)
        throw new Error(`LDtk.tiles: no layer named "${options.layer}"`);
    const tiles = [...(layer.autoLayerTiles ?? []), ...(layer.gridTiles ?? [])];
    const sourceSize = project.defs?.tilesets?.find((tileset) => tileset.uid === layer.__tilesetDefUid)
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
            if (layer.visible === false)
                return;
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
                        blitPixelAligned(ctx, options.image, tile.src[0], tile.src[1], sourceSize, sourceSize, x, y, size, size);
                        continue;
                    }
                    ctx.save();
                    ctx.translate(x + (flipX ? size : 0), y + (flipY ? size : 0));
                    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
                    blitPixelAligned(ctx, options.image, tile.src[0], tile.src[1], sourceSize, sourceSize, 0, 0, size, size);
                    ctx.restore();
                }
            }
            finally {
                ctx.globalAlpha = previousAlpha;
                ctx.imageSmoothingEnabled = previousSmoothing;
            }
        },
    };
}
/** Load every LDtk level once as one small gameplay-facing world. Convention
 * defaults keep common projects to `LDtk.world(project, { image })`.
 * `mm:portal` entities may point directly to each other with a `To` EntityRef. */
function ldtkWorld(source, options) {
    const project = source;
    if (!project || !Array.isArray(project.levels)) {
        throw new Error("LDtk.world: expected parsed LDtk project JSON");
    }
    const sourceLevels = [
        ...project.levels,
        ...(project.worlds ?? []).flatMap((world) => world.levels),
    ];
    if (sourceLevels.length === 0)
        throw new Error("LDtk.world: project has no levels");
    const areas = sourceLevels.map((level) => level.identifier);
    const known = new Set(areas);
    const collisionLayer = options.collision ?? "World";
    const artLayer = options.art ?? "Art";
    const portalType = options.portal ??
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
    const levels = new Map();
    const levelFields = new Map();
    const art = new Map();
    const portals = new Map();
    const allEntities = [];
    const spriteTypes = new Set((project.defs?.entities ?? [])
        .filter((definition) => definition.tags?.includes(spriteTag))
        .map((definition) => definition.identifier));
    const spriteCache = new WeakMap();
    for (const area of areas) {
        const sourceLevel = sourceLevels.find((entry) => entry.identifier === area);
        levelFields.set(area, Object.fromEntries((sourceLevel.fieldInstances ?? []).map((field) => [field.__identifier, field.__value])));
        levels.set(area, ldtkGrid(source, { level: area, layer: collisionLayer }));
        art.set(area, ldtkTiles(source, {
            level: area,
            layer: artLayer,
            image: options.image,
        }));
        const entities = ldtkEntities(source, { level: area });
        allEntities.push(...entities);
    }
    const byId = new Map(allEntities.map((entity) => [entity.id, entity]));
    const transition = (entity) => {
        const raw = entity.fields[transitionField];
        if (raw === undefined || raw === null || raw === "")
            return undefined;
        const key = String(raw)
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .replace(/[\s_]+/g, "-")
            .toLowerCase();
        if (key === "none" ||
            key === "fade" ||
            key === "wipe-left" ||
            key === "wipe-right" ||
            key === "wipe-up" ||
            key === "wipe-down") {
            return key;
        }
        throw new Error(`LDtk.world: portal "${entity.id}" has invalid ${transitionField} "${String(raw)}"`);
    };
    for (const area of areas) {
        const entities = allEntities.filter((entity) => entity.level === area);
        portals.set(area, entities
            .filter((entity) => entity.type === portalType)
            .map((entity) => {
            const reference = entity.fields[toField];
            const target = reference && typeof reference.entityIid === "string"
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
            const transitionMs = typeof rawMs === "number" && Number.isFinite(rawMs) && rawMs >= 0 ? rawMs : undefined;
            return {
                id: entity.id,
                x: entity.x,
                y: entity.y,
                w: entity.w,
                h: entity.h,
                to: {
                    area: destination,
                    spawn,
                    ...(target ? { anchor: "feet" } : {}),
                },
                transition: transition(entity),
                transitionMs,
            };
        }));
    }
    const get = (map, area, kind) => {
        const value = map.get(area);
        if (!value)
            throw new Error(`LDtk.world: no ${kind} for area "${area}"`);
        return value;
    };
    return {
        areas,
        first: areas[0],
        level: (area) => get(levels, area, "level"),
        fields: (area) => get(levelFields, area, "level fields"),
        tiles: (area) => get(art, area, "tile layer"),
        entities: (type) => (type
            ? allEntities.filter((entity) => entity.type === type)
            : [...allEntities]),
        points: (type) => (type ? allEntities.filter((entity) => entity.type === type) : allEntities).map((entity) => ({
            id: entity.id,
            type: entity.type,
            area: entity.level,
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
            if (cached)
                return cached;
            const sprites = allEntities
                .filter((entity) => entity.level === area && spriteTypes.has(entity.type))
                .map((entity) => {
                const asset = entity.fields[assetField];
                if (typeof asset !== "string") {
                    throw new Error(`LDtk.world: sprite "${entity.id}" needs a string ${assetField} field`);
                }
                const source = images[asset];
                const img = source && typeof source === "object" && "image" in source && source.image
                    ? source.image
                    : source;
                if (!img || typeof img !== "object" || !("width" in img) || !("height" in img)) {
                    throw new Error(`LDtk.world: sprite "${entity.id}" references missing image "${asset}"`);
                }
                const z = entity.fields.Z;
                return {
                    x: entity.x,
                    y: entity.y,
                    w: entity.w,
                    h: entity.h,
                    img: img,
                    ax: 0,
                    ay: 0,
                    ...(typeof z === "number" ? { z } : {}),
                };
            });
            byArea.set(area, sprites);
            return sprites;
        },
        spawn(ecs, prefabs, area) {
            const spawned = [];
            for (const entity of allEntities) {
                if (area !== undefined && entity.level !== area)
                    continue;
                const prefab = prefabs[entity.type];
                const result = prefab?.(entity);
                if (!result)
                    continue;
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
function ldtkGrid(source, options) {
    const project = source;
    if (!project || !Array.isArray(project.levels)) {
        throw new Error("LDtk.grid: expected parsed LDtk project JSON");
    }
    const tagged = ldtkTagMap(project);
    const values = (options.values ?? {});
    const legend = {
        ...tagged.legend,
        ...options.legend,
    };
    const entityKinds = { ...tagged.entities, ...options.entities };
    const markerKinds = { ...tagged.markers, ...options.markers };
    assertImportGlyphs(values, "LDtk.grid");
    const levels = [
        ...project.levels,
        ...(project.worlds ?? []).flatMap((world) => world.levels),
    ];
    const sourceLevel = levels.find((entry) => entry.identifier === options.level || entry.iid === options.level);
    if (!sourceLevel)
        throw new Error(`LDtk.grid: no level named "${options.level}"`);
    const layers = sourceLevel.layerInstances ?? [];
    const layer = layers.find((entry) => entry.__identifier === options.layer);
    if (!layer)
        throw new Error(`LDtk.grid: no layer named "${options.layer}"`);
    const cells = Array.from({ length: layer.__cHei }, (_, cy) => Array.from({ length: layer.__cWid }, (_, cx) => values[layer.intGridCsv?.[cy * layer.__cWid + cx] ?? 0] ?? EMPTY));
    for (const entityLayer of layers) {
        for (const entity of entityLayer.entityInstances ?? []) {
            const semanticKey = entityKinds[entity.__identifier];
            const key = semanticKey ?? markerKinds[entity.__identifier];
            if (key === undefined)
                continue;
            const cx = Math.floor((entity.px[0] + (entityLayer.__pxTotalOffsetX ?? 0)) / layer.__gridSize);
            const cy = Math.floor((entity.px[1] + (entityLayer.__pxTotalOffsetY ?? 0)) / layer.__gridSize);
            const spec = legend[key];
            const fillCols = semanticKey === undefined || spec?.span
                ? 1
                : Math.max(1, Math.ceil(entity.width / layer.__gridSize));
            const fillRows = semanticKey === undefined || spec?.span
                ? 1
                : Math.max(1, Math.ceil(entity.height / layer.__gridSize));
            for (let oy = 0; oy < fillRows; oy++) {
                for (let ox = 0; ox < fillCols; ox++) {
                    if (cells[cy + oy]?.[cx + ox] !== EMPTY) {
                        throw new Error(`LDtk.grid: entity "${entity.__identifier}" overlaps collision at (${cx + ox}, ${cy + oy})`);
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
function ldtkEntities(source, options) {
    const project = source;
    if (!project || !Array.isArray(project.levels)) {
        throw new Error("LDtk.entities: expected parsed LDtk project JSON");
    }
    const levels = [
        ...project.levels,
        ...(project.worlds ?? []).flatMap((world) => world.levels),
    ];
    const level = levels.find((entry) => entry.identifier === options.level || entry.iid === options.level);
    if (!level)
        throw new Error(`LDtk.entities: no level named "${options.level}"`);
    const out = [];
    for (const layer of level.layerInstances ?? []) {
        for (const entity of layer.entityInstances ?? []) {
            if (options.type && entity.__identifier !== options.type)
                continue;
            out.push({
                id: entity.iid ?? `${entity.__identifier}@${entity.px}`,
                type: entity.__identifier,
                level: level.identifier,
                grid: entity.__grid,
                x: entity.px[0] + (layer.__pxTotalOffsetX ?? 0),
                y: entity.px[1] + (layer.__pxTotalOffsetY ?? 0),
                w: entity.width,
                h: entity.height,
                fields: Object.fromEntries((entity.fieldInstances ?? []).map((field) => [field.__identifier, field.__value])),
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
