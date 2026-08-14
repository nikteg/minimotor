export interface GeneratedLevelOptions {
    seed?: string;
    width?: number;
    height?: number;
    difficulty?: number;
    layout?: GeneratedLayout;
    features?: readonly GeneratedFeature[];
    abilities?: Partial<GeneratedAbilities>;
}
export type GeneratedFeature = "gaps" | "platforms" | "ladders" | "gems" | "tunnels" | "exit";
export declare const generatedFeatures: readonly ["gaps", "platforms", "ladders", "gems", "tunnels", "exit"];
export type GeneratedLayout = "surface" | "tunnel" | "mixed";
export interface GeneratedAbilities {
    dash: boolean;
    doubleJump: boolean;
    wallJump: boolean;
}
export interface GeneratedLevel {
    seed: string;
    width: number;
    height: number;
    difficulty: number;
    layout: GeneratedLayout;
    features: GeneratedFeature[];
    abilities: GeneratedAbilities;
    grid: string[];
    stages: {
        name: string;
        grid: string[];
    }[];
    metrics: {
        gaps: number;
        maxGap: number;
        maxStep: number;
        platforms: number;
        gems: number;
        rooms: number;
        coveredRatio: number;
    };
}
export interface NeutralLevelDesign {
    version: 1;
    gridSize: number;
    layout?: GeneratedLayout;
    abilities?: Partial<GeneratedAbilities>;
    levels: {
        id: string;
        name: string;
        theme: string;
        width: number;
        height: number;
        caveRow: number | null;
        entities: {
            type: string;
            x: number;
            y: number;
            w: number;
            h: number;
        }[];
    }[];
}
/** Seeded multi-pass greybox generation with conservative platformer metrics. */
export declare function generateLevel(options?: GeneratedLevelOptions): GeneratedLevel;
/** Hard constraints shared by CLI output and its regression tests. */
export declare function validateGeneratedLevel(level: GeneratedLevel): string[];
export declare function generatedDesign(level: GeneratedLevel, id?: string): NeutralLevelDesign;
export type LevelScoreProfile = "balanced" | "flow" | "exploration";
export interface LevelScore {
    total: number;
    profile: LevelScoreProfile;
    metrics: {
        gapRatio: number;
        eventDensity: number;
        verticalRange: number;
        columnVariety: number;
        rhythmEntropy: number;
        rewardCoverage: number;
        enclosureRatio: number;
        roomCount: number;
    };
    components: {
        validity: number;
        leniency: number;
        pacing: number;
        verticality: number;
        variety: number;
        rhythm: number;
        rewards: number;
        composition: number;
    };
}
/** Interpretable search proxy; it deliberately does not claim to measure fun. */
export declare function scoreGeneratedLevel(level: GeneratedLevel, profile?: LevelScoreProfile): LevelScore;
export interface OptimizedLevel {
    seed: string;
    difficulty: number;
    level: GeneratedLevel;
    score: LevelScore;
    fitness: number;
}
export interface PreferenceModel {
    version: 1;
    samples: number;
    ridge: number;
    features: readonly string[];
    means: number[];
    scales: number[];
    weights: number[];
}
/** Fit a small ridge-regression preference model from human or agent ratings. */
export declare function trainPreferenceModel(rows: {
    metrics: LevelScore["metrics"];
    rating: number | null;
}[], ridge?: number): PreferenceModel;
export declare function predictPreference(model: PreferenceModel, metrics: LevelScore["metrics"]): number;
/** Search-based PCG retaining the best candidate in each behavior bin. */
export declare function optimizeLevels(options: {
    seed?: string;
    count?: number;
    width?: number;
    height?: number;
    layout?: GeneratedLayout;
    profile?: LevelScoreProfile;
    features?: readonly GeneratedFeature[];
    model?: PreferenceModel;
    abilities?: Partial<GeneratedAbilities>;
}): {
    best: OptimizedLevel;
    elites: OptimizedLevel[];
    evaluated: OptimizedLevel[];
};
interface LDtkEntity {
    __identifier: string;
    iid?: string;
    px: [number, number];
    width: number;
    height: number;
    fieldInstances?: {
        __identifier: string;
        __value: unknown;
    }[];
}
interface LDtkLayer {
    __identifier: string;
    __gridSize: number;
    __cWid: number;
    __cHei: number;
    __tilesetDefUid?: number | null;
    entityInstances?: LDtkEntity[];
    gridTiles?: {
        px: [number, number];
        src: [number, number];
    }[];
    autoLayerTiles?: {
        px: [number, number];
        src: [number, number];
    }[];
}
interface LDtkCheckProject {
    defs?: {
        entities?: {
            identifier: string;
            tags?: string[];
        }[];
        tilesets?: {
            uid: number;
            pxWid: number;
            pxHei: number;
            tileGridSize: number;
        }[];
    };
    levels?: {
        identifier: string;
        pxWid: number;
        pxHei: number;
        layerInstances?: LDtkLayer[] | null;
    }[];
}
export interface LevelCheckOptions {
    spawn?: string;
    targets?: string[];
    jumpX?: number;
    jumpUp?: number;
    fall?: number;
    portalBoundaries?: boolean;
    reciprocalPortals?: boolean;
}
export interface LevelCheckResult {
    errors: string[];
    warnings: string[];
    levels: number;
    targets: number;
    report: string[];
}
/** Validate any entity-authored LDtk platformer against a movement envelope. */
export declare function checkLevelProject(project: LDtkCheckProject, options?: LevelCheckOptions): LevelCheckResult;
declare const _default: {
    readonly name: "level";
    readonly summary: "Generate, bot-test, score, or verify platformer greyboxes.";
    readonly usage: readonly ["mm level test [--port <port>]", "mm level simulate [--levels <n>] [--rounds <n>] [--bots <n>] [--attempts <n>]", "mm level evolve [--population <n>] [--generations <n>] [--tree <file>]", "mm level generate [--seed <text>] [--json] [--trace]", "mm level check <project.ldtk> [--portal-boundaries]"];
    readonly run: (input: string[]) => Promise<void>;
};
export default _default;
