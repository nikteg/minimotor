// ---------- Simple 2D physics ----------
// One-axis gravity, jump impulse, ground collision.
// All values are tuned for 60 fps fixed timestep.

export const GRAVITY = 0.7;
export const JUMP_FORCE = -13.5;

export interface PhysicsBody {
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  onGround: boolean;
  rotation: number;
}

/** Apply gravity and resolve ground/platform collision.
 *  Returns true if the body landed this frame. */
export function applyGravity(body: PhysicsBody, floorY: number): boolean {
  body.vy += GRAVITY;
  body.y += body.vy;
  const bottom = body.y + body.h;
  if (bottom >= floorY) {
    body.y = floorY - body.h;
    body.vy = 0;
    body.onGround = true;
    body.rotation = 0;
    return true;
  }
  body.onGround = false;
  body.rotation += 0.12;
  return false;
}

/** Attempt a jump. Returns true if the jump was executed. */
export function jump(body: PhysicsBody): boolean {
  if (!body.onGround) return false;
  body.vy = JUMP_FORCE;
  body.onGround = false;
  return true;
}
