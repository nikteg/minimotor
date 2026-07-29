import { sync, type PeerStates, type Room, type SyncOptions } from "./room.js";
import { lerp, lerpAngle } from "../mathf.js";

/** Lightweight game bodies use nested velocity; Physics2D bodies use flat
 * velocity. State sync accepts either shape. */
export type SyncBody =
  | { x: number; y: number; vel: { x: number; y: number } }
  | { x: number; y: number; vx: number; vy: number };

type Metadata = "rot" | "spin" | "grounded" | "facing";

export interface BodySnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot?: number;
  spin?: number;
  grounded?: boolean;
  facing?: number;
}

/** The shallow, JSON-safe body state sent by `syncBody`. Every numeric field
 * is interpolated by `Net.sync`; optional simulation metadata is preserved. */
export type BodyState<B extends SyncBody = SyncBody> = BodySnapshot &
  Pick<B, Extract<keyof B, Metadata>>;

/** Convert a lightweight or Physics2D body into interpolation-friendly state. */
export function bodyState<B extends SyncBody>(body: B): BodyState<B> {
  const source = body as SyncBody & Partial<Record<Metadata, unknown>>;
  const flat = "vel" in body;
  const out: Record<string, unknown> = {
    x: body.x,
    y: body.y,
    vx: flat ? body.vel.x : body.vx,
    vy: flat ? body.vel.y : body.vy,
  };
  for (const key of ["rot", "spin", "grounded", "facing"] as const) {
    if (key in source) out[key] = source[key];
  }
  return out as BodyState<B>;
}

/** Blend body snapshots, taking the shortest arc for Physics2D rotation. */
export function lerpBodyState<T extends BodySnapshot>(a: T, b: T, t: number): T {
  const out = { ...b };
  for (const key of ["x", "y", "vx", "vy", "spin", "facing"] as const) {
    if (typeof a[key] === "number" && typeof b[key] === "number") {
      (out[key] as number) = lerp(a[key], b[key], t);
    }
  }
  if (typeof a.rot === "number" && typeof b.rot === "number") out.rot = lerpAngle(a.rot, b.rot, t);
  return out;
}

/** Apply a snapshot to a lightweight body or remote Physics2D proxy. */
export function applyBodyState<B extends SyncBody>(body: B, state: BodySnapshot): B {
  body.x = state.x;
  body.y = state.y;
  if ("vel" in body) {
    body.vel.x = state.vx;
    body.vel.y = state.vy;
  } else {
    body.vx = state.vx;
    body.vy = state.vy;
  }
  const target = body as SyncBody & Partial<Record<Metadata, number | boolean>>;
  for (const key of ["rot", "spin", "grounded", "facing"] as const) {
    const value = state[key];
    if (key in target && value !== undefined) target[key] = value as never;
  }
  return body;
}

export type SyncBodyOptions<B extends SyncBody> = Omit<SyncOptions<BodyState<B>>, "state">;

/** Replicate a lightweight or Physics2D body with one call. Pass a getter when
 * the body instance can be replaced on respawn. */
export function syncBody<B extends SyncBody>(
  room: Room<unknown>,
  body: B | (() => B),
  options: SyncBodyOptions<B> = {},
): PeerStates<BodyState<B>> {
  const read = typeof body === "function" ? body : () => body;
  return sync(room, {
    ...options,
    lerp: options.lerp ?? lerpBodyState,
    state: () => bodyState(read()),
  });
}
