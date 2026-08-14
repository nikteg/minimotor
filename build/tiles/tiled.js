// ---------- Tiled (.tmj/.tsj) ----------
// Reading the editor's own JSON without translating it into engine-specific
// atlas coordinates first, so a Tiled project stays the source of truth.
import { orient } from "./cells.js";
import { EMPTY, isEmptyChar } from "./glyphs.js";
import { grid } from "./grid.js";
import { set } from "./tileset.js";
function tiledProperties(tile) {
    return Object.fromEntries((tile?.properties ?? []).map((property) => [property.name, property.value]));
}
/** Read a `.tsj` tileset without translating it into engine-specific atlas
 * coordinates. Tile class/type (or a string `name` property) becomes the
 * stable lookup name. Tiled custom properties `cols` and `rows` opt a tile
 * into a multi-cell atlas stamp. */
function tiledSet(image, source) {
    const json = source;
    if (!json || typeof json !== "object") {
        throw new Error("Tiles.Tiled.set: expected parsed Tiled tileset JSON");
    }
    if (!(json.tilewidth > 0) || !(json.tileheight > 0) || !(json.columns > 0)) {
        throw new Error("Tiles.Tiled.set: invalid tile size or column count");
    }
    const margin = json.margin ?? 0;
    const spacing = json.spacing ?? 0;
    const selectors = set(image, { size: json.tilewidth, names: {} });
    const definitions = new Map((json.tiles ?? []).map((tile) => [tile.id, tile]));
    const names = new Map();
    for (const tile of json.tiles ?? []) {
        const properties = tiledProperties(tile);
        const name = tile.class ||
            tile.type ||
            (typeof properties.name === "string" ? properties.name : undefined);
        if (name)
            names.set(name, tile.id);
    }
    function tile(id) {
        if (!Number.isInteger(id) || id < 0 || (json.tilecount !== undefined && id >= json.tilecount)) {
            throw new Error(`Tiles.Tiled.set: tile ${id} is outside the tileset`);
        }
        const definition = definitions.get(id);
        const properties = tiledProperties(definition);
        const cols = Number(properties.cols ?? 1);
        const rows = Number(properties.rows ?? 1);
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
            throw new Error(`Tiles.Tiled.set: tile ${id} has invalid cols/rows properties`);
        }
        const col = id % json.columns;
        const row = Math.floor(id / json.columns);
        return {
            image,
            sx: margin + col * (json.tilewidth + spacing),
            sy: margin + row * (json.tileheight + spacing),
            sw: json.tilewidth * cols + spacing * (cols - 1),
            sh: json.tileheight * rows + spacing * (rows - 1),
            ...(cols > 1 ? { cols } : {}),
            ...(rows > 1 ? { rows } : {}),
        };
    }
    function idOf(nameOrId) {
        if (typeof nameOrId === "number")
            return nameOrId;
        const id = names.get(nameOrId);
        if (id === undefined)
            throw new Error(`Tiles.Tiled.set: no tile named "${nameOrId}"`);
        return id;
    }
    return {
        json,
        tile,
        named(name) {
            return tile(idOf(name));
        },
        anim(nameOrId, clock) {
            const id = idOf(nameOrId);
            const frames = definitions.get(id)?.animation;
            if (!frames?.length)
                throw new Error(`Tiles.Tiled.set: tile ${id} has no animation`);
            const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
            return () => {
                let time = ((clock.now % total) + total) % total;
                for (const frame of frames) {
                    if (time < frame.duration)
                        return tile(frame.tileid);
                    time -= frame.duration;
                }
                return tile(frames[frames.length - 1].tileid);
            };
        },
        wang(name, color = 1) {
            const wang = json.wangsets?.find((set) => set.name === name);
            if (!wang)
                throw new Error(`Tiles.Tiled.set: no Wang set named "${name}"`);
            const colorId = typeof color === "number"
                ? color
                : (wang.wangcolors?.findIndex((entry) => entry.name === color) ?? -1) + 1;
            if (colorId < 1)
                throw new Error(`Tiles.Tiled.set: no Wang color named "${color}"`);
            const candidates = wang.wangtiles ?? [];
            return (at) => {
                const up = at.neighbor(0, -1);
                const right = at.neighbor(1, 0);
                const down = at.neighbor(0, 1);
                const left = at.neighbor(-1, 0);
                const connected = [
                    up,
                    up && right && at.neighbor(1, -1),
                    right,
                    right && down && at.neighbor(1, 1),
                    down,
                    down && left && at.neighbor(-1, 1),
                    left,
                    left && up && at.neighbor(-1, -1),
                ];
                let best;
                let bestMismatch = Infinity;
                for (const candidate of candidates) {
                    let mismatch = 0;
                    for (let i = 0; i < 8; i++) {
                        const wanted = connected[i] ? colorId : 0;
                        if ((candidate.wangid[i] ?? 0) !== wanted)
                            mismatch++;
                    }
                    if (mismatch < bestMismatch) {
                        best = candidate;
                        bestMismatch = mismatch;
                    }
                }
                return best ? tile(best.tileid) : null;
            };
        },
        pick: selectors.pick,
        auto9: selectors.auto9,
        auto16: selectors.auto16,
        auto4: selectors.auto4,
        orient,
    };
}
function assertImportGlyphs(values, source) {
    for (const glyph of Object.values(values)) {
        if (glyph.length !== 1 || isEmptyChar(glyph)) {
            throw new Error(`${source}: imported grid glyphs must be one non-empty character`);
        }
    }
}
/** Turn a finite or chunked Tiled tile layer into the same semantic `Level`
 * returned by `Tiles.grid`. Rendering still comes from a separate skin. */
function tiledGrid(source, options) {
    const map = source;
    if (!map || !Array.isArray(map.layers)) {
        throw new Error("Tiles.Tiled.grid: expected parsed Tiled map JSON");
    }
    assertImportGlyphs(options.tiles, "Tiles.Tiled.grid");
    const layer = map.layers.find((entry) => entry.name === options.layer && entry.type === "tilelayer");
    if (!layer)
        throw new Error(`Tiles.Tiled.grid: no tile layer named "${options.layer}"`);
    const chunks = layer.chunks ??
        (layer.data
            ? [
                {
                    x: 0,
                    y: 0,
                    width: layer.width ?? map.width,
                    height: layer.height ?? map.height,
                    data: layer.data,
                },
            ]
            : []);
    if (chunks.length === 0)
        throw new Error(`Tiles.Tiled.grid: layer "${options.layer}" has no data`);
    const minX = Math.min(...chunks.map((chunk) => chunk.x));
    const minY = Math.min(...chunks.map((chunk) => chunk.y));
    const maxX = Math.max(...chunks.map((chunk) => chunk.x + chunk.width));
    const maxY = Math.max(...chunks.map((chunk) => chunk.y + chunk.height));
    const cols = maxX - minX;
    const rows = maxY - minY;
    const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => EMPTY));
    const firstGid = options.firstGid ?? 1;
    for (const chunk of chunks) {
        for (let i = 0; i < chunk.data.length; i++) {
            // Tiled stores horizontal/vertical/diagonal transform bits in the high
            // nibble. Semantics only care which tile the GID references.
            const gid = (chunk.data[i] >>> 0) & 0x0fffffff;
            if (gid === 0)
                continue;
            const glyph = options.tiles[gid - firstGid];
            if (glyph !== undefined) {
                const cx = chunk.x - minX + (i % chunk.width);
                const cy = chunk.y - minY + Math.floor(i / chunk.width);
                cells[cy][cx] = glyph;
            }
        }
    }
    return grid(cells.map((row) => row.join("")).join("\n"), {
        size: map.tilewidth,
        legend: options.legend,
    });
}
/** Standard Tiled JSON adapters. */
export const Tiled = Object.freeze({ set: tiledSet, grid: tiledGrid });
