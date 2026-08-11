import * as RAPIER from "@dimforge/rapier3d-compat";

/** A plain three-dimensional vector used at the physics boundary. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A plain orientation quaternion used at the physics boundary. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type RigidBody3DType = "fixed" | "dynamic" | "kinematic-position" | "kinematic-velocity";

export interface Physics3DOptions {
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

export type Collider3DShape =
  | { type: "ball"; radius: number }
  | { type: "cuboid"; halfExtents: Vec3 }
  | { type: "cylinder"; halfHeight: number; radius: number }
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
  | { type: "convexHull"; points: Float32Array };

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

export interface Physics3DWorld {
  readonly raw: RAPIER.World;
  createBody(options?: RigidBody3DOptions): Physics3DBody;
  createCollider(
    body: Physics3DBody,
    shape: Collider3DShape,
    options?: Collider3DOptions,
  ): RAPIER.Collider;
  /** Cast a ray and return the nearest hit, or `null` if it reaches nothing.
   *
   * `direction` need not be normalized, but `distance` is measured in its
   * units, so an unnormalized one rescales the result.
   *
   * Rapier rebuilds its query acceleration structures during `step`, so a ray
   * sees the world as of the last step; a collider created since then is
   * invisible to it. Step once after building a level before querying it. */
  raycast(origin: Vec3, direction: Vec3, options?: Raycast3DOptions): Raycast3DHit | null;
  step(): void;
  dispose(): void;
}

let rapierReady: Promise<void> | undefined;

function ensureRapier(): Promise<void> {
  return (rapierReady ??= RAPIER.init());
}

/** Create a generic 3D rigid-body world backed by Rapier. */
export async function createPhysics3D(options: Physics3DOptions = {}): Promise<Physics3DWorld> {
  await ensureRapier();
  const raw = new RAPIER.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
  if (options.timestep !== undefined) raw.timestep = options.timestep;
  if (options.solverIterations !== undefined) {
    raw.integrationParameters.numSolverIterations = options.solverIterations;
  }

  return {
    raw,
    createBody(bodyOptions = {}) {
      const descriptor = createRigidBodyDescriptor(bodyOptions);
      const body = raw.createRigidBody(descriptor);
      return wrapBody(body);
    },
    createCollider(body, shape, colliderOptions = {}) {
      const descriptor = createColliderDescriptor(shape);
      const position = colliderOptions.position;
      if (position) descriptor.setTranslation(position.x, position.y, position.z);
      if (colliderOptions.rotation) descriptor.setRotation(colliderOptions.rotation);
      if (colliderOptions.friction !== undefined) descriptor.setFriction(colliderOptions.friction);
      if (colliderOptions.restitution !== undefined)
        descriptor.setRestitution(colliderOptions.restitution);
      if (colliderOptions.frictionCombine) {
        descriptor.setFrictionCombineRule(COMBINE_RULES[colliderOptions.frictionCombine]);
      }
      if (colliderOptions.restitutionCombine) {
        descriptor.setRestitutionCombineRule(COMBINE_RULES[colliderOptions.restitutionCombine]);
      }
      if (colliderOptions.density !== undefined) descriptor.setDensity(colliderOptions.density);
      if (colliderOptions.sensor !== undefined) descriptor.setSensor(colliderOptions.sensor);
      return raw.createCollider(descriptor, body.raw);
    },
    raycast(origin, direction, rayOptions = {}) {
      const ray = new RAPIER.Ray(origin, direction);
      const exclude = rayOptions.exclude;
      const accept = rayOptions.filter;
      const skipping = exclude && exclude.length > 0;
      const predicate =
        skipping || accept
          ? (candidate: RAPIER.Collider) =>
              !(skipping && exclude.includes(candidate)) && (!accept || accept(candidate))
          : undefined;
      const hit = raw.castRayAndGetNormal(
        ray,
        rayOptions.maxDistance ?? 1000,
        rayOptions.solid ?? true,
        undefined,
        undefined,
        undefined,
        undefined,
        predicate,
      );
      if (!hit) return null;
      const distance = hit.timeOfImpact;
      return {
        distance,
        point: {
          x: origin.x + direction.x * distance,
          y: origin.y + direction.y * distance,
          z: origin.z + direction.z * distance,
        },
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
        collider: hit.collider,
      };
    },
    step() {
      raw.step();
    },
    dispose() {
      raw.free();
    },
  };
}

const COMBINE_RULES: Record<CoefficientCombine, RAPIER.CoefficientCombineRule> = {
  average: RAPIER.CoefficientCombineRule.Average,
  min: RAPIER.CoefficientCombineRule.Min,
  multiply: RAPIER.CoefficientCombineRule.Multiply,
  max: RAPIER.CoefficientCombineRule.Max,
};

function createRigidBodyDescriptor(options: RigidBody3DOptions): RAPIER.RigidBodyDesc {
  const descriptor =
    options.type === "fixed"
      ? RAPIER.RigidBodyDesc.fixed()
      : options.type === "kinematic-position"
        ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : options.type === "kinematic-velocity"
          ? RAPIER.RigidBodyDesc.kinematicVelocityBased()
          : RAPIER.RigidBodyDesc.dynamic();
  if (options.position) {
    descriptor.setTranslation(options.position.x, options.position.y, options.position.z);
  }
  if (options.canSleep !== undefined) descriptor.setCanSleep(options.canSleep);
  if (options.ccd !== undefined) descriptor.setCcdEnabled(options.ccd);
  if (options.lockRotation) descriptor.lockRotations();
  if (options.linearDamping !== undefined) descriptor.setLinearDamping(options.linearDamping);
  if (options.angularDamping !== undefined) descriptor.setAngularDamping(options.angularDamping);
  return descriptor;
}

function createColliderDescriptor(shape: Collider3DShape): RAPIER.ColliderDesc {
  switch (shape.type) {
    case "ball":
      return RAPIER.ColliderDesc.ball(shape.radius);
    case "cuboid":
      return RAPIER.ColliderDesc.cuboid(
        shape.halfExtents.x,
        shape.halfExtents.y,
        shape.halfExtents.z,
      );
    case "cylinder":
      return RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    case "trimesh":
      return RAPIER.ColliderDesc.trimesh(
        shape.vertices,
        shape.indices,
        shape.fixInternalEdges === false ? undefined : RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      );
    case "convexHull": {
      const descriptor = RAPIER.ColliderDesc.convexHull(shape.points);
      if (!descriptor) throw new Error("convexHull needs at least four non-coplanar points.");
      return descriptor;
    }
  }
}

function wrapBody(body: RAPIER.RigidBody): Physics3DBody {
  return {
    raw: body,
    get position() {
      const position = body.translation();
      return { x: position.x, y: position.y, z: position.z };
    },
    get velocity() {
      const velocity = body.linvel();
      return { x: velocity.x, y: velocity.y, z: velocity.z };
    },
    get speed() {
      const velocity = body.linvel();
      return Math.hypot(velocity.x, velocity.y, velocity.z);
    },
    isMoving() {
      return body.isMoving();
    },
    setPosition(position, wakeUp = true) {
      body.setTranslation(position, wakeUp);
    },
    setNextPosition(position) {
      body.setNextKinematicTranslation(position);
    },
    setRotation(rotation, wakeUp = true) {
      body.setRotation(rotation, wakeUp);
    },
    setNextRotation(rotation) {
      body.setNextKinematicRotation(rotation);
    },
    setVelocity(velocity, wakeUp = true) {
      body.setLinvel(velocity, wakeUp);
    },
    setAngularVelocity(velocity, wakeUp = true) {
      body.setAngvel(velocity, wakeUp);
    },
  };
}
