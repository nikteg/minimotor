// ---------- UI art CLI ----------
//
// `mm ui` verifies frame art against the pixels it is cut from. It exists
// because the failure modes — a slit where a repeat wraps, an inset that eats a
// column of edge art — are invisible at 1× and therefore survive both human
// review and screenshot-based agent review. See src/cli/nineslice/analyze.ts
// for what is actually measured, and ./tiles.ts for the tile-grid and autotile
// variants built on the same measurements.
//
// Frames can come from three places: an ad-hoc `--rect`, a JSON manifest, or a
// theme module, which is imported and called with a stub atlas so the frames it
// declares in code are checked without anyone maintaining a second copy of the
// numbers.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineFeature } from "../../cli/feature.js";
import { analyzeRegion, overlaps, phaseBreaks, } from "../../cli/nineslice/analyze.js";
import { decodePng, encodePng } from "../../cli/nineslice/png.js";
import { analyzeAutotile, analyzeTileFrame } from "../../cli/nineslice/tiles.js";
import { adjacencyFindings, DIRECTIONS, inferAdjacency } from "../../cli/nineslice/adjacency.js";
import { annotate, formatRegion, pixelMap, previewSheet, rank } from "../../cli/nineslice/report.js";
import { takeFlag, takeOption } from "../../cli/utils.js";
const help = `Verify UI frame art against its source pixels

Usage:
  mm ui nineslice <atlas.png> --rect <x,y,w,h> [--insets <l,t,r,b>]
  mm ui nineslice <manifest.json>
  mm ui nineslice <theme.ts> --atlas <atlas.png>
  mm ui frame <atlas.png> --grid <x,y,tw,th[,spacing]>
  mm ui autotile <atlas.png> --grid <x,y,tw,th[,spacing]> [--masks <m,m,…>]

nineslice checks a frame cut from one contiguous rect. frame checks the same
thing assembled from nine separate tiles on a grid — the tiles are composited
first, so the edge cells are measured as they will actually be drawn. autotile
checks a neighbour-mask set. Given --masks it verifies the declared
layout: every tile claiming the same edge state must present the same edge, and
no mask may be missing. Without --masks it reads the sockets off the art instead
and reports the adjacency relation they imply — the only option for a sheet
whose layout convention nobody wrote down.

Options:
  --rect <x,y,w,h>    Check one ad-hoc source rect.
  --insets <l,t,r,b>  Insets for --rect. Omitted, they are derived from the art.
  --atlas <file>      Atlas PNG, when the frames come from a theme module.
  --only <name>       Check the named frames only (repeatable, substring match).
  --map               Print an ASCII pixel map of each small frame.
  --out <dir>         Write zoomed source and composed preview PNGs.
  --grid <x,y,w,h[,s]>  Tile grid origin, tile size, and optional spacing.
  --masks <m,m,…>     Neighbour masks in reading order (N=1 E=2 S=4 W=8).
                      Omit to infer sockets from the art instead.
  --cols <n>          Grid columns. Defaults to what fits the atlas.
  --rows <n>          Grid rows. Defaults to what fits the atlas.
  --json              Print machine-readable JSON.
  --strict            Exit non-zero on warnings too.

A manifest is either a TilesetSkinManifest (the theme.json that ships beside an
atlas) or the terse { "atlas": "atlas.png", "regions": { "<name>": { "rect":
[x,y,w,h], "insets": [l,t,r,b] } } }. Insets may be omitted to have them derived
from the art instead of checked against it.
`;
const numbers = (raw, count, flag) => {
    const parts = raw.split(",").map((part) => Number(part.trim()));
    if (parts.length !== count || parts.some((part) => !Number.isFinite(part))) {
        throw new Error(`${flag} needs ${count} comma-separated numbers`);
    }
    return parts;
};
const toRect = (value) => ({
    sx: value[0],
    sy: value[1],
    sw: value[2],
    sh: value[3],
});
const toInsets = (value) => ({
    left: value[0],
    top: value[1],
    right: value[2],
    bottom: value[3],
});
const asRect = (region, name) => {
    if (Array.isArray(region.rect))
        return toRect(numbers(region.rect.join(","), 4, `${name}.rect`));
    if (region.rect && typeof region.rect === "object")
        return region.rect;
    if ([region.x, region.y, region.w, region.h].every((part) => typeof part === "number")) {
        return { sx: region.x, sy: region.y, sw: region.w, sh: region.h };
    }
    throw new Error(`frame "${name}" has no rect`);
};
const asInsets = (value) => {
    if (Array.isArray(value))
        return value.length === 4 ? toInsets(value) : undefined;
    if (value && typeof value === "object")
        return value;
    return undefined;
};
/** Load frames from a JSON manifest — either a `TilesetSkinManifest` as shipped
 *  next to a theme atlas, or the terse `{ regions: { name: { rect: [...] } } }`
 *  form, which is quicker to hand-write while chasing a single frame. */
function fromManifest(path) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const image = manifest.image ?? manifest.atlas;
    if (!image)
        throw new Error(`${path} has no "image"`);
    const regions = Object.entries(manifest.frames ?? manifest.regions ?? {}).map(([name, region]) => ({
        name,
        rect: asRect(region, name),
        insets: asInsets(region.insets),
    }));
    if (!regions.length)
        throw new Error(`${path} declares no frames`);
    return { atlas: resolve(dirname(path), image), regions };
}
const isFrame = (value) => {
    const frame = value;
    return (!!frame &&
        typeof frame === "object" &&
        ["sx", "sy", "sw", "sh"].every((key) => typeof frame[key] === "number") &&
        !!frame.insets &&
        ["left", "top", "right", "bottom"].every((key) => typeof frame.insets[key] === "number"));
};
/** Walk an arbitrary theme object and collect everything shaped like a
 *  NineSliceRegion, named by its path so a duplicate is obvious in the report. */
function harvest(value, path, into, depth = 0) {
    if (!value || typeof value !== "object" || depth > 6)
        return;
    if (isFrame(value)) {
        const frame = value;
        const key = `${frame.sx},${frame.sy},${frame.sw},${frame.sh},${frame.insets.left},${frame.insets.top},${frame.insets.right},${frame.insets.bottom}`;
        const existing = into.get(key);
        if (existing)
            existing.name = `${existing.name} ${path}`;
        else {
            into.set(key, {
                name: path,
                rect: { sx: frame.sx, sy: frame.sy, sw: frame.sw, sh: frame.sh },
                insets: { ...frame.insets },
            });
        }
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key === "image" || key === "mapping")
            continue;
        harvest(child, path ? `${path}.${key}` : key, into, depth + 1);
    }
}
/** Import a theme module and call its factories with a stub atlas. Only the
 *  geometry matters here, so an object that answers `width`/`height` is enough;
 *  `Tiles.recolor` already degrades to the source image outside a browser. */
async function fromModule(path, atlas) {
    const stub = {
        width: atlas.width,
        height: atlas.height,
        naturalWidth: atlas.width,
        naturalHeight: atlas.height,
    };
    let module;
    try {
        module = (await import(pathToFileURL(resolve(path)).href));
    }
    catch (error) {
        throw new Error(`could not import ${path}: ${error instanceof Error ? error.message : String(error)}\n` +
            "Theme modules import the built package — run `pnpm build` first, or use a JSON manifest.");
    }
    const found = new Map();
    for (const [name, exported] of Object.entries(module)) {
        if (typeof exported !== "function" || name.startsWith("load"))
            continue;
        let produced;
        try {
            produced = exported(stub);
        }
        catch {
            continue; // a factory that needs more than an atlas is not ours to call
        }
        harvest(produced, name.replace(/^create/, "").replace(/Themes?$/, "") || name, found);
    }
    if (!found.size)
        throw new Error(`${path} exported no nine-slice frames`);
    return [...found.values()];
}
const SIZES = [
    { w: 37, h: 29 },
    { w: 120, h: 64 },
];
function writeImages(directory, atlas, report) {
    mkdirSync(directory, { recursive: true });
    const safe = report.name.replace(/[^A-Za-z0-9_.-]+/g, "-");
    const written = [];
    const source = join(directory, `${safe}.source.png`);
    writeFileSync(source, encodePng(annotate(atlas, report.rect, report.insets)));
    written.push(source);
    const preview = join(directory, `${safe}.preview.png`);
    writeFileSync(preview, encodePng(previewSheet(atlas, report.rect, report.insets)));
    written.push(preview);
    return written;
}
async function nineslice(args) {
    const json = takeFlag(args, "--json");
    const strict = takeFlag(args, "--strict");
    const showMap = takeFlag(args, "--map");
    const out = takeOption(args, "--out");
    const atlasOption = takeOption(args, "--atlas");
    const rectOption = takeOption(args, "--rect");
    const insetsOption = takeOption(args, "--insets");
    const only = [];
    for (let filter = takeOption(args, "--only"); filter; filter = takeOption(args, "--only")) {
        only.push(filter);
    }
    const input = args.shift();
    if (!input)
        throw new Error(`nineslice needs an atlas, manifest, or theme module\n\n${help}`);
    if (args.length)
        throw new Error(`unknown option "${args[0]}"`);
    let atlasPath;
    let regions = [];
    let deferred;
    if (input.endsWith(".json")) {
        const manifest = fromManifest(resolve(input));
        atlasPath = manifest.atlas;
        regions = manifest.regions;
    }
    else if (input.endsWith(".ts") || input.endsWith(".js") || input.endsWith(".mjs")) {
        if (!atlasOption)
            throw new Error("a theme module needs --atlas <atlas.png>");
        atlasPath = resolve(atlasOption);
        deferred = resolve(input);
    }
    else {
        atlasPath = resolve(input);
        if (!rectOption)
            throw new Error("checking an atlas directly needs --rect <x,y,w,h>");
        regions = [
            {
                name: "rect",
                rect: toRect(numbers(rectOption, 4, "--rect")),
                insets: insetsOption ? toInsets(numbers(insetsOption, 4, "--insets")) : undefined,
            },
        ];
    }
    const atlas = decodePng(readFileSync(atlasPath));
    if (deferred)
        regions = await fromModule(deferred, atlas);
    if (only.length) {
        regions = regions.filter((region) => only.some((filter) => region.name.toLowerCase().includes(filter.toLowerCase())));
        if (!regions.length)
            throw new Error(`--only matched no frames`);
    }
    regions.sort((a, b) => a.name.localeCompare(b.name));
    const reports = regions.map((region) => analyzeRegion(atlas, region));
    for (const report of reports) {
        const breaks = phaseBreaks(atlas, report.rect, report.insets, SIZES[1]);
        report.x.breaks = breaks.top;
        report.y.breaks = breaks.left;
        if (breaks.top.length || breaks.left.length) {
            report.findings.push({
                level: "error",
                region: report.name,
                code: "composed-break",
                message: `composed at ${SIZES[1].w}×${SIZES[1].h} the pattern breaks phase at ` +
                    `x=${breaks.top.slice(0, 8).join(",") || "-"} y=${breaks.left.slice(0, 8).join(",") || "-"} ` +
                    `— those are the exact pixel columns/rows where the slit shows`,
            });
        }
    }
    const shared = overlaps(regions);
    const findings = [...shared, ...reports.flatMap((report) => report.findings)];
    if (json) {
        process.stdout.write(`${JSON.stringify({ atlas: atlasPath, reports, findings }, null, 2)}\n`);
    }
    else {
        process.stdout.write(`${atlasPath} (${atlas.width}×${atlas.height}), ${reports.length} frames\n\n`);
        for (const report of reports) {
            process.stdout.write(`${formatRegion(report)}\n`);
            if (showMap) {
                const map = pixelMap(atlas, report.rect, report.insets);
                if (map)
                    process.stdout.write(`${map}\n`);
            }
            if (out) {
                for (const file of writeImages(resolve(out), atlas, report)) {
                    process.stdout.write(`  wrote ${file}\n`);
                }
            }
            process.stdout.write("\n");
        }
        for (const finding of rank(shared)) {
            process.stdout.write(`${finding.level}: ${finding.region}: ${finding.message}\n`);
        }
        const errors = findings.filter((finding) => finding.level === "error").length;
        const warnings = findings.filter((finding) => finding.level === "warning").length;
        process.stdout.write(`${errors} errors, ${warnings} warnings\n`);
    }
    const failed = findings.some((finding) => finding.level === "error" || (strict && finding.level === "warning"));
    if (failed)
        throw new Error("nine-slice verification failed");
}
const parseGrid = (args) => {
    const raw = takeOption(args, "--grid");
    if (!raw)
        throw new Error("this command needs --grid <x,y,tileW,tileH[,spacing]>");
    const parts = raw.split(",").map((part) => Number(part.trim()));
    if (parts.length < 4 || parts.length > 5 || parts.some((part) => !Number.isInteger(part))) {
        throw new Error("--grid takes 4 or 5 whole numbers: x,y,tileW,tileH[,spacing]");
    }
    return { x: parts[0], y: parts[1], tile: { w: parts[2], h: parts[3] }, spacing: parts[4] };
};
/** Print findings and fail the command when any of them is fatal. */
function emit(findings, json, strict, headline) {
    if (json)
        process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
    else {
        process.stdout.write(`${headline}\n\n`);
        for (const finding of rank(findings)) {
            process.stdout.write(`${finding.level}: [${finding.code}] ${finding.message}\n`);
            if (finding.fix)
                process.stdout.write(`  fix: ${finding.fix}\n`);
        }
        const errors = findings.filter((finding) => finding.level === "error").length;
        const warnings = findings.filter((finding) => finding.level === "warning").length;
        process.stdout.write(`\n${errors} errors, ${warnings} warnings\n`);
    }
    const failed = findings.some((finding) => finding.level === "error" || (strict && finding.level === "warning"));
    if (failed)
        throw new Error("verification failed");
}
function frame(args) {
    const json = takeFlag(args, "--json");
    const strict = takeFlag(args, "--strict");
    const grid = parseGrid(args);
    const input = args.shift();
    if (!input)
        throw new Error("frame needs an atlas");
    if (args.length)
        throw new Error(`unknown option "${args[0]}"`);
    const atlas = decodePng(readFileSync(resolve(input)));
    emit(analyzeTileFrame(atlas, grid), json, strict, `${resolve(input)} (${atlas.width}×${atlas.height}), 3×3 frame of ${grid.tile.w}×${grid.tile.h} tiles at ${grid.x},${grid.y}`);
}
function autotile(args) {
    const json = takeFlag(args, "--json");
    const strict = takeFlag(args, "--strict");
    const grid = parseGrid(args);
    const colsRaw = takeOption(args, "--cols");
    const rowsRaw = takeOption(args, "--rows");
    const masksRaw = takeOption(args, "--masks");
    const input = args.shift();
    if (!input)
        throw new Error("autotile needs an atlas");
    if (args.length)
        throw new Error(`unknown option "${args[0]}"`);
    const atlas = decodePng(readFileSync(resolve(input)));
    const pitch = { w: grid.tile.w + (grid.spacing ?? 0), h: grid.tile.h + (grid.spacing ?? 0) };
    const cols = colsRaw ? Number(colsRaw) : Math.floor((atlas.width - grid.x) / pitch.w);
    const rows = rowsRaw ? Number(rowsRaw) : Math.floor((atlas.height - grid.y) / pitch.h);
    if (!Number.isInteger(cols) || cols < 1)
        throw new Error("--cols needs a positive whole number");
    if (!Number.isInteger(rows) || rows < 1)
        throw new Error("--rows needs a positive whole number");
    const where = `${resolve(input)} (${atlas.width}×${atlas.height}), ${grid.tile.w}×${grid.tile.h} tiles at ${grid.x},${grid.y}`;
    // With masks, the sheet's layout is declared and the pixels are checked
    // against it. Without, the layout is unknown and the sockets are read off the
    // art instead — which is the only option for a sheet nobody documented.
    if (masksRaw) {
        const masks = masksRaw.split(",").map((part) => Number(part.trim()));
        if (masks.some((mask) => !Number.isInteger(mask) || mask < 0 || mask > 15)) {
            throw new Error("--masks takes whole numbers 0–15 (N=1 E=2 S=4 W=8)");
        }
        const tiles = masks.map((mask, index) => ({
            mask,
            column: index % cols,
            row: Math.floor(index / cols),
        }));
        emit(analyzeAutotile(atlas, grid, tiles), json, strict, `${where}, ${tiles.length} declared`);
        return;
    }
    const graph = inferAdjacency(atlas, grid, { cols, rows });
    const findings = adjacencyFindings(graph);
    if (json) {
        process.stdout.write(`${JSON.stringify({
            tiles: graph.nodes.map((node) => ({
                column: node.column,
                row: node.row,
                ...node.sockets,
            })),
            alphabet: graph.alphabet,
            density: graph.density,
            findings,
        }, null, 2)}\n`);
    }
    else {
        process.stdout.write(`${where}\n\n` +
            `${graph.nodes.length} non-empty tiles in a ${cols}×${rows} grid\n` +
            `socket alphabet: ` +
            `N ${graph.alphabet.north}, E ${graph.alphabet.east}, ` +
            `S ${graph.alphabet.south}, W ${graph.alphabet.west}\n` +
            `adjacency density: ` +
            `${DIRECTIONS.map((d) => `${d} ${(graph.density[d] * 100).toFixed(1)}%`).join(", ")}\n\n`);
        for (const finding of rank(findings)) {
            process.stdout.write(`${finding.level}: [${finding.code}] ${finding.message}\n`);
        }
        const errors = findings.filter((finding) => finding.level === "error").length;
        const warnings = findings.filter((finding) => finding.level === "warning").length;
        process.stdout.write(`\n${errors} errors, ${warnings} warnings\n`);
    }
    const failed = findings.some((finding) => finding.level === "error" || (strict && finding.level === "warning"));
    if (failed)
        throw new Error("verification failed");
}
export default defineFeature({
    name: "ui",
    summary: "Verify UI frame art — nine-slices, tile frames, and autotile sets.",
    usage: [
        "mm ui nineslice <atlas.png> --rect <x,y,w,h> [--insets <l,t,r,b>]",
        "mm ui nineslice <manifest.json>",
        "mm ui nineslice <theme.ts> --atlas <atlas.png>",
        "mm ui frame <atlas.png> --grid <x,y,tw,th[,spacing]>",
        "mm ui autotile <atlas.png> --grid <x,y,tw,th[,spacing]> --masks <m,m,…> --cols <n>",
    ],
    async run(input) {
        if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
            process.stdout.write(help);
            return;
        }
        const args = input.slice(1);
        if (input[0] === "nineslice")
            await nineslice(args);
        else if (input[0] === "frame")
            frame(args);
        else if (input[0] === "autotile")
            autotile(args);
        else
            throw new Error(`unknown ui command "${input[0]}"\n\n${help}`);
    },
});
