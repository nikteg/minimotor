import type { LadderSource, SolidSource } from "../../collision/index.js";
import type { Rect } from "../../engine/app.js";
import type { GeneratedAbilities } from "../../cli/features/level.js";
export declare const TILE = 16;
export declare const PLAYER_W = 12;
export declare const PLAYER_H = 24;
export interface SimulationLevel {
    width: number;
    height: number;
    grid: string[];
    abilities: GeneratedAbilities;
}
export interface SimulationAction {
    left?: boolean;
    right?: boolean;
    up?: boolean;
    down?: boolean;
    jumpPressed?: boolean;
    jumpReleased?: boolean;
    dashPressed?: boolean;
}
export interface SimulationGem {
    x: number;
    y: number;
    taken: boolean;
}
export interface SimulationStats {
    steps: number;
    deaths: number;
    jumps: number;
    dashes: number;
    doubleJumps: number;
    wallJumps: number;
    gems: number;
    maxX: number;
    completed: boolean;
    completionSteps: number;
}
export interface SimulationSnapshot {
    player: {
        x: number;
        y: number;
        velX: number;
        velY: number;
        grounded: boolean;
        facing: number;
    };
    climbing: boolean;
    wallDir: number;
    wallCoyote: number;
    dashSteps: number;
    dashReady: boolean;
    airJumps: number;
    gems: boolean[];
    stats: SimulationStats;
}
export interface PlatformerSimulation {
    readonly source: SimulationLevel;
    readonly level: SimulationCollisionLevel;
    readonly player: {
        x: number;
        y: number;
        w: number;
        h: number;
        vel: {
            x: number;
            y: number;
        };
        grounded: boolean;
        facing: number;
    };
    readonly gems: SimulationGem[];
    readonly exit: {
        x: number;
        y: number;
    };
    readonly stats: SimulationStats;
    readonly climbing: boolean;
    readonly dashing: boolean;
    reset(countDeath?: boolean): void;
    step(action?: SimulationAction): void;
    snapshot(): SimulationSnapshot;
    restore(snapshot: SimulationSnapshot): void;
}
export interface SimulationCollisionLevel extends SolidSource, LadderSource {
    readonly rect: Rect;
}
/** Exact headless movement simulation shared by the tester UI and bot runners. */
export declare function createPlatformerSimulation(source: SimulationLevel): PlatformerSimulation;
