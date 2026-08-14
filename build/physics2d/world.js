// ---------- Rigid-body physics implementation ----------
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
//   const Phys = component("Phys"); // { body: Body2D }
//   world.system("physics", () => phys.step(Loop.step));
//   world.system("sync", (w) => {
//     for (const [, s, p] of w.query(Sprites.Sprite, Phys)) {
//       s.x = p.body.x; s.y = p.body.y; s.rot = p.body.rot;
//     }
//   });
import { AABB, Box, Chain, Circle, DistanceJoint, MouseJoint, Polygon, PrismaticJoint, RevoluteJoint, Vec2, WeldJoint, World, } from "planck";
import { component } from "../ecs/index.js";
import { Sprite } from "../sprites/index.js";
const fixtureDef = (o) => ({
    density: o.density ?? 1,
    friction: o.friction ?? 0.3,
    restitution: o.restitution ?? 0,
    isSensor: o.isSensor ?? false,
    filterCategoryBits: o.category ?? 0x0001,
    filterMaskBits: o.mask ?? 0xffff,
    filterGroupIndex: o.group ?? 0,
});
/** Create an isolated physics world. */
export function world(opts = {}) {
    const ppm = opts.pixelsPerMeter ?? 50;
    const g = opts.gravity ?? { x: 0, y: 1800 };
    const pw = new World({ gravity: new Vec2(g.x / ppm, g.y / ppm) });
    // planck copies the vectors handed to setPosition/setLinearVelocity/
    // applyForce/applyLinearImpulse, so one scratch serves every setter instead
    // of minting a Vec2 per assignment (these run per body per step).
    const v = new Vec2(0, 0);
    const at = (x, y) => {
        v.x = x;
        v.y = y;
        return v;
    };
    const sweeps = new Set();
    // Steer each gliding slab: arrive exactly (velocity sized to land on the
    // target this step) or cruise toward it at sweep speed.
    const steer = (ws, dt) => {
        ws.slabs.forEach((slab, i) => {
            const pos = slab.getPosition();
            const dx = ws.targets[i].x - pos.x;
            const dy = ws.targets[i].y - pos.y;
            const dist = Math.hypot(dx, dy);
            if (dist === 0) {
                slab.setLinearVelocity(at(0, 0));
            }
            else if (dist <= ws.speed * dt) {
                slab.setLinearVelocity(at(dx / dt, dy / dt));
            }
            else {
                slab.setLinearVelocity(at((dx / dist) * ws.speed, (dy / dist) * ws.speed));
            }
        });
    };
    // Box2D locks the world during a step; destroys requested from inside a
    // contact callback are buffered and applied when the step ends.
    const pendingDestroy = [];
    const pendingJoints = [];
    const destroyBody = (b) => {
        if (pw.isLocked())
            pendingDestroy.push(b);
        else
            pw.destroyBody(b);
    };
    const destroyJoint = (j) => {
        if (pw.isLocked())
            pendingJoints.push(j);
        else
            pw.destroyJoint(j);
    };
    const wrap = (raw, data) => {
        const body = {
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
                for (let f = raw.getFixtureList(); f; f = f.getNext())
                    f.setSensor(on);
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
    const makeBody = (x, y, o) => pw.createBody({
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
    const blankHit = () => ({
        body: null,
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
    const copyHit = (from, to) => {
        to.body = from.body;
        to.x = from.x;
        to.y = from.y;
        to.nx = from.nx;
        to.ny = from.ny;
        to.distance = from.distance;
        to.fraction = from.fraction;
        return to;
    };
    const cast = (x1, y1, x2, y2, o, onHit, all = false) => {
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len === 0)
            return; // a zero-length ray has no direction to normalize
        rayFrom.x = x1 / ppm;
        rayFrom.y = y1 / ppm;
        rayTo.x = x2 / ppm;
        rayTo.y = y2 / ppm;
        let clip = 1;
        pw.rayCast(rayFrom, rayTo, (fixture, point, normal, fraction) => {
            // -1 means "ignore this fixture and keep going" — the ray is unaffected.
            if (!o.sensors && fixture.isSensor())
                return -1;
            const body = fixture.getBody().getUserData();
            if (!body)
                return -1;
            if (o.filter && !o.filter(body))
                return -1;
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
            if (all)
                return 1;
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
    const setQueryBox = (x, y, w, h) => {
        queryBox.lowerBound.x = x / ppm;
        queryBox.lowerBound.y = y / ppm;
        queryBox.upperBound.x = (x + w) / ppm;
        queryBox.upperBound.y = (y + h) / ppm;
    };
    // The wrapped body behind a fixture, if the query wants it at all.
    const candidate = (fixture, o) => {
        if (!o.sensors && fixture.isSensor())
            return null;
        const body = fixture.getBody().getUserData();
        if (!body)
            return null; // created straight on `phys.raw` — no wrapper
        return o.filter && !o.filter(body) ? null : body;
    };
    const pickAt = (x, y, o) => {
        probe.x = x / ppm;
        probe.y = y / ppm;
        setQueryBox(x, y, 0, 0);
        let found = null;
        pw.queryAABB(queryBox, (fixture) => {
            const body = candidate(fixture, o);
            if (!body || !fixture.testPoint(probe))
                return true;
            // A crate resting on the floor overlaps the floor's box at its feet; the
            // crate is what the player meant, so a dynamic hit wins and ends it.
            const dynamic = fixture.getBody().isDynamic();
            if (!found || dynamic)
                found = body;
            return !dynamic;
        });
        return found;
    };
    // The half of every joint handle that is the same for all of them: a
    // deferred, idempotent destroy (destroying either joined body already took
    // the joint with it) plus the raw escape hatch.
    const handle = (joint) => {
        let dead = false;
        return {
            destroy() {
                if (dead)
                    return;
                dead = true;
                destroyJoint(joint);
            },
            raw: joint,
        };
    };
    // A mouse joint pulls a body toward a point relative to some other body;
    // that other body is this fixture-less static anchor, made on first drag.
    let ground = null;
    const groundBody = () => (ground ?? (ground = pw.createBody()));
    const beginCbs = new Set();
    const endCbs = new Set();
    const dispatch = (cbs, contact) => {
        if (cbs.size === 0)
            return;
        // Bodies created straight on `phys.raw` carry no wrapper; skip them rather
        // than handing a listener an undefined `a`.
        const a = contact.getFixtureA().getBody().getUserData();
        const b = contact.getFixtureB().getBody().getUserData();
        if (!a || !b)
            return;
        for (const cb of cbs)
            cb(a, b);
    };
    pw.on("begin-contact", (contact) => dispatch(beginCbs, contact));
    pw.on("end-contact", (contact) => dispatch(endCbs, contact));
    return {
        step(stepMs) {
            const dt = stepMs / 1000;
            for (const ws of sweeps)
                steer(ws, dt);
            pw.step(dt, 8, 3);
            // Joints first: destroying a body takes its joints with it, so a joint
            // queued alongside its body would otherwise be destroyed twice.
            for (const j of pendingJoints)
                pw.destroyJoint(j);
            pendingJoints.length = 0;
            for (const b of pendingDestroy)
                pw.destroyBody(b);
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
            raw.createFixture(new Polygon(points.map((p) => new Vec2(p.x / ppm, p.y / ppm))), fixtureDef(o));
            return wrap(raw, o.data);
        },
        chain(points, o = {}) {
            // The body sits at the origin and the chain carries world coordinates,
            // so the points a caller drew the terrain with are the points it gets.
            const raw = pw.createBody({ type: "static" });
            raw.createFixture(new Chain(points.map((p) => new Vec2(p.x / ppm, p.y / ppm)), o.loop ?? false), {
                friction: o.friction ?? 0.3,
                restitution: o.restitution ?? 0,
                filterCategoryBits: o.category ?? 0x0001,
                filterMaskBits: o.mask ?? 0xffff,
            });
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
            const layout = (rx, ry, rw, rh) => {
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
                    if (old)
                        slab.destroyFixture(old);
                    slab.createFixture(new Box(sizes[i][0] / ppm, sizes[i][1] / ppm), def);
                });
                return targets;
            };
            const ws = { slabs, targets: layout(x, y, w, h), speed };
            // First placement snaps into position — nothing to sweep yet.
            slabs.forEach((slab, i) => slab.setPosition(ws.targets[i]));
            sweeps.add(ws);
            return {
                set(nx, ny, nw, nh) {
                    ws.targets = layout(nx, ny, nw, nh);
                    // Wake everything: the floor gliding away under a sleeper is
                    // otherwise unnoticed, and sleepers ignore approaching walls.
                    for (let b = pw.getBodyList(); b; b = b.getNext()) {
                        if (b.isDynamic())
                            b.setAwake(true);
                    }
                },
                destroy() {
                    sweeps.delete(ws);
                    for (const slab of slabs)
                        destroyBody(slab);
                },
            };
        },
        pin(a, b, x, y) {
            const joint = pw.createJoint(new RevoluteJoint({}, a.raw, b.raw, new Vec2(x / ppm, y / ppm)));
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
            const joint = pw.createJoint(new DistanceJoint({
                // A distance joint with length 0 is degenerate, and planck says so
                // loudly — clamp anything the caller (or coincident bodies) hands
                // us to something the solver can work with.
                length: Math.max(0.01, (o.length ?? Math.hypot(b.x - a.x, b.y - a.y)) / ppm),
                frequencyHz: o.stiffness ?? 0,
                dampingRatio: o.damping ?? 0.7,
            }, a.raw, b.raw, new Vec2(a.x / ppm, a.y / ppm), new Vec2(b.x / ppm, b.y / ppm)));
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
            const joint = pw.createJoint(new PrismaticJoint({
                enableLimit: o.min !== undefined || o.max !== undefined,
                lowerTranslation: (o.min ?? 0) / ppm,
                upperTranslation: (o.max ?? 0) / ppm,
            }, a.raw, b.raw, new Vec2(b.x / ppm, b.y / ppm), new Vec2(axisX / len, axisY / len)));
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
            return handle(pw.createJoint(new WeldJoint({}, a.raw, b.raw, new Vec2(x / ppm, y / ppm))));
        },
        raycast(x1, y1, x2, y2, o = {}) {
            let best = -1;
            cast(x1, y1, x2, y2, o, (hit) => {
                // planck visits proxies in broadphase order, not near-to-far, and
                // clipping only prunes what comes after — so track the nearest here
                // rather than trusting the last callback to be the closest.
                if (best >= 0 && hit.fraction >= best)
                    return;
                best = hit.fraction;
                copyHit(hit, scratchHit);
            });
            return best < 0 ? null : scratchHit;
        },
        raycastAll(x1, y1, x2, y2, o = {}) {
            const hits = [];
            cast(x1, y1, x2, y2, o, (hit) => hits.push(copyHit(hit, blankHit())), true);
            hits.sort((a, b) => a.fraction - b.fraction);
            return hits;
        },
        queryAABB(x, y, w, h, o = {}) {
            const found = [];
            setQueryBox(x, y, w, h);
            pw.queryAABB(queryBox, (fixture) => {
                const body = candidate(fixture, o);
                if (body && !found.includes(body)) {
                    // The broadphase compares FAT proxy boxes (planck pads them so small
                    // movements don't rebuild the tree), so a body just outside the rect
                    // gets reported — re-test against the shape's own box.
                    fixture.getShape().computeAABB(tightBox, fixture.getBody().getTransform(), 0);
                    if (AABB.testOverlap(tightBox, queryBox))
                        found.push(body);
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
            if (!body)
                return null;
            // planck anchors the spring at the world point it was created with, so
            // grabbing a crate by its corner keeps it hanging by that corner.
            probe.x = x / ppm;
            probe.y = y / ppm;
            const joint = pw.createJoint(new MouseJoint({
                maxForce: (o.strength ?? 1000) * body.raw.getMass(),
                frequencyHz: o.frequency ?? 5,
                dampingRatio: o.damping ?? 0.7,
            }, groundBody(), body.raw, probe));
            body.wake(); // a sleeping body ignores the spring until something rouses it
            let dead = false;
            return {
                body,
                move(nx, ny) {
                    if (dead)
                        return;
                    joint.setTarget(at(nx / ppm, ny / ppm));
                    body.wake();
                },
                release() {
                    // Idempotent, and a no-op if the body was destroyed mid-drag: that
                    // already took the joint with it.
                    if (dead)
                        return;
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
        destroy() {
            for (let body = pw.getBodyList(); body;) {
                const next = body.getNext();
                pw.destroyBody(body);
                body = next;
            }
            sweeps.clear();
            pendingDestroy.length = 0;
            pendingJoints.length = 0;
        },
    };
}
// ---------- ECS integration ----------
/** The standard body-holding component: `{ body: Body2D }`. Spawn it next to
 *  the built-in Sprite and `attach()` keeps the two in sync. */
export const Phys = component("Phys2D");
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
export function attach(ecs, phys, opts) {
    const stepMs = opts.stepMs;
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
