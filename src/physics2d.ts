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
// component and copy the transform into the built-in Sprite once per step —
// the body simulates, the sprite renders:
//
//   const Phys = ECS.component("Phys"); // { body: Body2D }
//   world.system("physics", () => phys.step(Loop.step));
//   world.system("sync", (w) => {
//     for (const [, s, p] of w.query(ECS.Sprite, Phys)) {
//       s.x = p.body.x; s.y = p.body.y; s.rot = p.body.rot;
//     }
//   });

import { type Body as PlanckBody, Box, Circle, Edge, RevoluteJoint, Vec2, World } from "planck";

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

/** A revolute joint from `pin()`. */
export interface Pin2D {
  /** Drive the joint like a motor: target speed in rad/s, with the torque
   *  budget to reach it. Pass speed 0 to brake, or call `destroy()` to let go. */
  motor(speedRadPerSec: number, maxTorque?: number): void;
  /** Remove the joint. */
  destroy(): void;
  /** Escape hatch: the underlying planck joint. */
  readonly raw: RevoluteJoint;
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
  /** A static frame of edges around the inside of the rect — walls/floor/
   *  ceiling for a contained scene. Returns the (static) body so it can be
   *  destroyed and rebuilt on resize. */
  walls(x: number, y: number, w: number, h: number, opts?: BodyOptions): Body2D;
  /** Hinge two bodies together at a world point (px). Bodies rotate freely
   *  around it — or drive it with `motor()`. */
  pin(a: Body2D, b: Body2D, x: number, y: number): Pin2D;
  /** Called when two bodies begin touching. Returns an unsubscribe. */
  onContact(cb: (a: Body2D, b: Body2D) => void): () => void;
  /** Live body count (includes static bodies). */
  readonly count: number;
  /** Escape hatch: the underlying planck world. */
  readonly raw: World;
}

const fixtureDef = (o: BodyOptions) => ({
  density: o.density ?? 1,
  friction: o.friction ?? 0.3,
  restitution: o.restitution ?? 0,
});

/** Create an isolated physics world. */
export function world(opts: Physics2DOptions = {}): Physics2DWorld {
  const ppm = opts.pixelsPerMeter ?? 50;
  const g = opts.gravity ?? { x: 0, y: 1800 };
  const pw = new World({ gravity: new Vec2(g.x / ppm, g.y / ppm) });

  // Box2D locks the world during a step; destroys requested from inside a
  // contact callback are buffered and applied when the step ends.
  const pendingDestroy: PlanckBody[] = [];
  const destroyBody = (b: PlanckBody) => {
    if (pw.isLocked()) pendingDestroy.push(b);
    else pw.destroyBody(b);
  };

  const wrap = (raw: PlanckBody, data: unknown): Body2D => {
    const body: Body2D = {
      get x() {
        return raw.getPosition().x * ppm;
      },
      set x(v) {
        raw.setPosition(new Vec2(v / ppm, raw.getPosition().y));
      },
      get y() {
        return raw.getPosition().y * ppm;
      },
      set y(v) {
        raw.setPosition(new Vec2(raw.getPosition().x, v / ppm));
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
      set vx(v) {
        raw.setLinearVelocity(new Vec2(v / ppm, raw.getLinearVelocity().y));
      },
      get vy() {
        return raw.getLinearVelocity().y * ppm;
      },
      set vy(v) {
        raw.setLinearVelocity(new Vec2(raw.getLinearVelocity().x, v / ppm));
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
      data,
      applyImpulse(ix, iy) {
        raw.applyLinearImpulse(new Vec2(ix / ppm, iy / ppm), raw.getWorldCenter(), true);
      },
      applyForce(fx, fy) {
        raw.applyForce(new Vec2(fx / ppm, fy / ppm), raw.getWorldCenter(), true);
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

  const contactCbs = new Set<(a: Body2D, b: Body2D) => void>();
  pw.on("begin-contact", (contact) => {
    if (contactCbs.size === 0) return;
    const a = contact.getFixtureA().getBody().getUserData() as Body2D;
    const b = contact.getFixtureB().getBody().getUserData() as Body2D;
    for (const cb of contactCbs) cb(a, b);
  });

  return {
    step(stepMs) {
      pw.step(stepMs / 1000, 8, 3);
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

    walls(x, y, w, h, o = {}) {
      const raw = pw.createBody({ type: "static" });
      const def = fixtureDef(o);
      const tl = new Vec2(x / ppm, y / ppm);
      const tr = new Vec2((x + w) / ppm, y / ppm);
      const br = new Vec2((x + w) / ppm, (y + h) / ppm);
      const bl = new Vec2(x / ppm, (y + h) / ppm);
      raw.createFixture(new Edge(tl, tr), def);
      raw.createFixture(new Edge(tr, br), def);
      raw.createFixture(new Edge(br, bl), def);
      raw.createFixture(new Edge(bl, tl), def);
      return wrap(raw, o.data);
    },

    pin(a, b, x, y) {
      const joint = pw.createJoint(
        new RevoluteJoint({}, a.raw, b.raw, new Vec2(x / ppm, y / ppm)),
      )!;
      return {
        motor(speed, maxTorque = 1000) {
          joint.enableMotor(true);
          joint.setMotorSpeed(speed);
          joint.setMaxMotorTorque(maxTorque);
        },
        destroy() {
          pw.destroyJoint(joint);
        },
        get raw() {
          return joint;
        },
      };
    },

    onContact(cb) {
      contactCbs.add(cb);
      return () => contactCbs.delete(cb);
    },

    get count() {
      return pw.getBodyCount();
    },

    get raw() {
      return pw;
    },
  };
}

/** Namespace-style export, matching `Minimotor.*` ergonomics:
 *  `import { Physics2D } from "minimotor/physics2d"` → `Physics2D.world()`. */
export const Physics2D = { world };
