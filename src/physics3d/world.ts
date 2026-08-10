import * as RAPIER from "@dimforge/rapier3d-compat";

/** A plain three-dimensional vector used at the physics boundary. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
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
}

export interface Collider3DOptions {
  position?: Vec3;
  friction?: number;
  restitution?: number;
  density?: number;
  sensor?: boolean;
}

export type Collider3DShape =
  | { type: "ball"; radius: number }
  | { type: "cuboid"; halfExtents: Vec3 }
  | { type: "cylinder"; halfHeight: number; radius: number };

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
  setVelocity(velocity: Vec3, wakeUp?: boolean): void;
  setAngularVelocity(velocity: Vec3, wakeUp?: boolean): void;
}

/** Generic Rapier world ownership. It knows about bodies and shapes, but not
 * about any particular game, level, actor, or scoring rule. */
export interface Physics3DWorld {
  readonly raw: RAPIER.World;
  createBody(options?: RigidBody3DOptions): Physics3DBody;
  createCollider(
    body: Physics3DBody,
    shape: Collider3DShape,
    options?: Collider3DOptions,
  ): RAPIER.Collider;
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
      if (colliderOptions.friction !== undefined) descriptor.setFriction(colliderOptions.friction);
      if (colliderOptions.restitution !== undefined)
        descriptor.setRestitution(colliderOptions.restitution);
      if (colliderOptions.density !== undefined) descriptor.setDensity(colliderOptions.density);
      if (colliderOptions.sensor !== undefined) descriptor.setSensor(colliderOptions.sensor);
      return raw.createCollider(descriptor, body.raw);
    },
    step() {
      raw.step();
    },
    dispose() {
      raw.free();
    },
  };
}

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
    setVelocity(velocity, wakeUp = true) {
      body.setLinvel(velocity, wakeUp);
    },
    setAngularVelocity(velocity, wakeUp = true) {
      body.setAngvel(velocity, wakeUp);
    },
  };
}
