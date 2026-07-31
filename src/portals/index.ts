// ---------- Portals ----------
// Portals connect world areas; scenes remain presentation/lifecycle. Several
// areas may use one gameplay scene, or each area may name a different scene.
// The body carries its current `area`, which Net.share preserves and treats as
// a teleport boundary, so peers never interpolate through unloaded maps.

import { rectsOverlap } from "../collision.js";
import type { App, Rect } from "../engine/index.js";
import type { GoOptions, SceneStack } from "../scenes/index.js";
import { fade, wipe, type Transition } from "../transitions.js";
import type { Vec2 } from "../vec2.js";

export interface PortalDestination<A extends string> {
  /** Destination area/level id. */
  area: A;
  /** Spawn marker queried from the destination level. */
  spawn: string;
  /** How the resolved point anchors a rectangular body. Default `"center"`. */
  anchor?: "center" | "feet";
}

export type PortalTransition =
  | "none"
  | "fade"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down";

export interface Portal<A extends string> extends Rect {
  id?: string;
  to: PortalDestination<A>;
  /** Overrides the router's default covering transition. */
  transition?: Transition | PortalTransition;
  transitionMs?: number;
}

export interface PortalBody<A extends string> {
  x: number;
  y: number;
  area: A;
  w?: number;
  h?: number;
  vel?: { x: number; y: number };
  vx?: number;
  vy?: number;
  grounded?: boolean;
}

export interface PortalArea<A extends string, S extends string> {
  /** Scene shown for this area. Multiple areas may share one scene. */
  scene: S;
  /** Anything with `spawnOne`, including `Tiles.Level`. */
  level: { spawnOne(marker: string): Vec2 };
  portals: readonly Portal<A>[];
  resolve?(destination: PortalDestination<A>): Vec2;
}

/** Structural world source. `LDtk.world` implements this directly. */
export interface PortalWorld<A extends string> {
  level(area: A): { spawnOne(marker: string): Vec2 };
  portals(area: A): readonly Portal<A>[];
  resolve?(destination: PortalDestination<A>): Vec2;
}

export interface PortalTravel<A extends string> {
  from: A;
  to: A;
  spawn: string;
  portal?: Portal<A>;
}

export interface PortalOptions<A extends string, S extends string, B extends PortalBody<A>> {
  body: B | (() => B);
  scenes: Pick<SceneStack<S>, "go" | "active">;
  /** Explicit areas, or pass a `world` such as `LDtk.world`. */
  areas?: Record<A, PortalArea<A, S>>;
  world?: PortalWorld<A>;
  /** Scene used by world-backed areas. A constant supports one shared gameplay
   * scene; a resolver supports one scene per area. Defaults to the area id. */
  scene?: S | ((area: A) => S);
  /** Detect portals automatically after each fixed gameplay step. Default
   * true. Set false for manual/isolated simulation and call `update()`. */
  auto?: boolean;
  /** Default scene-cover transition. */
  transition?: Transition;
  /** Body bounds for trigger overlap. The default uses top-left `x/y/w/h`;
   * bodies without `w/h` are treated as center points. */
  bounds?(body: B): Rect;
  /** Place a body at a resolved destination. */
  place?(body: B, spawn: Vec2, destination: PortalDestination<A>): void;
  /** Runs after area/position changes and before the destination scene enters.
   * Snap the camera or swap area-owned systems here. */
  onTravel?(travel: PortalTravel<A>): void;
  /** Runtime owner injected by the Portals feature. */
  app?: Pick<App, "onStep" | "onDestroy">;
}

export interface PortalRouter<A extends string> {
  readonly area: A;
  /** Detect and enter an overlapping portal. Returns true on travel. */
  update(): boolean;
  /** Travel directly (save games, scripted doors, server commands). */
  travel(destination: PortalDestination<A>): void;
  /** True when another replicated object occupies our current area. */
  sameArea(other: { area?: string }): boolean;
  /** Stop automatic detection. Direct `travel()` remains available. */
  dispose(): void;
}

function defaultBounds<A extends string, B extends PortalBody<A>>(body: B): Rect {
  if (typeof body.w === "number" && typeof body.h === "number") return body as Rect;
  return { x: body.x, y: body.y, w: 0.001, h: 0.001 };
}

function defaultPlace<A extends string, B extends PortalBody<A>>(
  body: B,
  spawn: Vec2,
  destination: PortalDestination<A>,
): void {
  body.x = spawn.x - (body.w ?? 0) / 2;
  // Feet markers describe the supporting surface. Leave one world pixel of
  // clearance so the next collision step establishes contact instead of
  // inheriting an edge-overlap from a teleport or replicated body.
  body.y = spawn.y - (destination.anchor === "feet" ? (body.h ?? 0) + 1 : (body.h ?? 0) / 2);
  if (typeof body.grounded === "boolean") body.grounded = false;
}

function stopBody<A extends string>(body: PortalBody<A>): void {
  if (body.vel) body.vel.x = body.vel.y = 0;
  if (typeof body.vx === "number") body.vx = 0;
  if (typeof body.vy === "number") body.vy = 0;
}

function authoredTransition(
  value: Portal<string>["transition"],
  duration: number | undefined,
): Transition | undefined {
  if (!value || value === "none") return undefined;
  if (typeof value !== "string") return value;
  const ms = duration ?? 400;
  if (value === "fade") return fade(ms);
  return wipe(ms, value.slice(5) as "left" | "right" | "up" | "down");
}

/** Create an area router. Detection runs automatically after fixed gameplay
 * updates. `LDtk.world` supplies authored `mm:portal` destinations and
 * transitions directly. A portal disarms until the body leaves every
 * destination trigger, preventing paired doors from bouncing straight back. */
export function createPortalRouter<A extends string, S extends string, B extends PortalBody<A>>(
  options: PortalOptions<A, S, B>,
): PortalRouter<A> {
  const read = typeof options.body === "function" ? options.body : () => options.body as B;
  const bounds = options.bounds ?? defaultBounds;
  const place = options.place ?? defaultPlace;
  let armed = true;

  function area(id: A): PortalArea<A, S> {
    const explicit = options.areas?.[id];
    if (explicit) return explicit;
    if (!options.world) throw new Error("Portals: pass areas or world");
    const scene =
      typeof options.scene === "function"
        ? options.scene(id)
        : (options.scene ?? (id as unknown as S));
    return {
      scene,
      level: options.world.level(id),
      portals: options.world.portals(id),
      resolve: options.world.resolve,
    };
  }

  function travel(destination: PortalDestination<A>, portal?: Portal<A>): void {
    const body = read();
    const from = body.area;
    const target = area(destination.area);
    const spawn = target.resolve?.(destination) ?? target.level.spawnOne(destination.spawn);
    body.area = destination.area;
    place(body, spawn, destination);
    stopBody(body);
    armed = false;
    options.onTravel?.({
      from,
      to: destination.area,
      spawn: destination.spawn,
      portal,
    });
    const transition =
      portal?.transition !== undefined
        ? authoredTransition(portal.transition, portal.transitionMs)
        : options.transition;
    options.scenes.go(target.scene, transition ? ({ transition } satisfies GoOptions) : undefined);
  }

  let unsubscribe: (() => void) | undefined;
  const router: PortalRouter<A> = {
    get area() {
      return read().area;
    },
    update() {
      const body = read();
      const current = area(body.area);
      // A modal/title scene may keep drawing the area below it, but only the
      // area's own gameplay scene may activate its portals.
      if (options.scenes.active !== current.scene) return false;
      const portals = current.portals;
      const box = bounds(body);
      const touching = portals.find((portal) => rectsOverlap(box, portal));
      if (!armed) {
        if (!touching) armed = true;
        return false;
      }
      if (!touching) return false;
      travel(touching.to, touching);
      return true;
    },
    travel(destination) {
      travel(destination);
    },
    sameArea(other) {
      return other.area === read().area;
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
  if (options.auto !== false) {
    if (!options.app) {
      throw new Error("Portals: automatic routing requires createPortals(app)");
    }
    // `onStep`, not a per-frame hook: the router must advance exactly once per
    // fixed step, so a catch-up frame routes every step it simulates.
    unsubscribe = options.app.onStep(() => router.update());
    options.app.onDestroy(() => router.dispose());
  }
  return router;
}
