import { sync, type PeerStates, type Room, type SyncOptions } from "./room.js";
import { lerp, lerpAngle } from "@src/math/mathf.js";
import { bodiesCodec, bodyCodec, type SyncCodec } from "./body-codec.js";
import { syncEntities, type EntityStates, type SyncEntitiesOptions } from "./entities.js";

/** Lightweight game bodies use nested velocity; Physics2D bodies use flat
 * velocity. State sync accepts either shape. */
export type SyncBody =
  | { x: number; y: number; vel: { x: number; y: number } }
  | { x: number; y: number; vx: number; vy: number };

type Metadata =
  | "w"
  | "h"
  | "rot"
  | "spin"
  | "grounded"
  | "facing"
  | "color"
  | "active"
  | "state"
  | "area";

export interface BodySnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w?: number;
  h?: number;
  rot?: number;
  spin?: number;
  grounded?: boolean;
  facing?: number;
  color?: string;
  active?: boolean;
  /** Discrete presentation/gameplay state, such as `"climb"` or `"death"`. */
  state?: string;
  /** Current level/area id. A change is a teleport boundary, not a motion
   * sample to interpolate across. */
  area?: string;
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
  for (const key of [
    "w",
    "h",
    "rot",
    "spin",
    "grounded",
    "facing",
    "color",
    "active",
    "state",
    "area",
  ] as const) {
    if (key in source) out[key] = source[key];
  }
  return out as BodyState<B>;
}

/** Blend body snapshots, taking the shortest arc for Physics2D rotation. */
export function lerpBodyState<T extends BodySnapshot>(a: T, b: T, t: number): T {
  if (a.area !== b.area) return { ...b };
  const out = { ...b };
  for (const key of ["x", "y", "vx", "vy", "spin", "facing"] as const) {
    if (typeof a[key] === "number" && typeof b[key] === "number") {
      (out[key] as number) = lerp(a[key], b[key], t);
    }
  }
  if (typeof a.rot === "number" && typeof b.rot === "number") out.rot = lerpAngle(a.rot, b.rot, t);
  return out;
}

/** Project body position/rotation from its two newest snapshots. Velocity units
 * do not matter: projection derives motion from the observed positions. */
export function extrapolateBodyState<T extends BodySnapshot>(a: T, b: T, t: number): T {
  if (a.area !== b.area) return { ...b };
  const out = { ...b };
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
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
  const target = body as SyncBody & Partial<Record<Metadata, number | boolean | string>>;
  for (const key of [
    "w",
    "h",
    "rot",
    "spin",
    "grounded",
    "facing",
    "color",
    "active",
    "state",
    "area",
  ] as const) {
    const value = state[key];
    if (key in target && value !== undefined) target[key] = value as never;
  }
  return body;
}

export type SyncBodyOptions<B extends SyncBody> = Omit<SyncOptions<BodyState<B>>, "state">;

/** Replicate a lightweight or Physics2D body with one call. Defaults to 60 Hz
 * plus 50ms-bounded snapshot extrapolation for responsive motion; adaptive
 * jitter restores buffering when needed. Pass a getter when the body instance
 * can be replaced on respawn. */
export function syncBody<B extends SyncBody>(
  room: Room<unknown>,
  body: B | (() => B),
  options: SyncBodyOptions<B> = {},
): PeerStates<BodyState<B>> {
  const read = typeof body === "function" ? body : () => body;
  return sync(room, {
    ...options,
    hz: options.hz ?? 60,
    lerp: options.lerp ?? lerpBodyState,
    extrapolate: options.extrapolate ?? extrapolateBodyState,
    maxExtrapolationMs: options.maxExtrapolationMs ?? 50,
    codec: options.codec ?? (bodyCodec<BodyState<B>>() as SyncCodec<BodyState<B>>),
    state: () => bodyState(read()),
  });
}

export type SyncBodiesOptions<B extends SyncBody> = Omit<
  SyncEntitiesOptions<B, BodyState<B>>,
  "entities" | "state"
>;

/** Replicate a dynamic collection of lightweight or Physics2D bodies. */
export function syncBodies<B extends SyncBody>(
  room: Room<unknown>,
  bodies: () => Iterable<B>,
  options: SyncBodiesOptions<B>,
): EntityStates<BodyState<B>> {
  return syncEntities(room, {
    ...options,
    entities: bodies,
    state: bodyState,
    lerp: options.lerp ?? lerpBodyState,
    extrapolate: options.extrapolate ?? extrapolateBodyState,
    maxExtrapolationMs: options.maxExtrapolationMs ?? 50,
    codec: options.codec ?? bodiesCodec<BodyState<B>>(),
  });
}
