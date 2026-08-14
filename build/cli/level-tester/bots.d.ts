import type { GeneratedLevel } from "../../cli/features/level.js";
import { type SimulationStats } from "./simulation.js";
export type BotPersona = "expert" | "intermediate" | "beginner" | "completionist";
export interface BotCommand {
    horizontal: -1 | 0 | 1;
    vertical: -1 | 0 | 1;
    jump: boolean;
    dash: boolean;
    steps: number;
}
export interface BotPlan {
    completed: boolean;
    commands: BotCommand[];
    expanded: number;
    progress: number;
    stats: SimulationStats;
}
export interface BotEpisode {
    persona: BotPersona;
    attempt: number;
    completed: boolean;
    completionSteps: number | null;
    deaths: number;
    progress: number;
    gems: number;
    jumps: number;
    dashes: number;
    doubleJumps: number;
    wallJumps: number;
    inputComplexity: number;
    pathSignature: string;
}
export interface BotEvaluation {
    passed: boolean;
    score: number;
    planner: BotPlan;
    episodes: BotEpisode[];
    metrics: {
        successRate: number;
        expertSuccessRate: number;
        intermediateSuccessRate: number;
        beginnerSuccessRate: number;
        completionistSuccessRate: number;
        medianCompletionSteps: number | null;
        medianDeaths: number;
        meanProgress: number;
        stuckRate: number;
        gemCoverage: number;
        pathDiversity: number;
        meanInputComplexity: number;
        observedDashRate: number;
        observedDoubleJumpRate: number;
        observedWallJumpRate: number;
    };
}
/** Beam-search the exact gameplay simulation and retain a replayable input proof. */
export declare function planLevel(level: GeneratedLevel, options?: {
    beamWidth?: number;
    maxSteps?: number;
    collectGems?: boolean;
}): BotPlan;
/** Run several synthetic player personas against one generated level. */
export declare function evaluateLevelWithBots(level: GeneratedLevel, options?: {
    bots?: number;
    attempts?: number;
    maxSteps?: number;
    seed?: string;
}): BotEvaluation;
