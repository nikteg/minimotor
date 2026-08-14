// ---------- LDtk CLI ----------
import { mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { defineFeature } from "../../cli/feature.js";
import { array, constArray, identifier, property, unionType } from "../../cli/utils.js";
const help = `Generate TypeScript from LDtk projects

Usage:
  mm ldtk types <project.ldtk> [-o <output.ts>]
  mm ldtk types <project.ldtk> --check [-o <output.ts>]
  mm ldtk types <project.ldtk> --stdout
  mm ldtk check <project.ldtk>
  mm ldtk watch <project.ldtk> [-o <output.ts>]
  mm ldtk --help

Commands:
  types         Generate level, entity, marker, field, and world-loader types.
  check         Validate levels, mm: conventions, portals, and references.
  watch         Regenerate types whenever the LDtk project changes.

Options:
  -o, --out     Output file. Defaults to <project>.generated.ts
  --check       Exit non-zero when the generated file is missing or stale.
  --stdout      Print generated code without writing a file.
`;
export function readProject(inputPath) {
    const project = JSON.parse(readFileSync(inputPath, "utf8"));
    const loadLevel = (level) => {
        if (level.layerInstances || !level.externalRelPath)
            return level;
        return JSON.parse(readFileSync(resolve(dirname(inputPath), level.externalRelPath), "utf8"));
    };
    return {
        ...project,
        levels: project.levels.map(loadLevel),
        worlds: project.worlds?.map((world) => ({
            ...world,
            levels: world.levels?.map(loadLevel),
        })),
    };
}
const schemaPath = new URL("../schemas/ldtk-1.5.3.schema.json", import.meta.url);
let _schemaJson;
let _schemaValidate;
function getSchemaValidator() {
    if (_schemaValidate)
        return _schemaValidate;
    if (!_schemaJson) {
        // Vite represents source modules with an HTTP URL in tests; the installed
        // CLI uses a file URL beside the copied schema.
        const path = schemaPath.protocol === "file:"
            ? fileURLToPath(schemaPath)
            : resolve(process.cwd(), "src/cli/schemas/ldtk-1.5.3.schema.json");
        _schemaJson = JSON.parse(readFileSync(path, "utf8"));
    }
    const ajv = new Ajv({ allErrors: true, strict: false });
    // Compile the enclosing document: its root `$ref` selects LdtkJsonRoot and
    // nested `#/otherTypes/*` references stay anchored to the same document.
    // LDtk labels draft-07 with an `https` URI that Ajv does not register (the
    // canonical meta-schema URI is `http`); omitting it selects Ajv's draft-07
    // default without changing the actual schema vocabulary.
    const schema = { ..._schemaJson };
    delete schema.$schema;
    // The level builder carries its own JSON object alongside LDtk's fields.
    // Admit that single Minimotor extension while keeping LDtk's otherwise
    // strict `additionalProperties: false` validation intact.
    const otherTypes = schema.otherTypes;
    const level = otherTypes.Level;
    const properties = level.properties;
    properties.customFields = { type: "object" };
    _schemaValidate = ajv.compile(schema);
    return _schemaValidate;
}
/** Validate the project JSON against the LDtk 1.5.3 schema. */
function validateSchema(project) {
    const validate = getSchemaValidator();
    const valid = validate(project);
    if (valid)
        return [];
    return (validate.errors ?? []).map((error) => `[schema] ${error.instancePath || "(root)"}: ${error.message}`);
}
/** Validate the conventions consumed by `LDtk.world`, plus JSON schema. */
export function checkLDtk(project) {
    const errors = validateSchema(project);
    const warnings = [];
    const levels = [
        ...project.levels,
        ...(project.worlds ?? []).flatMap((world) => world.levels ?? []),
    ];
    const definitions = project.defs.entities ?? [];
    const definitionNames = new Set(definitions.map((entity) => entity.identifier));
    const levelNames = new Set();
    const ids = new Map();
    for (const level of levels) {
        if (levelNames.has(level.identifier))
            errors.push(`duplicate level "${level.identifier}"`);
        levelNames.add(level.identifier);
        const layers = level.layerInstances ?? [];
        const names = new Set(layers.map((layer) => layer.__identifier));
        if (!names.has("World"))
            warnings.push(`${level.identifier}: no "World" collision layer`);
        if (!names.has("Art"))
            warnings.push(`${level.identifier}: no "Art" tile layer`);
        for (const layer of layers) {
            for (const entity of layer.entityInstances ?? []) {
                if (!definitionNames.has(entity.__identifier)) {
                    errors.push(`${level.identifier}: undefined entity "${entity.__identifier}"`);
                }
                if (!entity.iid)
                    continue;
                if (ids.has(entity.iid))
                    errors.push(`duplicate entity IID "${entity.iid}"`);
                ids.set(entity.iid, {
                    level: level.identifier,
                    type: entity.__identifier,
                    fields: new Map((entity.fieldInstances ?? []).map((field) => [field.__identifier, field.__value])),
                });
            }
        }
    }
    const knownTags = ["mm:marker", "mm:portal", "mm:solid", "mm:one-way", "mm:ladder", "mm:sprite"];
    for (const definition of definitions) {
        for (const tag of definition.tags ?? []) {
            if (tag.startsWith("mm:") &&
                !knownTags.includes(tag) &&
                !tag.startsWith("mm:slope:") &&
                !tag.startsWith("mm:span:")) {
                warnings.push(`${definition.identifier}: unknown tag "${tag}"`);
            }
        }
    }
    const portalTypes = new Set(definitions
        .filter((definition) => definition.tags?.includes("mm:portal"))
        .map((definition) => definition.identifier));
    const links = new Map();
    for (const entity of ids.values()) {
        if (!portalTypes.has(entity.type))
            continue;
        const ref = entity.fields.get("To");
        if (!ref || typeof ref.entityIid !== "string") {
            errors.push(`${entity.level}/${entity.type}: missing To EntityRef`);
            continue;
        }
        const target = ids.get(ref.entityIid);
        if (!target) {
            errors.push(`${entity.level}/${entity.type}: To references missing entity ${ref.entityIid}`);
            continue;
        }
        if (!portalTypes.has(target.type)) {
            errors.push(`${entity.level}/${entity.type}: To must target an mm:portal entity`);
        }
        const destinations = links.get(entity.level) ?? new Set();
        destinations.add(target.level);
        links.set(entity.level, destinations);
    }
    if (levels.length > 0) {
        const reached = new Set([levels[0].identifier]);
        const pending = [levels[0].identifier];
        while (pending.length) {
            for (const destination of links.get(pending.pop()) ?? []) {
                if (reached.has(destination))
                    continue;
                reached.add(destination);
                pending.push(destination);
            }
        }
        for (const level of levels) {
            if (!reached.has(level.identifier)) {
                warnings.push(`${level.identifier}: unreachable by portal from ${levels[0].identifier}`);
            }
        }
    }
    return { errors, warnings };
}
function fieldType(field, enums) {
    const raw = field.type ?? "";
    let type;
    if (raw === "F_Int" || raw === "F_Float")
        type = "number";
    else if (raw === "F_Bool")
        type = "boolean";
    else if (raw === "F_EntityRef")
        type = "LDtkEntityRef";
    else if (raw === "F_Point")
        type = "LDtkGridPoint";
    else if (raw === "F_Tile")
        type = "LDtkTileRef";
    else if (raw.startsWith("F_Enum(")) {
        const name = raw.slice(7, -1);
        type = enums.has(name) ? identifier(name) : "string";
    }
    else
        type = "string";
    if (field.isArray)
        type = `readonly ${type}[]`;
    if (field.canBeNull)
        type += " | null";
    return type;
}
/** Generate the TypeScript companion for an LDtk project. */
export function generateLDtkTypes(project, sourceName = "project.ldtk", sourceUrl = `./${sourceName}`) {
    if (!project || !Array.isArray(project.levels) || !project.defs) {
        throw new Error("expected an LDtk project JSON file");
    }
    const projectLevels = [
        ...project.levels,
        ...(project.worlds ?? []).flatMap((world) => world.levels ?? []),
    ];
    const levels = projectLevels.map((level) => level.identifier);
    const entities = (project.defs.entities ?? []).map((entity) => entity.identifier);
    const tagged = (tag) => (project.defs.entities ?? [])
        .filter((entity) => (entity.tags ?? []).includes(tag))
        .map((entity) => entity.identifier);
    const tileTypes = (project.defs.entities ?? [])
        .filter((entity) => (entity.tags ?? []).some((tag) => tag === "mm:solid" ||
        tag === "mm:one-way" ||
        tag === "mm:ladder" ||
        tag.startsWith("mm:slope:")))
        .map((entity) => entity.identifier);
    const enumDefs = new Map((project.defs.enums ?? []).map((entry) => [entry.identifier, entry]));
    const entitiesByLevel = new Map(projectLevels.map((level) => [
        level.identifier,
        [
            ...new Set((level.layerInstances ?? []).flatMap((layer) => (layer.entityInstances ?? []).map((entity) => entity.__identifier))),
        ].sort(),
    ]));
    const tilesets = (project.defs.tilesets ?? []).filter((tileset) => !!tileset.relPath);
    const artTilesetUid = project.defs.layers?.find((layer) => layer.identifier === "Art")?.tilesetDefUid;
    const artTileset = tilesets.find((tileset) => tileset.uid === artTilesetUid) ??
        (tilesets.length === 1 ? tilesets[0] : undefined);
    const assetKey = (tileset) => tileset === artTileset
        ? "terrain"
        : `tileset${tileset.identifier[0]?.toUpperCase() ?? ""}${tileset.identifier.slice(1)}`;
    const sourceDirectory = sourceUrl.replace(/[^/]*$/, "");
    let code = `// Generated by mm ldtk types from ${sourceName}. Do not edit.\n`;
    code += `import * as LDtk from "minimotor/ldtk";\n\n`;
    code += `import type { AssetManifest, Loaded } from "minimotor/assets";\n\n`;
    code += constArray("levelIds", levels);
    code += `export type LevelId = (typeof levelIds)[number];\n\n`;
    code += constArray("entityTypes", entities);
    code += `export type EntityType = (typeof entityTypes)[number];\n\n`;
    code += constArray("markerTypes", tagged("mm:marker"));
    code += `export type MarkerType = (typeof markerTypes)[number];\n\n`;
    code += constArray("tileTypes", tileTypes);
    code += `export type TileType = (typeof tileTypes)[number];\n\n`;
    code += constArray("portalTypes", tagged("mm:portal"));
    code += `export type PortalType = (typeof portalTypes)[number];\n\n`;
    code += constArray("spriteTypes", tagged("mm:sprite"));
    code += `export type SpriteType = (typeof spriteTypes)[number];\n\n`;
    code += `export interface LDtkEntityRef {\n`;
    code += `  readonly entityIid: string;\n  readonly layerIid: string;\n`;
    code += `  readonly levelIid: string;\n  readonly worldIid: string;\n}\n\n`;
    code += `export interface LDtkGridPoint {\n`;
    code += `  readonly cx: number;\n  readonly cy: number;\n}\n`;
    code += `export interface LDtkTileRef {\n`;
    code += `  readonly tilesetUid: number;\n  readonly x: number;\n  readonly y: number;\n`;
    code += `  readonly w: number;\n  readonly h: number;\n}\n\n`;
    for (const [name, definition] of enumDefs) {
        code += unionType(identifier(name), (definition.values ?? []).map((value) => value.id));
    }
    if (enumDefs.size)
        code += "\n";
    code += `export interface EntityFields {\n`;
    for (const entity of project.defs.entities ?? []) {
        const fields = entity.fieldDefs ?? [];
        if (fields.length === 0) {
            code += `  readonly ${property(entity.identifier)}: {};\n`;
            continue;
        }
        code += `  readonly ${property(entity.identifier)}: {\n`;
        for (const field of fields) {
            code += `    readonly ${property(field.identifier)}: ${fieldType(field, enumDefs)};\n`;
        }
        code += `  };\n`;
    }
    code += `}\n\n`;
    code += `export type FieldsOf<T extends EntityType> = EntityFields[T];\n\n`;
    code += `export interface LevelFields {\n`;
    for (const field of project.defs.levelFields ?? []) {
        code += `  readonly ${property(field.identifier)}: ${fieldType(field, enumDefs)};\n`;
    }
    code += `}\n\n`;
    code += `export const entityTypesByLevel = {\n`;
    for (const level of levels) {
        code += `  ${property(level)}: ${array(entitiesByLevel.get(level) ?? [], "  ")},\n`;
    }
    code += `} as const satisfies Record<LevelId, readonly EntityType[]>;\n\n`;
    code += `export type EntityIn<L extends LevelId> = (typeof entityTypesByLevel)[L][number];\n\n`;
    code += `export const isLevelId = (value: string): value is LevelId =>\n`;
    code += `  (levelIds as readonly string[]).includes(value);\n\n`;
    code += `export const levelAssets = {\n`;
    code += `  level: new URL(${JSON.stringify(sourceUrl)}, import.meta.url).href,\n`;
    for (const tileset of tilesets) {
        code += `  ${property(assetKey(tileset))}: new URL(${JSON.stringify(`${sourceDirectory}${tileset.relPath}`)}, import.meta.url).href,\n`;
    }
    code += `} as const satisfies AssetManifest;\n\n`;
    if (artTileset) {
        code += `export const loadWorld = (assets: Loaded<typeof levelAssets>) =>\n`;
        code += `  LDtk.world<LevelId, EntityType, EntityFields, LevelFields>(assets.level, {\n`;
        code += `    image: assets.terrain,\n`;
        code += `  });\n`;
    }
    else {
        code += `export const loadWorld = (\n`;
        code += `  assets: Loaded<typeof levelAssets>,\n`;
        code += `  image: CanvasImageSource,\n`;
        code += `) => LDtk.world<LevelId, EntityType, EntityFields, LevelFields>(assets.level, { image });\n`;
    }
    return code;
}
function parseTypesArgs(args) {
    let input;
    let output;
    let check = false;
    let stdout = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-o" || arg === "--out") {
            output = args[++i];
            if (!output)
                throw new Error(`${arg} needs a file`);
        }
        else if (arg === "--check")
            check = true;
        else if (arg === "--stdout")
            stdout = true;
        else if (arg.startsWith("-"))
            throw new Error(`unknown option "${arg}"`);
        else if (!input)
            input = arg;
        else
            throw new Error(`unexpected argument "${arg}"`);
    }
    if (!input)
        throw new Error("missing <project.ldtk>");
    if (stdout && output)
        throw new Error("--stdout cannot be combined with --out");
    const inputPath = resolve(input);
    return {
        inputPath,
        outputPath: output
            ? resolve(output)
            : inputPath.slice(0, -extname(inputPath).length) + ".generated.ts",
        check,
        stdout,
    };
}
function runTypes(args) {
    const options = parseTypesArgs(args);
    const source = readProject(options.inputPath);
    const label = relative(process.cwd(), options.inputPath) || options.inputPath;
    const sourceUrl = relative(dirname(options.outputPath), options.inputPath).replace(/\\/g, "/");
    const code = generateLDtkTypes(source, label, sourceUrl.startsWith(".") ? sourceUrl : `./${sourceUrl}`);
    if (options.stdout) {
        process.stdout.write(code);
        return;
    }
    if (options.check) {
        let current = "";
        try {
            current = readFileSync(options.outputPath, "utf8");
        }
        catch {
            // A missing generated file is stale too.
        }
        if (current !== code) {
            const output = relative(process.cwd(), options.outputPath);
            throw new Error(`${output} is stale; run mm ldtk types ${label} -o ${output}`);
        }
        process.stdout.write(`up to date: ${relative(process.cwd(), options.outputPath)}\n`);
        return;
    }
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, code);
    process.stdout.write(`generated ${relative(process.cwd(), options.outputPath)}\n`);
}
function runCheck(args) {
    if (args.length !== 1 || args[0].startsWith("-")) {
        throw new Error(`usage: mm ldtk check <project.ldtk>`);
    }
    const input = resolve(args[0]);
    const result = checkLDtk(readProject(input));
    for (const warning of result.warnings)
        process.stdout.write(`warning: ${warning}\n`);
    if (result.errors.length) {
        throw new Error(result.errors.join("\n"));
    }
    process.stdout.write(`valid: ${relative(process.cwd(), input)} (${result.warnings.length} warnings)\n`);
}
function runWatch(args) {
    const options = parseTypesArgs(args);
    if (options.check || options.stdout)
        throw new Error("watch does not support --check or --stdout");
    const generate = () => {
        try {
            runTypes(args);
        }
        catch (error) {
            process.stderr.write(`mm: ${error instanceof Error ? error.message : String(error)}\n`);
        }
    };
    generate();
    let timer;
    watch(dirname(options.inputPath), { recursive: true }, (_event, file) => {
        if (file && !file.endsWith(".ldtk") && !file.endsWith(".ldtkl"))
            return;
        clearTimeout(timer);
        timer = setTimeout(generate, 60);
    });
    process.stdout.write(`watching ${relative(process.cwd(), options.inputPath)}\n`);
}
export default defineFeature({
    name: "ldtk",
    summary: "Generate, validate, and watch LDtk projects.",
    usage: [
        "mm ldtk types <project.ldtk> [-o <output.ts>]",
        "mm ldtk check <project.ldtk>",
        "mm ldtk watch <project.ldtk> [-o <output.ts>]",
    ],
    run(args) {
        if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
            process.stdout.write(help);
            return;
        }
        if (args[0] === "types")
            runTypes(args.slice(1));
        else if (args[0] === "check")
            runCheck(args.slice(1));
        else if (args[0] === "watch")
            runWatch(args.slice(1));
        else
            throw new Error(`unknown ldtk command "${args.join(" ")}"\n\n${help}`);
    },
});
