import { type GeneratedAbilities, type GeneratedFeature, type GeneratedLayout, type GeneratedLevel, type LevelScore, type LevelScoreProfile, type NeutralLevelDesign } from "../../cli/features/level.js";
import { type BotEvaluation } from "./bots.js";
export interface EvolutionOptions {
    seed?: string;
    population?: number;
    generations?: number;
    mutation?: number;
    width?: number;
    height?: number;
    difficulty?: number;
    layout?: GeneratedLayout;
    profile?: LevelScoreProfile;
    features?: readonly GeneratedFeature[];
    abilities?: Partial<GeneratedAbilities>;
    bots?: number;
    attempts?: number;
    maxSteps?: number;
    objective?: "balanced" | "complex";
}
export interface EvolutionCandidate {
    id: string;
    generation: number;
    parentId: string | null;
    seed: string;
    difficulty: number;
    level: GeneratedLevel;
    heuristic: LevelScore;
    bot: BotEvaluation;
    fitness: number;
    complexity: number;
}
export interface EvolutionMatch {
    generation: number;
    round: number;
    left: string;
    right: string;
    winner: string;
}
export interface EvolutionResult {
    options: {
        seed: string;
        population: number;
        generations: number;
        mutation: number;
        bots: number;
        attempts: number;
        maxSteps: number;
        objective: "balanced" | "complex";
    };
    candidates: EvolutionCandidate[];
    matches: EvolutionMatch[];
    generationChampions: EvolutionCandidate[];
    champion: EvolutionCandidate;
    tree: string;
    design: NeutralLevelDesign;
}
/**
 * Run single-elimination selection, then create reseeded offspring whose
 * layout and difficulty are inherited or mutated from first-round winners.
 */
export declare function evolveLevels(options?: EvolutionOptions): EvolutionResult;
