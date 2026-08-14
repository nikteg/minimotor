import { type Body as PlanckBody, DistanceJoint, type Joint, MouseJoint, PrismaticJoint, RevoluteJoint, WeldJoint, World } from "planck";
import { type Ecs as EcsWorld } from "../ecs/index.js";
/** Options for `Physics2D.world()`. */
export interface Physics2DOptions {
    /** World gravity in px/s². Default `{ x: 0, y: 1800 }` (canvas y is down). */
    gravity?: {
        x: number;
        y: number;
    };
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
    polygon(x: number, y: number, points: {
        x: number;
        y: number;
    }[], opts?: BodyOptions): Body2D;
    /** A static line strip through world points (px) — hills, cave walls, a
     *  race track's edge. Zero thickness and no inside, so it is scenery to
     *  collide with, not an object: fast movers should be `bullet` bodies.
     *
     *      phys.chain(ridgePoints, { friction: 0.6 }); */
    chain(points: {
        x: number;
        y: number;
    }[], opts?: ChainOptions): Body2D;
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
    /** Destroy every body and release this world. Idempotent. */
    destroy(): void;
}
/** Create an isolated physics world. */
export declare function world(opts?: Physics2DOptions): Physics2DWorld;
/** The standard body-holding component: `{ body: Body2D }`. Spawn it next to
 *  the built-in Sprite and `attach()` keeps the two in sync. */
export declare const Phys: import("../ecs/index.js").Component<{
    body: Body2D;
}>;
/** Options for `attach()`. */
export interface AttachOptions {
    /** Milliseconds per fixed step, normally `app.Loop.step`. */
    stepMs: number;
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
export declare function attach(ecs: EcsWorld, phys: Physics2DWorld, opts: AttachOptions): void;
