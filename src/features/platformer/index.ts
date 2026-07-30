export type PlatformerAnimationState = "idle" | "run" | "jump" | "climb";

/** Local bodies and flattened network snapshots both satisfy this shape. */
export interface PlatformerAnimationBody {
  state?: string;
  grounded?: boolean;
  vel?: { x: number; y: number };
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

const velocity = (body: PlatformerAnimationBody) => ({
  x: body.vel?.x ?? body.vx ?? 0,
  y: body.vel?.y ?? body.vy ?? 0,
});

/** Derive the conventional visual state from a platformer body or snapshot. */
export function animationState(body: PlatformerAnimationBody): PlatformerAnimationState {
  if (body.state === "climb") return "climb";
  if (body.grounded === false) return "jump";
  return Math.abs(velocity(body).x) > 0.5 ? "run" : "idle";
}

/**
 * Group ordinary animation cursors behind platformer-aware synchronization.
 * Anim itself stays ignorant of bodies, velocity, and climbing.
 */
export function animations<C extends Record<string, PlatformerAnimationCursor>>(
  cursors: C,
): PlatformerAnimations<C> {
  return {
    cursors,
    sync(body) {
      const state = animationState(body);
      const climbing = state === "climb";
      const climbingNow = Math.abs(velocity(body).y) > 0.001;
      for (const cursor of Object.values(cursors)) {
        cursor.set(state);
        if (!climbing || climbingNow) {
          cursor.resume();
        } else if (!cursor.paused) {
          cursor.reset();
          cursor.pause();
        }
      }
      return state;
    },
  };
}
