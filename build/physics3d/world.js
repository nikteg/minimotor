// Generic Rapier world. The engine does not import a Rapier package — pass
// the module you installed:
//
//   import * as rapier from "@dimforge/rapier3d-compat";
//   const phys = await createPhysics3D({ rapier });
//
// Use `@dimforge/rapier3d-deterministic-compat` when a client and a server
// step the same world. Do not mix the two.
import { Quat } from "../math/quat.js";
/** One `init()` per Rapier module, however many worlds are built from it.
 *
 *  wasm-bindgen's loader is idempotent only once it has FINISHED: `init` checks
 *  a module-level `wasm` binding that it sets at the end, so two calls that
 *  overlap both find it undefined, both instantiate, and the second replaces
 *  the memory the first one's worlds are still pointing into. Building several
 *  worlds with `Promise.all` — a game loading its levels, or a test suite
 *  building one world per level — then fails deep inside the wasm with
 *  "memory access out of bounds" or a collider whose shape reads back null.
 *
 *  Keyed on the module rather than kept in one variable, so an app that hands
 *  in two different Rapier builds gets one init each. */
const started = new WeakMap();
function ensureRapier(rapier) {
    let ready = started.get(rapier);
    if (!ready) {
        ready = rapier.init();
        started.set(rapier, ready);
    }
    return ready;
}
/** Create a generic 3D rigid-body world backed by the Rapier module you pass. */
export async function createPhysics3D(options) {
    const rapier = options.rapier;
    await ensureRapier(rapier);
    const raw = new rapier.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
    if (options.timestep !== undefined)
        raw.timestep = options.timestep;
    if (options.solverIterations !== undefined) {
        raw.integrationParameters.numSolverIterations = options.solverIterations;
    }
    const combineRules = {
        average: rapier.CoefficientCombineRule.Average,
        min: rapier.CoefficientCombineRule.Min,
        multiply: rapier.CoefficientCombineRule.Multiply,
        max: rapier.CoefficientCombineRule.Max,
    };
    const bodies = new Map();
    const beginCbs = new Set();
    const endCbs = new Set();
    const events = new rapier.EventQueue(true);
    // One record reused for every contact: a busy world raises hundreds a second,
    // and a listener is expected to read what it wants before returning.
    const contact = { colliderA: undefined, colliderB: undefined, normal: { x: 0, y: 0, z: 0 } };
    return {
        raw,
        createBody(bodyOptions = {}) {
            const descriptor = createRigidBodyDescriptor(rapier, bodyOptions);
            const body = raw.createRigidBody(descriptor);
            const wrapped = wrapBody(body);
            bodies.set(body.handle, wrapped);
            return wrapped;
        },
        createCollider(body, shape, colliderOptions = {}) {
            const descriptor = createColliderDescriptor(rapier, shape);
            const position = colliderOptions.position;
            if (position)
                descriptor.setTranslation(position.x, position.y, position.z);
            if (colliderOptions.rotation)
                descriptor.setRotation(colliderOptions.rotation);
            if (colliderOptions.friction !== undefined)
                descriptor.setFriction(colliderOptions.friction);
            if (colliderOptions.restitution !== undefined)
                descriptor.setRestitution(colliderOptions.restitution);
            if (colliderOptions.frictionCombine) {
                descriptor.setFrictionCombineRule(combineRules[colliderOptions.frictionCombine]);
            }
            if (colliderOptions.restitutionCombine) {
                descriptor.setRestitutionCombineRule(combineRules[colliderOptions.restitutionCombine]);
            }
            if (colliderOptions.density !== undefined)
                descriptor.setDensity(colliderOptions.density);
            if (colliderOptions.sensor !== undefined)
                descriptor.setSensor(colliderOptions.sensor);
            descriptor.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
            return raw.createCollider(descriptor, body.raw);
        },
        raycast(origin, direction, rayOptions = {}) {
            const ray = new rapier.Ray(origin, direction);
            const exclude = rayOptions.exclude;
            const accept = rayOptions.filter;
            const skipping = exclude && exclude.length > 0;
            const predicate = skipping || accept
                ? (candidate) => !(skipping && exclude.includes(candidate)) && (!accept || accept(candidate))
                : undefined;
            const hit = raw.castRayAndGetNormal(ray, rayOptions.maxDistance ?? 1000, rayOptions.solid ?? true, undefined, undefined, undefined, undefined, predicate);
            if (!hit)
                return null;
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
        queryAabb(min, max, opts = {}) {
            const found = [];
            const accept = opts.filter;
            raw.collidersWithAabbIntersectingAabb({
                x: (min.x + max.x) * 0.5,
                y: (min.y + max.y) * 0.5,
                z: (min.z + max.z) * 0.5,
            }, {
                x: Math.abs(max.x - min.x) * 0.5,
                y: Math.abs(max.y - min.y) * 0.5,
                z: Math.abs(max.z - min.z) * 0.5,
            }, (collider) => {
                if (!accept || accept(collider))
                    found.push(collider);
                return true;
            });
            return found;
        },
        pointPick(point, opts = {}) {
            let nearest = null;
            let best = Infinity;
            const accept = opts.filter;
            raw.intersectionsWithPoint(point, (collider) => {
                if (accept && !accept(collider))
                    return true;
                const t = collider.translation();
                const d = (t.x - point.x) * (t.x - point.x) +
                    (t.y - point.y) * (t.y - point.y) +
                    (t.z - point.z) * (t.z - point.z);
                if (d < best) {
                    best = d;
                    nearest = collider;
                }
                return true;
            });
            return nearest;
        },
        revolute(a, b, anchor, axis) {
            const params = rapier.JointData.revolute(worldPointToLocal(a.raw, anchor), worldPointToLocal(b.raw, anchor), worldDirToLocal(a.raw, axis));
            return jointHandle(raw, raw.createImpulseJoint(params, a.raw, b.raw, true));
        },
        spherical(a, b, anchor) {
            const params = rapier.JointData.spherical(worldPointToLocal(a.raw, anchor), worldPointToLocal(b.raw, anchor));
            return jointHandle(raw, raw.createImpulseJoint(params, a.raw, b.raw, true));
        },
        fixed(a, b, anchor) {
            const params = rapier.JointData.fixed(worldPointToLocal(a.raw, anchor), IDENTITY_QUAT, worldPointToLocal(b.raw, anchor), relativeFrame(a.raw, b.raw));
            return jointHandle(raw, raw.createImpulseJoint(params, a.raw, b.raw, true));
        },
        onContact(cb) {
            beginCbs.add(cb);
            return () => beginCbs.delete(cb);
        },
        onContactEnd(cb) {
            endCbs.add(cb);
            return () => endCbs.delete(cb);
        },
        step() {
            raw.step(events);
            if (beginCbs.size === 0 && endCbs.size === 0)
                return;
            events.drainCollisionEvents((handle1, handle2, started) => {
                const c1 = raw.getCollider(handle1);
                const c2 = raw.getCollider(handle2);
                const p1 = c1?.parent();
                const p2 = c2?.parent();
                if (!p1 || !p2)
                    return;
                const a = bodies.get(p1.handle);
                const b = bodies.get(p2.handle);
                if (!a || !b)
                    return;
                if (!started) {
                    for (const cb of endCbs)
                        cb(a, b);
                    return;
                }
                // Which collider touched is the only way to know what was hit when a
                // body carries several, and the normal is the only way to tell a
                // vertical surface from a horizontal one. Rapier has both, but only
                // until the next step, so they are read here rather than left for the
                // listener to fetch later.
                contact.colliderA = c1;
                contact.colliderB = c2;
                contact.normal.x = 0;
                contact.normal.y = 0;
                contact.normal.z = 0;
                raw.contactPair(c1, c2, (manifold, flipped) => {
                    const n = manifold.normal();
                    // `flipped` means Rapier built the manifold the other way round, so
                    // its normal points from `b` towards `a`.
                    const sign = flipped ? -1 : 1;
                    contact.normal.x = n.x * sign;
                    contact.normal.y = n.y * sign;
                    contact.normal.z = n.z * sign;
                });
                for (const cb of beginCbs)
                    cb(a, b, contact);
            });
        },
        dispose() {
            events.free();
            raw.free();
            bodies.clear();
        },
    };
}
const IDENTITY_QUAT = { x: 0, y: 0, z: 0, w: 1 };
function worldPointToLocal(body, world) {
    const t = body.translation();
    const r = body.rotation();
    return Quat.rotateVec3({ x: -r.x, y: -r.y, z: -r.z, w: r.w }, { x: world.x - t.x, y: world.y - t.y, z: world.z - t.z });
}
function worldDirToLocal(body, dir) {
    const r = body.rotation();
    return Quat.rotateVec3({ x: -r.x, y: -r.y, z: -r.z, w: r.w }, { x: dir.x, y: dir.y, z: dir.z });
}
/** Joint frame on `b` that matches `a`'s current world orientation, so a
 *  `fixed` joint locks the pose they already have rather than snapping. */
function relativeFrame(a, b) {
    const ra = a.rotation();
    const rb = b.rotation();
    return Quat.mul({ x: -rb.x, y: -rb.y, z: -rb.z, w: rb.w }, { x: ra.x, y: ra.y, z: ra.z, w: ra.w }, { x: 0, y: 0, z: 0, w: 1 });
}
function jointHandle(world, joint) {
    let dead = false;
    return {
        raw: joint,
        destroy() {
            if (dead)
                return;
            dead = true;
            if (joint.isValid())
                world.removeImpulseJoint(joint, true);
        },
    };
}
function createRigidBodyDescriptor(rapier, options) {
    const descriptor = options.type === "fixed"
        ? rapier.RigidBodyDesc.fixed()
        : options.type === "kinematic-position"
            ? rapier.RigidBodyDesc.kinematicPositionBased()
            : options.type === "kinematic-velocity"
                ? rapier.RigidBodyDesc.kinematicVelocityBased()
                : rapier.RigidBodyDesc.dynamic();
    if (options.position) {
        descriptor.setTranslation(options.position.x, options.position.y, options.position.z);
    }
    if (options.canSleep !== undefined)
        descriptor.setCanSleep(options.canSleep);
    if (options.ccd !== undefined)
        descriptor.setCcdEnabled(options.ccd);
    if (options.lockRotation)
        descriptor.lockRotations();
    if (options.linearDamping !== undefined)
        descriptor.setLinearDamping(options.linearDamping);
    if (options.angularDamping !== undefined)
        descriptor.setAngularDamping(options.angularDamping);
    return descriptor;
}
function createColliderDescriptor(rapier, shape) {
    switch (shape.type) {
        case "ball":
            return rapier.ColliderDesc.ball(shape.radius);
        case "cuboid":
            return rapier.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
        case "cylinder":
            return rapier.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        case "trimesh":
            return rapier.ColliderDesc.trimesh(shape.vertices, shape.indices, shape.fixInternalEdges === false ? undefined : rapier.TriMeshFlags.FIX_INTERNAL_EDGES);
        case "convexHull": {
            const descriptor = rapier.ColliderDesc.convexHull(shape.points);
            if (!descriptor)
                throw new Error("convexHull needs at least four non-coplanar points.");
            return descriptor;
        }
    }
}
function wrapBody(body) {
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
