export type PlatformerAnimationState = "idle" | "run" | "jump" | "climb";
/** Local bodies and flattened network snapshots both satisfy this shape. */
export interface PlatformerAnimationBody {
    state?: string;
    grounded?: boolean;
    vel?: {
        x: number;
        y: number;
    };
    vx?: number;
    vy?: number;
}
export interface PlatformerAnimationCursor {
    readonly state: string;
    readonly paused: boolean;
    set(state: string): void;
    reset(): void;
    pause(): void;
    resume(): void;
}
export interface PlatformerAnimations<C extends Record<string, PlatformerAnimationCursor>> {
    readonly cursors: C;
    /** Match every cursor to a local body or network snapshot. */
    sync(body: PlatformerAnimationBody): PlatformerAnimationState;
}
/** Derive the conventional visual state from a platformer body or snapshot. */
export declare function animationState(body: PlatformerAnimationBody): PlatformerAnimationState;
/**
 * Group ordinary animation cursors behind platformer-aware synchronization.
 * Anim itself stays ignorant of bodies, velocity, and climbing.
 */
export declare function animations<C extends Record<string, PlatformerAnimationCursor>>(cursors: C): PlatformerAnimations<C>;
