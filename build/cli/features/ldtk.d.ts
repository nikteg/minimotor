interface LDtkField {
    identifier: string;
    type?: string;
    isArray?: boolean;
    canBeNull?: boolean;
}
interface LDtkEntityDefinition {
    identifier: string;
    tags?: string[];
    fieldDefs?: LDtkField[];
}
interface LDtkEntityInstance {
    __identifier: string;
    iid?: string;
    fieldInstances?: {
        __identifier: string;
        __value: unknown;
    }[];
}
interface LDtkLevel {
    identifier: string;
    fieldInstances?: {
        __identifier: string;
        __value: unknown;
    }[];
    externalRelPath?: string | null;
    layerInstances?: {
        __identifier?: string;
        entityInstances?: LDtkEntityInstance[];
    }[] | null;
}
interface LDtkEnum {
    identifier: string;
    values?: {
        id: string;
    }[];
}
interface LDtkTileset {
    identifier: string;
    uid: number;
    relPath?: string | null;
}
interface LDtkLayerDefinition {
    identifier: string;
    tilesetDefUid?: number | null;
}
export interface LDtkProject {
    levels: LDtkLevel[];
    worlds?: {
        levels?: LDtkLevel[];
    }[];
    defs: {
        entities?: LDtkEntityDefinition[];
        enums?: LDtkEnum[];
        levelFields?: LDtkField[];
        layers?: LDtkLayerDefinition[];
        tilesets?: LDtkTileset[];
    };
}
export declare function readProject(inputPath: string): LDtkProject;
export interface LDtkCheckResult {
    errors: string[];
    warnings: string[];
}
/** Validate the conventions consumed by `LDtk.world`, plus JSON schema. */
export declare function checkLDtk(project: LDtkProject): LDtkCheckResult;
/** Generate the TypeScript companion for an LDtk project. */
export declare function generateLDtkTypes(project: LDtkProject, sourceName?: string, sourceUrl?: string): string;
declare const _default: {
    readonly name: "ldtk";
    readonly summary: "Generate, validate, and watch LDtk projects.";
    readonly usage: readonly ["mm ldtk types <project.ldtk> [-o <output.ts>]", "mm ldtk check <project.ldtk>", "mm ldtk watch <project.ldtk> [-o <output.ts>]"];
    readonly run: (args: string[]) => void;
};
export default _default;
