import type * as RAPIER from "@dimforge/rapier3d-compat";
import type { Vec3 } from "../math/vec3.js";
import { Quat } from "../math/quat.js";
/** The Rapier module `createPhysics3D` needs. `@dimforge/rapier3d-compat` and
 *  `@dimforge/rapier3d-deterministic-compat` share this TypeScript surface. */
export type Rapier3D = typeof import("@dimforge/rapier3d-compat");
export type RigidBody3DType = "fixed" | "dynamic" | "kinematic-position" | "kinematic-velocity";
export interface Physics3DOptions {
    /** The Rapier module to simulate with. The engine does not import one. */
    rapier: Rapier3D;
    gravity?: Vec3;
    /** Fixed simulation step in seconds. Defaults to 1/60. */
    timestep?: number;
    /** Rapier solver iterations. Defaults to Rapier's value. */
    solverIterations?: number;
}
export interface RigidBody3DOptions {
    type?: RigidBody3DType;
    position?: Vec3;
    canSleep?: boolean;
    ccd?: boolean;
    /** Stop the body from rotating at all. A rolling ball whose visual spin is
     *  animated rather than simulated wants this: without it, friction bleeds
     *  linear speed into angular speed and the two decay curves disagree. */
    lockRotation?: boolean;
    /** Velocity lost per second to the medium, as a proportion. */
    linearDamping?: number;
    angularDamping?: number;
}
/** How two touching colliders' friction or restitution combine into the one
 *  number the solver uses. Rapier's default is `average`; engines that model
 *  a frictionless surface (`0`) as genuinely frictionless need `multiply`,
 *  because averaging lets the other collider reintroduce the friction. */
export type CoefficientCombine = "average" | "min" | "multiply" | "max";
export interface Collider3DOptions {
    position?: Vec3;
    /** Orientation as a quaternion, relative to the body. */
    rotation?: Quat;
    friction?: number;
    restitution?: number;
    /** How this collider's friction combines with the other side's. Both
     *  colliders in a contact propose a rule and Rapier takes the stricter of
     *  the two, so setting it on one side is enough. */
    frictionCombine?: CoefficientCombine;
    restitutionCombine?: CoefficientCombine;
    density?: number;
    sensor?: boolean;
}
export type Collider3DShape = {
    type: "ball";
    radius: number;
} | {
    type: "cuboid";
    halfExtents: Vec3;
} | {
    type: "cylinder";
    halfHeight: number;
    radius: number;
}
/** An arbitrary triangle mesh. Static geometry only: a trimesh has no
 *  interior, so a dynamic body built from one tunnels and never rests. */
 | {
    type: "trimesh";
    vertices: Float32Array;
    indices: Uint32Array;
    /** Whether to weld the mesh and derive per-edge pseudo-normals so that
     *  contacts along a shared edge report the surface's normal instead of
     *  the edge's.
     *
     *  A trimesh is a bag of independent triangles: nothing in it says that
     *  two triangles meeting along an edge are one flat floor. A body sliding
     *  across that edge can be given a contact normal pointing out of the
     *  edge rather than out of the floor, and the solver duly launches it —
     *  a ball rolling over a perfectly flat but triangulated surface pops
     *  into the air for no visible reason. Rapier fixes this by consulting
     *  the neighbouring triangles' normals, which it can only do once the
     *  duplicate vertices are merged and the mesh knows who its neighbours
     *  are; that is why the flag it exposes bundles the two.
     *
     *  It also makes the mesh ONE-SIDED, which is worth knowing before a
     *  level goes quietly wrong. A plain trimesh has no front and no back:
     *  it collides from either direction, so a floor whose triangles are
     *  wound facing down still holds a ball up and nobody finds out. Once the
     *  pseudo-normals exist the same floor is a hole. Winding is load-bearing
     *  here in a way it is not anywhere else in the physics API.
     *
     *  On by default, because a floor that bounces is a bug in every game
     *  that has one. Turn it off for a mesh where the preprocessing is not
     *  worth it — a wall nothing slides along — for one whose surface really
     *  is meant to be faceted, or for one that has to be walked on from both
     *  sides. */
    fixInternalEdges?: boolean;
}
/** The convex hull of a point cloud — the dynamic-body counterpart to
 *  `trimesh`, and much cheaper to collide against. */
 | {
    type: "convexHull";
    points: Float32Array;
};
/** A small, inspectable view over one Rapier rigid body. The `raw` handle is
 * available for engine users who need an advanced Rapier operation; ordinary
 * game code can stay on this value-oriented API. */
export interface Physics3DBody {
    readonly raw: RAPIER.RigidBody;
    readonly position: Vec3;
    readonly velocity: Vec3;
    readonly speed: number;
    isMoving(): boolean;
    setPosition(position: Vec3, wakeUp?: boolean): void;
    /** Where a `kinematic-position` body should be by the end of the next step.
     *
     * Unlike `setPosition`, which teleports, this lets the solver see the motion
     * as motion: a body moved this way pushes what it runs into and carries what
     * rests on it, rather than appearing somewhere new with contacts already
     * overlapping. Rapier ignores it on any other body type. */
    setNextPosition(position: Vec3): void;
    /** Orientation as a quaternion. Teleports, like `setPosition`. */
    setRotation(rotation: Quat, wakeUp?: boolean): void;
    /** Where a `kinematic-position` body should be FACING by the end of the next
     *  step, the rotational half of `setNextPosition`.
     *
     *  Anything a turning body carries or sweeps through needs this rather than
     *  `setRotation`: a platform that teleports to its new angle leaves whatever
     *  was resting on it behind, and a paddle that teleports through a ball
     *  passes clean through instead of hitting it. Rapier ignores it on any
     *  other body type. */
    setNextRotation(rotation: Quat): void;
    setVelocity(velocity: Vec3, wakeUp?: boolean): void;
    setAngularVelocity(velocity: Vec3, wakeUp?: boolean): void;
}
/** Generic Rapier world ownership. It knows about bodies and shapes, but not
 * about any particular game, level, actor, or scoring rule. */
/** Where a ray met the first collider along it. */
export interface Raycast3DHit {
    /** Distance from the ray origin, in the units of a normalized direction. */
    distance: number;
    /** Contact point in world space. */
    point: Vec3;
    /** Outward surface normal at the contact point. */
    normal: Vec3;
    collider: RAPIER.Collider;
}
export interface Raycast3DOptions {
    /** Ignore anything past this distance. Defaults to 1000. */
    maxDistance?: number;
    /** Treat a ray starting inside a shape as hitting at distance 0 rather than
     * passing through to the far wall. Defaults to true. */
    solid?: boolean;
    /** Skip these colliders — usually the caster's own. */
    exclude?: readonly RAPIER.Collider[];
    /** Consider only colliders this accepts. Applied on top of `exclude`, and
     * the way to cast against one layer of a world — a ray that should see the
     * ground but not the props standing on it. */
    filter?: (collider: RAPIER.Collider) => boolean;
}
export interface Query3DOptions {
    /** Consider only colliders this accepts. */
    filter?: (collider: RAPIER.Collider) => boolean;
}
/** What every joint factory hands back: a way to let go, and the raw joint.
 *  `destroy()` is idempotent — destroying either joined body already takes
 *  the joint with it. */
export interface Physics3DJoint {
    /** Escape hatch: the underlying Rapier impulse joint. */
    readonly raw: RAPIER.ImpulseJoint;
    /** Remove the joint. */
    destroy(): void;
}
/** What touched, handed to an `onContact` listener.
 *
 *  Valid only for the duration of the call: the record is reused and the Rapier
 *  colliders it names may be destroyed by the next step. Copy anything you keep. */
export interface Contact3D {
    /** The collider on `a` that touched, and the one on `b`. One body can carry
     *  many — a whole static level is often a single fixed body — so this is
     *  what says which part was hit. */
    colliderA: RAPIER.Collider;
    colliderB: RAPIER.Collider;
    /** Unit contact normal in world space, pointing from `a`'s surface towards
     *  `b`. Zero on the rare pair that reports a start with no manifold yet. */
    normal: Vec3;
}
export interface Physics3DWorld {
    readonly raw: RAPIER.World;
    createBody(options?: RigidBody3DOptions): Physics3DBody;
    createCollider(body: Physics3DBody, shape: Collider3DShape, options?: Collider3DOptions): RAPIER.Collider;
    /** Cast a ray and return the nearest hit, or `null` if it reaches nothing.
     *
     * `direction` need not be normalized, but `distance` is measured in its
     * units, so an unnormalized one rescales the result.
     *
     * Rapier rebuilds its query acceleration structures during `step`, so a ray
     * sees the world as of the last step; a collider created since then is
     * invisible to it. Step once after building a level before querying it. */
    raycast(origin: Vec3, direction: Vec3, options?: Raycast3DOptions): Raycast3DHit | null;
    /** Every collider whose AABB overlaps the box, in no particular order.
     *  Allocates the result array. Rapier rebuilds query structures during
     *  `step`, so a collider created since the last step is invisible. */
    queryAabb(min: Vec3, max: Vec3, opts?: Query3DOptions): RAPIER.Collider[];
    /** The nearest collider containing the point, or `null`. Exact (a point in
     *  a cuboid's AABB but outside the shape misses). Same step caveat as
     *  `queryAabb`. */
    pointPick(point: Vec3, opts?: Query3DOptions): RAPIER.Collider | null;
    /** Hinge two bodies at a world-space point, free to rotate about `axis`. */
    revolute(a: Physics3DBody, b: Physics3DBody, anchor: Vec3, axis: Vec3): Physics3DJoint;
    /** Ball/socket: two bodies share a world-space point, free to tumble. */
    spherical(a: Physics3DBody, b: Physics3DBody, anchor: Vec3): Physics3DJoint;
    /** Weld two bodies at a world-space point, locking the current relative pose. */
    fixed(a: Physics3DBody, b: Physics3DBody, anchor: Vec3): Physics3DJoint;
    /** Called when two bodies begin touching. Returns an unsubscribe. */
    onContact(cb: (a: Physics3DBody, b: Physics3DBody, contact: Contact3D) => void): () => void;
    /** Called when two bodies stop touching — the exit half of `onContact`.
     *  A body destroyed mid-overlap does not report a separation, so treat
     *  destruction as its own exit. Returns an unsubscribe. */
    onContactEnd(cb: (a: Physics3DBody, b: Physics3DBody) => void): () => void;
    step(): void;
    dispose(): void;
}
/** Create a generic 3D rigid-body world backed by the Rapier module you pass. */
export declare function createPhysics3D(options: Physics3DOptions): Promise<Physics3DWorld>;
