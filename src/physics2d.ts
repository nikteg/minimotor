// ---------- Rigid-body physics (opt-in adapter over planck / Box2D) ----------
// A real solver — stacking, friction, restitution, joints, sleeping — behind
// minimotor's plain-data style. This is the one module with a dependency, so it
// lives in its own entry point; the core bundle stays dependency-free and games
// that don't import it pay nothing:
//
//   import { Physics2D } from "minimotor/physics2d";
//
//   const phys = Physics2D.world();          // gravity in px/s², default 1800 down
//   phys.walls(0, 0, vp.w, vp.h);            // static frame around the viewport
//   const crate = phys.box(200, 50, 40, 40); // dynamic by default
//   // update(stepMs):  phys.step(stepMs)
//   // draw:            crate.x, crate.y, crate.rot  (center px + radians)
//
// The whole API works in pixels and canvas coordinates (y down); the meters
// Box2D wants internally are converted at the boundary (`pixelsPerMeter`).
//
// Composes with the ECS without glue: a Body2D is plain data, so hold it in a
// component and copy the transform into a `Sprites.Sprite` once per step —
// the body simulates, the sprite renders:
//
//   const Phys = ECS.component("Phys"); // { body: Body2D }
//   world.system("physics", () => phys.step(Loop.step));
//   world.system("sync", (w) => {
//     for (const [, s, p] of w.query(Sprites.Sprite, Phys)) {
//       s.x = p.body.x; s.y = p.body.y; s.rot = p.body.rot;
//     }
//   });

import {
  AABB,
  type Body as PlanckBody,
  Box,
  Chain,
  Circle,
  type Contact,
  DistanceJoint,
  type Fixture,
  type Joint,
  MouseJoint,
  Polygon,
  PrismaticJoint,
  RevoluteJoint,
  Vec2,
  WeldJoint,
  World,
} from "planck";
import { component, type Ecs as EcsWorld } from "./ecs/index.js";
import { Sprite } from "./sprites.js";

/** Options for `Physics2D.world()`. */
export interface Physics2DOptions {
  /** World gravity in px/s². Default `{ x: 0, y: 1800 }` (canvas y is down). */
  gravity?: { x: number; y: number };
  /** How many pixels one Box2D meter spans. Box2D's solver is tuned for bodies
   *  0.1–10 m, so pick a scale that puts your sprites in that range.
   *  Default 50 (a 40px crate is 0.8 m). */
  pixelsPerMeter?: number;
}

/** Per-body options for the body factories. */
export interface BodyOptions {
  /** `"dynamic"` (default) is fully simulated; `"static"` never moves;
   *  `"kinematic"` moves by its velocity but is unaffected by forces. */
  type?: "dynamic" | "static" | "kinematic";
  /** Mass per area — heavier bodies push lighter ones around. Default 1. */
  density?: number;
  /** Sliding friction 0..1. Default 0.3. */
  friction?: number;
  /** Bounciness 0..1. Default 0 (no bounce). */
  restitution?: number;
  /** Lock rotation (e.g. a player capsule that shouldn't tip over). */
  fixedRotation?: boolean;
  /** Continuous collision for small fast movers that would tunnel. */
  bullet?: boolean;
  /** Velocity fade per second (air drag). Default 0. */
  linearDamping?: number;
  /** Spin fade per second. Default 0. */
  angularDamping?: number;
  /** Detect overlaps without resolving them — a trigger volume. Sensors still
   *  fire `onContact`/`onContactEnd`, so this is how you build a goal zone,
   *  a pickup, or a "player left the arena" check. Default false. */
  isSensor?: boolean;
  /** Which layers this body belongs to, as a bitmask. Default `0x0001`. */
  category?: number;
  /** Which layers this body collides with, as a bitmask. Default `0xffff`
   *  (everything). Two bodies touch only if each one's `category` is in the
   *  other's `mask` — filtering is mutual, so set both sides. */
  mask?: number;
  /** Override the category/mask rules for bodies sharing a group: a positive
   *  group always collides with itself, a negative group never does. 0
   *  (default) means "no group — use category/mask". */
  group?: number;
  /** Your tag, surfaced on the body and in `onContact`. */
  data?: unknown;
}

/** A rigid body, addressed in pixels. Setting `x`/`y`/`rot` teleports. */
export interface Body2D {
  /** Center x in px. */
  x: number;
  /** Center y in px. */
  y: number;
  /** Rotation in radians — feed straight to `ctx.rotate`. */
  rot: number;
  /** Velocity x in px/s. */
  vx: number;
  /** Velocity y in px/s. */
  vy: number;
  /** Angular velocity in rad/s. */
  spin: number;
  /** False once the solver has put the body to sleep (resting). */
  readonly awake: boolean;
  /** Rouse a sleeping body. Teleporting (`x`/`y`) doesn't wake by itself —
   *  call this after moving the world under resting bodies (e.g. on resize). */
  wake(): void;
  /** Whether this body is a trigger volume rather than a solid (see
   *  `BodyOptions.isSensor`). Writable, so a door can stop being solid the
   *  moment it opens. */
  sensor: boolean;
  /** The `data` tag passed at creation (mutable). */
  data: unknown;
  /** Instant velocity change, mass-scaled (kg·px/s), applied at the center. */
  applyImpulse(ix: number, iy: number): void;
  /** Continuous push (kg·px/s²), applied at the center each step it's called. */
  applyForce(fx: number, fy: number): void;
  /** Remove the body from the world. Safe inside `onContact` — deferred until
   *  the step ends, like ECS despawn. */
  destroy(): void;
  /** Escape hatch: the underlying planck body. */
  readonly raw: PlanckBody;
}

/** Options for `walls()`. */
export interface WallsOptions extends BodyOptions {
  /** Depth of the solid wall slabs, in px. Default 100. */
  thickness?: number;
  /** How fast the walls glide when re-`set()`, in px/s. Default 1200. */
  sweepSpeed?: number;
}

/** The containment frame from `walls()`. The four walls are kinematic slabs:
 *  `set()` makes them glide to the new rect, sweeping bodies ahead of them
 *  like a bulldozer — bodies push on each other instead of teleporting. */
export interface Walls2D {
  /** Re-target the frame (e.g. on window resize). Walls glide there at
   *  `sweepSpeed`; every dynamic body is woken so sleepers react to the
   *  floor moving away beneath them. */
  set(x: number, y: number, w: number, h: number): void;
  /** Remove all four walls. */
  destroy(): void;
}

/** What every joint factory hands back: a way to let go, and the raw joint.
 *  `destroy()` is deferred while the world is stepping and idempotent —
 *  destroying either joined body already takes the joint with it. */
export interface Joint2D<J extends Joint = Joint> {
  /** Remove the joint. */
  destroy(): void;
  /** Escape hatch: the underlying planck joint. */
  readonly raw: J;
}

/** A revolute joint from `pin()`. */
export interface Pin2D extends Joint2D<RevoluteJoint> {
  /** Drive the joint like a motor: target speed in rad/s, with the torque
   *  budget to reach it (`maxTorque` default 1000). Pass speed 0 to brake, or
   *  call `destroy()` to let go. */
  motor(speedRadPerSec: number, maxTorque?: number): void;
}

/** Options for `rope()`. */
export interface RopeOptions {
  /** Distance to hold, in px. Default: however far apart they are right now. */
  length?: number;
  /** Springiness in Hz — 0 (default) is a rigid rod, low values sag and bounce
   *  like a bungee. */
  stiffness?: number;
  /** Spring damping: 0 oscillates forever, 1 is critically damped.
   *  Default 0.7. Only matters with a `stiffness`. */
  damping?: number;
}

/** A distance joint from `rope()` — holds two bodies a fixed distance apart,
 *  or springs between them when given a `stiffness`. */
export interface Rope2D extends Joint2D<DistanceJoint> {
  /** Re-target the held distance in px (winch it in, pay it out). */
  setLength(px: number): void;
}

/** Options for `slider()`. */
export interface SliderOptions {
  /** Travel limits along the axis in px, measured from the starting position
   *  (`min` behind, `max` ahead). Omit for unlimited travel. */
  min?: number;
  /** See `min`. */
  max?: number;
}

/** A prismatic joint from `slider()` — the bodies may only slide along one
 *  axis relative to each other: lifts, doors, pistons. */
export interface Slider2D extends Joint2D<PrismaticJoint> {
  /** Drive the slide: target speed in px/s along the axis, with the force
   *  budget to reach it (`maxForce` default 1000). Speed 0 brakes and holds. */
  motor(speedPxPerSec: number, maxForce?: number): void;
  /** How far along the axis the bodies currently sit, in px. */
  readonly travel: number;
}

/** A weld joint from `weld()` — two bodies rigidly fused. Not perfectly rigid
 *  (the solver allows a little give under load), which is what makes
 *  breakable-joint effects easy: watch the travel and `destroy()`. */
export type Weld2D = Joint2D<WeldJoint>;

/** Options for `chain()` — static terrain, so no mass-related settings. */
export interface ChainOptions {
  /** Sliding friction 0..1. Default 0.3. */
  friction?: number;
  /** Bounciness 0..1. Default 0. */
  restitution?: number;
  /** Join the last point back to the first, sealing the loop. Default false. */
  loop?: boolean;
  /** Which layers this belongs to, as a bitmask. Default `0x0001`. */
  category?: number;
  /** Which layers it collides with. Default `0xffff`. */
  mask?: number;
  /** Your tag, surfaced on the body and in `onContact`. */
  data?: unknown;
}

/** Where a ray met a body. Plain data in pixels — read it, don't hold it
 *  (`raycast` reuses one result object; copy the fields you need). */
export interface RayHit {
  /** The body that was hit. */
  body: Body2D;
  /** Impact point x in px. */
  x: number;
  /** Impact point y in px. */
  y: number;
  /** Surface normal x at the impact, unit length, pointing back at the ray. */
  nx: number;
  /** Surface normal y at the impact. */
  ny: number;
  /** Distance from the ray's start to the impact, in px. */
  distance: number;
  /** Where along the ray the hit landed, 0 at the start and 1 at the end. */
  fraction: number;
}

/** Options for `raycast()`. */
export interface RaycastOptions {
  /** Let the ray hit sensors too. Default false — a trigger volume shouldn't
   *  block line of sight. */
  sensors?: boolean;
  /** Return false to ignore a body — the standard way to stop a shooter's
   *  own hitbox from eating its bullet. */
  filter?: (body: Body2D) => boolean;
}

/** Options for the world queries (`queryAABB`, `pointPick`, `drag`). */
export interface QueryOptions {
  /** Include sensors in the result. Default false — a trigger volume is not
   *  something the player can see, click or blow up. */
  sensors?: boolean;
  /** Return false to ignore a body, e.g. to skip the level geometry. */
  filter?: (body: Body2D) => boolean;
}

/** Options for `drag()`. */
export interface DragOptions extends QueryOptions {
  /** Pull budget as a multiple of the grabbed body's mass — how hard the drag
   *  is allowed to yank. Default 1000 (Box2D's own testbed figure): enough to
   *  lift anything reasonable, low enough that a body wedged under a pile
   *  stays wedged. */
  strength?: number;
  /** Response speed in Hz — lower is springier, and the body lags the pointer
   *  further. Default 5. */
  frequency?: number;
  /** Springiness: 0 wobbles forever, 1 is critically damped. Default 0.7. */
  damping?: number;
}

/** A live pointer grab from `drag()` — a soft spring between the pointer and
 *  the point on the body that was grabbed, so the body still collides with
 *  everything on the way instead of teleporting through it. */
export interface Drag2D {
  /** The body being dragged. */
  readonly body: Body2D;
  /** Pull toward a new pointer position, in px — call it every frame the
   *  pointer is down. */
  move(x: number, y: number): void;
  /** Let go. Idempotent, and safe after the body has been destroyed. */
  release(): void;
  /** Escape hatch: the underlying planck joint. */
  readonly raw: MouseJoint;
}

/** A physics world. Create bodies, call `step` once per fixed update, read
 *  positions in `draw`. */
export interface Physics2DWorld {
  /** Advance the simulation — call once per fixed step with `stepMs`. */
  step(stepMs: number): void;
  /** A box body centered at (x, y), w×h px. */
  box(x: number, y: number, w: number, h: number, opts?: BodyOptions): Body2D;
  /** A circle body centered at (x, y), radius r px. */
  circle(x: number, y: number, r: number, opts?: BodyOptions): Body2D;
  /** A containment frame around the inside of the rect — walls/floor/ceiling
   *  for a contained scene. On resize, call `set()` on the returned frame:
   *  the walls glide to the new rect kinematically, sweeping bodies along
   *  physically instead of leaving them stranded. */
  walls(x: number, y: number, w: number, h: number, opts?: WallsOptions): Walls2D;
  /** A convex polygon body centered at (x, y). `points` are px offsets from
   *  that center — a triangle, a hexagon, a ship hull:
   *
   *      phys.polygon(x, y, [{ x: 0, y: -20 }, { x: 16, y: 12 }, { x: -16, y: 12 }]);
   *
   *  Box2D takes the CONVEX HULL of what you pass (so winding doesn't matter,
   *  and a dent in your outline is silently filled in) and caps it at 8
   *  vertices. Build concave shapes as several bodies, or weld convex pieces. */
  polygon(x: number, y: number, points: { x: number; y: number }[], opts?: BodyOptions): Body2D;
  /** A static line strip through world points (px) — hills, cave walls, a
   *  race track's edge. Zero thickness and no inside, so it is scenery to
   *  collide with, not an object: fast movers should be `bullet` bodies.
   *
   *      phys.chain(ridgePoints, { friction: 0.6 }); */
  chain(points: { x: number; y: number }[], opts?: ChainOptions): Body2D;
  /** Hinge two bodies together at a world point (px). Bodies rotate freely
   *  around it — or drive it with `motor()`. */
  pin(a: Body2D, b: Body2D, x: number, y: number): Pin2D;
  /** Hold two bodies a fixed distance apart (their centers): a rope, a tow
   *  line, or — with `stiffness` — a spring. Default length is how far apart
   *  they already are, so build the scene, then rope it. */
  rope(a: Body2D, b: Body2D, opts?: RopeOptions): Rope2D;
  /** Let two bodies slide along one axis relative to each other, and nothing
   *  else: a lift, a sliding door, a piston. The axis is a direction in world
   *  px (it gets normalized); the joint anchors where `b` sits now:
   *
   *      const lift = phys.slider(ground, platform, 0, -1, { min: 0, max: 200 });
   *      lift.motor(120);   // rises at 120 px/s until it hits `max` */
  slider(a: Body2D, b: Body2D, axisX: number, axisY: number, opts?: SliderOptions): Slider2D;
  /** Fuse two bodies at a world point (px) so they move as one — until you
   *  `destroy()` it. Debris sticking to a wall, a two-part boss. */
  weld(a: Body2D, b: Body2D, x: number, y: number): Weld2D;
  /** The first body a segment from (x1, y1) to (x2, y2) hits, or null if the
   *  line is clear. Line of sight, a hitscan shot, a ground probe under a
   *  character:
   *
   *      const hit = phys.raycast(x, y, x, y + 40, { filter: (b) => b !== self });
   *      if (hit) grounded = true;
   *
   *  The returned object is reused between calls — copy what you keep. */
  raycast(x1: number, y1: number, x2: number, y2: number, opts?: RaycastOptions): RayHit | null;
  /** Every body along the segment, nearest first. Allocates a fresh array and
   *  fresh hits, so it's the one to hold on to — a piercing shot, a laser
   *  that dims per body it crosses. */
  raycastAll(x1: number, y1: number, x2: number, y2: number, opts?: RaycastOptions): RayHit[];
  /** Every body overlapping the rect (top-left x/y plus size, like `walls`),
   *  in no particular order. Area effects, "what's in the blast radius",
   *  selection rectangles:
   *
   *      for (const b of phys.queryAABB(x - r, y - r, r * 2, r * 2)) {
   *        b.applyImpulse((b.x - x) * 20, (b.y - y) * 20);
   *      }
   *
   *  Bodies are matched by their bounding box, not their exact shape — a
   *  circle counts as its square. Allocates the result array. */
  queryAABB(x: number, y: number, w: number, h: number, opts?: QueryOptions): Body2D[];
  /** The body under a point, or null. This one is exact (a click in a circle's
   *  corner misses), which is what click-to-select wants. A dynamic body wins
   *  over the static scenery it rests on; otherwise ties go to whichever the
   *  broadphase reaches first. */
  pointPick(x: number, y: number, opts?: QueryOptions): Body2D | null;
  /** Grab the dynamic body under (x, y) with the pointer and return the live
   *  grab, or null if nothing is there. The body is pulled by a spring rather
   *  than teleported, so it keeps colliding with the world while it moves:
   *
   *      if (Pointer.pressed) grab = phys.drag(Pointer.x, Pointer.y);
   *      grab?.move(Pointer.x, Pointer.y);
   *      if (Pointer.released) { grab?.release(); grab = null; }
   *
   *  Static and kinematic bodies are never grabbed — a spring cannot move
   *  them, so a grab on the floor would just look broken. */
  drag(x: number, y: number, opts?: DragOptions): Drag2D | null;
  /** Called when two bodies begin touching. Returns an unsubscribe. */
  onContact(cb: (a: Body2D, b: Body2D) => void): () => void;
  /** Called when two bodies stop touching — the exit half of `onContact`.
   *  Note a body destroyed mid-overlap does NOT report a separation, so treat
   *  destruction as its own exit. Returns an unsubscribe. */
  onContactEnd(cb: (a: Body2D, b: Body2D) => void): () => void;
  /** Live body count (includes static bodies). */
  readonly count: number;
  /** Escape hatch: the underlying planck world. */
  readonly raw: World;
}

const fixtureDef = (o: BodyOptions) => ({
  density: o.density ?? 1,
  friction: o.friction ?? 0.3,
  restitution: o.restitution ?? 0,
  isSensor: o.isSensor ?? false,
  filterCategoryBits: o.category ?? 0x0001,
  filterMaskBits: o.mask ?? 0xffff,
  filterGroupIndex: o.group ?? 0,
});

/** Create an isolated physics world. */
export function world(opts: Physics2DOptions = {}): Physics2DWorld {
  const ppm = opts.pixelsPerMeter ?? 50;
  const g = opts.gravity ?? { x: 0, y: 1800 };
  const pw = new World({ gravity: new Vec2(g.x / ppm, g.y / ppm) });

  // planck copies the vectors handed to setPosition/setLinearVelocity/
  // applyForce/applyLinearImpulse, so one scratch serves every setter instead
  // of minting a Vec2 per assignment (these run per body per step).
  const v = new Vec2(0, 0);
  const at = (x: number, y: number): Vec2 => {
    v.x = x;
    v.y = y;
    return v;
  };

  // Active wall frames whose slabs may be gliding toward new targets.
  interface WallSweep {
    slabs: PlanckBody[];
    targets: Vec2[];
    speed: number; // m/s
  }
  const sweeps = new Set<WallSweep>();

  // Steer each gliding slab: arrive exactly (velocity sized to land on the
  // target this step) or cruise toward it at sweep speed.
  const steer = (ws: WallSweep, dt: number) => {
    ws.slabs.forEach((slab, i) => {
      const pos = slab.getPosition();
      const dx = ws.targets[i].x - pos.x;
      const dy = ws.targets[i].y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) {
        slab.setLinearVelocity(at(0, 0));
      } else if (dist <= ws.speed * dt) {
        slab.setLinearVelocity(at(dx / dt, dy / dt));
      } else {
        slab.setLinearVelocity(at((dx / dist) * ws.speed, (dy / dist) * ws.speed));
      }
    });
  };

  // Box2D locks the world during a step; destroys requested from inside a
  // contact callback are buffered and applied when the step ends.
  const pendingDestroy: PlanckBody[] = [];
  const pendingJoints: Joint[] = [];
  const destroyBody = (b: PlanckBody) => {
    if (pw.isLocked()) pendingDestroy.push(b);
    else pw.destroyBody(b);
  };
  const destroyJoint = (j: Joint) => {
    if (pw.isLocked()) pendingJoints.push(j);
    else pw.destroyJoint(j);
  };

  const wrap = (raw: PlanckBody, data: unknown): Body2D => {
    const body: Body2D = {
      get x() {
        return raw.getPosition().x * ppm;
      },
      set x(n) {
        raw.setPosition(at(n / ppm, raw.getPosition().y));
      },
      get y() {
        return raw.getPosition().y * ppm;
      },
      set y(n) {
        raw.setPosition(at(raw.getPosition().x, n / ppm));
      },
      get rot() {
        return raw.getAngle();
      },
      set rot(v) {
        raw.setAngle(v);
      },
      get vx() {
        return raw.getLinearVelocity().x * ppm;
      },
      set vx(n) {
        raw.setLinearVelocity(at(n / ppm, raw.getLinearVelocity().y));
      },
      get vy() {
        return raw.getLinearVelocity().y * ppm;
      },
      set vy(n) {
        raw.setLinearVelocity(at(raw.getLinearVelocity().x, n / ppm));
      },
      get spin() {
        return raw.getAngularVelocity();
      },
      set spin(v) {
        raw.setAngularVelocity(v);
      },
      get awake() {
        return raw.isAwake();
      },
      wake() {
        raw.setAwake(true);
      },
      get sensor() {
        const f = raw.getFixtureList();
        return f ? f.isSensor() : false;
      },
      set sensor(on) {
        for (let f = raw.getFixtureList(); f; f = f.getNext()) f.setSensor(on);
      },
      data,
      applyImpulse(ix, iy) {
        raw.applyLinearImpulse(at(ix / ppm, iy / ppm), raw.getWorldCenter(), true);
      },
      applyForce(fx, fy) {
        raw.applyForce(at(fx / ppm, fy / ppm), raw.getWorldCenter(), true);
      },
      destroy() {
        destroyBody(raw);
      },
      get raw() {
        return raw;
      },
    };
    raw.setUserData(body);
    return body;
  };

  const makeBody = (x: number, y: number, o: BodyOptions) =>
    pw.createBody({
      type: o.type ?? "dynamic",
      position: new Vec2(x / ppm, y / ppm),
      fixedRotation: o.fixedRotation ?? false,
      bullet: o.bullet ?? false,
      linearDamping: o.linearDamping ?? 0,
      angularDamping: o.angularDamping ?? 0,
    });

  // ----- raycasting -----
  // One live hit handed to the visitor, one returned to the caller: the
  // nearest-hit search overwrites the latter as better hits turn up, so
  // `raycast` allocates nothing per call.
  const blankHit = (): RayHit => ({
    body: null as unknown as Body2D,
    x: 0,
    y: 0,
    nx: 0,
    ny: 0,
    distance: 0,
    fraction: 0,
  });
  const rayFrom = new Vec2(0, 0);
  const rayTo = new Vec2(0, 0);
  const liveHit = blankHit();
  const scratchHit = blankHit();

  const copyHit = (from: RayHit, to: RayHit): RayHit => {
    to.body = from.body;
    to.x = from.x;
    to.y = from.y;
    to.nx = from.nx;
    to.ny = from.ny;
    to.distance = from.distance;
    to.fraction = from.fraction;
    return to;
  };

  const cast = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    o: RaycastOptions,
    onHit: (hit: RayHit) => void,
    all = false,
  ) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) return; // a zero-length ray has no direction to normalize
    rayFrom.x = x1 / ppm;
    rayFrom.y = y1 / ppm;
    rayTo.x = x2 / ppm;
    rayTo.y = y2 / ppm;
    let clip = 1;
    pw.rayCast(rayFrom, rayTo, (fixture, point, normal, fraction) => {
      // -1 means "ignore this fixture and keep going" — the ray is unaffected.
      if (!o.sensors && fixture.isSensor()) return -1;
      const body = fixture.getBody().getUserData() as Body2D | null;
      if (!body) return -1;
      if (o.filter && !o.filter(body)) return -1;
      liveHit.body = body;
      liveHit.x = point.x * ppm;
      liveHit.y = point.y * ppm;
      liveHit.nx = normal.x;
      liveHit.ny = normal.y;
      liveHit.fraction = fraction;
      liveHit.distance = fraction * len;
      onHit(liveHit);
      // Collecting every hit keeps the ray full length; the nearest-hit search
      // clips it so the broadphase can skip whatever lies past the best so far.
      if (all) return 1;
      clip = Math.min(clip, fraction);
      return clip;
    });
  };

  // ----- world queries -----
  // The rect handed to the broadphase, the tight shape box re-tested against
  // it, and the point `pointPick`/`drag` probe with: all reused, so a query
  // per frame allocates only its result.
  const queryBox = new AABB(new Vec2(0, 0), new Vec2(0, 0));
  const tightBox = new AABB(new Vec2(0, 0), new Vec2(0, 0));
  const probe = new Vec2(0, 0);

  const setQueryBox = (x: number, y: number, w: number, h: number) => {
    queryBox.lowerBound.x = x / ppm;
    queryBox.lowerBound.y = y / ppm;
    queryBox.upperBound.x = (x + w) / ppm;
    queryBox.upperBound.y = (y + h) / ppm;
  };

  // The wrapped body behind a fixture, if the query wants it at all.
  const candidate = (fixture: Fixture, o: QueryOptions): Body2D | null => {
    if (!o.sensors && fixture.isSensor()) return null;
    const body = fixture.getBody().getUserData() as Body2D | null;
    if (!body) return null; // created straight on `phys.raw` — no wrapper
    return o.filter && !o.filter(body) ? null : body;
  };

  const pickAt = (x: number, y: number, o: QueryOptions): Body2D | null => {
    probe.x = x / ppm;
    probe.y = y / ppm;
    setQueryBox(x, y, 0, 0);
    let found: Body2D | null = null;
    pw.queryAABB(queryBox, (fixture) => {
      const body = candidate(fixture, o);
      if (!body || !fixture.testPoint(probe)) return true;
      // A crate resting on the floor overlaps the floor's box at its feet; the
      // crate is what the player meant, so a dynamic hit wins and ends it.
      const dynamic = fixture.getBody().isDynamic();
      if (!found || dynamic) found = body;
      return !dynamic;
    });
    return found;
  };

  // The half of every joint handle that is the same for all of them: a
  // deferred, idempotent destroy (destroying either joined body already took
  // the joint with it) plus the raw escape hatch.
  const handle = <J extends Joint>(joint: J): Joint2D<J> => {
    let dead = false;
    return {
      destroy() {
        if (dead) return;
        dead = true;
        destroyJoint(joint);
      },
      raw: joint,
    };
  };

  // A mouse joint pulls a body toward a point relative to some other body;
  // that other body is this fixture-less static anchor, made on first drag.
  let ground: PlanckBody | null = null;
  const groundBody = (): PlanckBody => (ground ??= pw.createBody());

  type ContactCb = (a: Body2D, b: Body2D) => void;
  const beginCbs = new Set<ContactCb>();
  const endCbs = new Set<ContactCb>();
  const dispatch = (cbs: Set<ContactCb>, contact: Contact) => {
    if (cbs.size === 0) return;
    // Bodies created straight on `phys.raw` carry no wrapper; skip them rather
    // than handing a listener an undefined `a`.
    const a = contact.getFixtureA().getBody().getUserData() as Body2D | null;
    const b = contact.getFixtureB().getBody().getUserData() as Body2D | null;
    if (!a || !b) return;
    for (const cb of cbs) cb(a, b);
  };
  pw.on("begin-contact", (contact) => dispatch(beginCbs, contact));
  pw.on("end-contact", (contact) => dispatch(endCbs, contact));

  return {
    step(stepMs) {
      const dt = stepMs / 1000;
      for (const ws of sweeps) steer(ws, dt);
      pw.step(dt, 8, 3);
      // Joints first: destroying a body takes its joints with it, so a joint
      // queued alongside its body would otherwise be destroyed twice.
      for (const j of pendingJoints) pw.destroyJoint(j);
      pendingJoints.length = 0;
      for (const b of pendingDestroy) pw.destroyBody(b);
      pendingDestroy.length = 0;
    },

    box(x, y, w, h, o = {}) {
      const raw = makeBody(x, y, o);
      raw.createFixture(new Box(w / 2 / ppm, h / 2 / ppm), fixtureDef(o));
      return wrap(raw, o.data);
    },

    circle(x, y, r, o = {}) {
      const raw = makeBody(x, y, o);
      raw.createFixture(new Circle(r / ppm), fixtureDef(o));
      return wrap(raw, o.data);
    },

    polygon(x, y, points, o = {}) {
      const raw = makeBody(x, y, o);
      raw.createFixture(
        new Polygon(points.map((p) => new Vec2(p.x / ppm, p.y / ppm))),
        fixtureDef(o),
      );
      return wrap(raw, o.data);
    },

    chain(points, o = {}) {
      // The body sits at the origin and the chain carries world coordinates,
      // so the points a caller drew the terrain with are the points it gets.
      const raw = pw.createBody({ type: "static" });
      raw.createFixture(
        new Chain(
          points.map((p) => new Vec2(p.x / ppm, p.y / ppm)),
          o.loop ?? false,
        ),
        {
          friction: o.friction ?? 0.3,
          restitution: o.restitution ?? 0,
          filterCategoryBits: o.category ?? 0x0001,
          filterMaskBits: o.mask ?? 0xffff,
        },
      );
      return wrap(raw, o.data);
    },

    walls(x, y, w, h, o = {}) {
      const t = o.thickness ?? 100;
      const speed = (o.sweepSpeed ?? 1200) / ppm; // m/s
      const def = fixtureDef(o);
      // Four kinematic slabs (top, bottom, left, right). Kinematic so they can
      // sweep to a new rect with real velocity, pushing bodies ahead of them.
      const slabs = Array.from({ length: 4 }, () => {
        const slab = pw.createBody({ type: "kinematic" });
        wrap(slab, o.data); // sets userData, so onContact sees a Body2D
        return slab;
      });

      // (Re)build each slab's fixture for the rect's dimensions and return its
      // target center. Slabs overhang by `t` on both ends so the corners stay
      // sealed even mid-glide.
      const layout = (rx: number, ry: number, rw: number, rh: number) => {
        const sizes = [
          [rw / 2 + t, t / 2], // top
          [rw / 2 + t, t / 2], // bottom
          [t / 2, rh / 2 + t], // left
          [t / 2, rh / 2 + t], // right
        ];
        const targets = [
          new Vec2((rx + rw / 2) / ppm, (ry - t / 2) / ppm),
          new Vec2((rx + rw / 2) / ppm, (ry + rh + t / 2) / ppm),
          new Vec2((rx - t / 2) / ppm, (ry + rh / 2) / ppm),
          new Vec2((rx + rw + t / 2) / ppm, (ry + rh / 2) / ppm),
        ];
        slabs.forEach((slab, i) => {
          const old = slab.getFixtureList();
          if (old) slab.destroyFixture(old);
          slab.createFixture(new Box(sizes[i][0] / ppm, sizes[i][1] / ppm), def);
        });
        return targets;
      };

      const ws: WallSweep = { slabs, targets: layout(x, y, w, h), speed };
      // First placement snaps into position — nothing to sweep yet.
      slabs.forEach((slab, i) => slab.setPosition(ws.targets[i]));
      sweeps.add(ws);

      return {
        set(nx, ny, nw, nh) {
          ws.targets = layout(nx, ny, nw, nh);
          // Wake everything: the floor gliding away under a sleeper is
          // otherwise unnoticed, and sleepers ignore approaching walls.
          for (let b = pw.getBodyList(); b; b = b.getNext()) {
            if (b.isDynamic()) b.setAwake(true);
          }
        },
        destroy() {
          sweeps.delete(ws);
          for (const slab of slabs) destroyBody(slab);
        },
      };
    },

    pin(a, b, x, y) {
      const joint = pw.createJoint(
        new RevoluteJoint({}, a.raw, b.raw, new Vec2(x / ppm, y / ppm)),
      )!;
      return {
        ...handle(joint),
        motor(speed, maxTorque = 1000) {
          joint.enableMotor(true);
          joint.setMotorSpeed(speed);
          joint.setMaxMotorTorque(maxTorque);
        },
      };
    },

    rope(a, b, o = {}) {
      const joint = pw.createJoint(
        new DistanceJoint(
          {
            // A distance joint with length 0 is degenerate, and planck says so
            // loudly — clamp anything the caller (or coincident bodies) hands
            // us to something the solver can work with.
            length: Math.max(0.01, (o.length ?? Math.hypot(b.x - a.x, b.y - a.y)) / ppm),
            frequencyHz: o.stiffness ?? 0,
            dampingRatio: o.damping ?? 0.7,
          },
          a.raw,
          b.raw,
          new Vec2(a.x / ppm, a.y / ppm),
          new Vec2(b.x / ppm, b.y / ppm),
        ),
      )!;
      return {
        ...handle(joint),
        setLength(px) {
          joint.setLength(Math.max(0.01, px / ppm));
          // A hanging load goes to sleep; the winch has to rouse it, or the
          // new length only takes effect the next time something else does.
          a.wake();
          b.wake();
        },
      };
    },

    slider(a, b, axisX, axisY, o = {}) {
      const len = Math.hypot(axisX, axisY) || 1; // planck needs a unit axis
      const joint = pw.createJoint(
        new PrismaticJoint(
          {
            enableLimit: o.min !== undefined || o.max !== undefined,
            lowerTranslation: (o.min ?? 0) / ppm,
            upperTranslation: (o.max ?? 0) / ppm,
          },
          a.raw,
          b.raw,
          new Vec2(b.x / ppm, b.y / ppm),
          new Vec2(axisX / len, axisY / len),
        ),
      )!;
      return {
        ...handle(joint),
        motor(speed, maxForce = 1000) {
          joint.enableMotor(true);
          joint.setMotorSpeed(speed / ppm);
          joint.setMaxMotorForce(maxForce);
        },
        get travel() {
          return joint.getJointTranslation() * ppm;
        },
      };
    },

    weld(a, b, x, y) {
      return handle(pw.createJoint(new WeldJoint({}, a.raw, b.raw, new Vec2(x / ppm, y / ppm)))!);
    },

    raycast(x1, y1, x2, y2, o = {}) {
      let best = -1;
      cast(x1, y1, x2, y2, o, (hit) => {
        // planck visits proxies in broadphase order, not near-to-far, and
        // clipping only prunes what comes after — so track the nearest here
        // rather than trusting the last callback to be the closest.
        if (best >= 0 && hit.fraction >= best) return;
        best = hit.fraction;
        copyHit(hit, scratchHit);
      });
      return best < 0 ? null : scratchHit;
    },

    raycastAll(x1, y1, x2, y2, o = {}) {
      const hits: RayHit[] = [];
      cast(x1, y1, x2, y2, o, (hit) => hits.push(copyHit(hit, blankHit())), true);
      hits.sort((a, b) => a.fraction - b.fraction);
      return hits;
    },

    queryAABB(x, y, w, h, o = {}) {
      const found: Body2D[] = [];
      setQueryBox(x, y, w, h);
      pw.queryAABB(queryBox, (fixture) => {
        const body = candidate(fixture, o);
        if (body && !found.includes(body)) {
          // The broadphase compares FAT proxy boxes (planck pads them so small
          // movements don't rebuild the tree), so a body just outside the rect
          // gets reported — re-test against the shape's own box.
          fixture.getShape().computeAABB(tightBox, fixture.getBody().getTransform(), 0);
          if (AABB.testOverlap(tightBox, queryBox)) found.push(body);
        }
        return true; // visit every proxy in the rect
      });
      return found;
    },

    pointPick(x, y, o = {}) {
      return pickAt(x, y, o);
    },

    drag(x, y, o = {}) {
      const body = pickAt(x, y, {
        ...o,
        filter: (b) => b.raw.isDynamic() && (!o.filter || o.filter(b)),
      });
      if (!body) return null;
      // planck anchors the spring at the world point it was created with, so
      // grabbing a crate by its corner keeps it hanging by that corner.
      probe.x = x / ppm;
      probe.y = y / ppm;
      const joint = pw.createJoint(
        new MouseJoint(
          {
            maxForce: (o.strength ?? 1000) * body.raw.getMass(),
            frequencyHz: o.frequency ?? 5,
            dampingRatio: o.damping ?? 0.7,
          },
          groundBody(),
          body.raw,
          probe,
        ),
      )!;
      body.wake(); // a sleeping body ignores the spring until something rouses it
      let dead = false;
      return {
        body,
        move(nx, ny) {
          if (dead) return;
          joint.setTarget(at(nx / ppm, ny / ppm));
          body.wake();
        },
        release() {
          // Idempotent, and a no-op if the body was destroyed mid-drag: that
          // already took the joint with it.
          if (dead) return;
          dead = true;
          destroyJoint(joint);
        },
        get raw() {
          return joint;
        },
      };
    },

    onContact(cb) {
      beginCbs.add(cb);
      return () => beginCbs.delete(cb);
    },

    onContactEnd(cb) {
      endCbs.add(cb);
      return () => endCbs.delete(cb);
    },

    get count() {
      return pw.getBodyCount();
    },

    get raw() {
      return pw;
    },
  };
}

// ---------- ECS integration ----------

/** The standard body-holding component: `{ body: Body2D }`. Spawn it next to
 *  the built-in Sprite and `attach()` keeps the two in sync. */
export const Phys = component<{ body: Body2D }>("Phys2D");

/** Options for `attach()`. */
export interface AttachOptions {
  /** Milliseconds per fixed step. Default 1000/60 — `Loop.step`. */
  stepMs?: number;
}

/** Wire a physics world into an ECS world: registers a `phys2d:step` system
 *  that ticks the simulation and a `phys2d:sync` system that copies each
 *  body's transform (position, rotation — nothing else) into its Sprite.
 *  After this, an entity is one spawn call away from being a simulated,
 *  rendered thing:
 *
 *    Physics2D.attach(world, phys);
 *    world.spawn(
 *      Sprites.Sprite.with({ x, y, img: crateTex, w: s, h: s }),
 *      Physics2D.Phys.with({ body: phys.box(x, y, s, s) }),
 *    );
 *
 *  Presentation stays yours — want sleeping bodies dimmed, or speed tinting?
 *  Register your own system after this one and set `alpha`/whatever there.
 *  Despawning is also yours: destroy the body, then despawn the entity —
 *  the sync system can't know an entity is about to go. */
export function attach(ecs: EcsWorld, phys: Physics2DWorld, opts: AttachOptions = {}): void {
  const stepMs = opts.stepMs ?? 1000 / 60;
  ecs.system("phys2d:step", () => phys.step(stepMs));
  // `each`, not `query`: this runs for every simulated body every step, and
  // the tuple-yielding `query` allocates a row array per entity.
  ecs.system("phys2d:sync", (w) => {
    w.each(Sprite, Phys, (_e, s, p) => {
      s.x = p.body.x;
      s.y = p.body.y;
      s.rot = p.body.rot;
    });
  });
}

/** Namespace-style export, matching `Minimotor.*` ergonomics:
 *  `import { Physics2D } from "minimotor/physics2d"` → `Physics2D.world()`. */
export const Physics2D = { world, attach, Phys };
