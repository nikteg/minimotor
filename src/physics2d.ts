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

import { type Body as PlanckBody, Box, Circle, RevoluteJoint, Vec2, World } from "planck";
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

/** A revolute joint from `pin()`. */
export interface Pin2D {
  /** Drive the joint like a motor: target speed in rad/s, with the torque
   *  budget to reach it (`maxTorque` default 1000). Pass speed 0 to brake, or
   *  call `destroy()` to let go. */
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
  /** A containment frame around the inside of the rect — walls/floor/ceiling
   *  for a contained scene. On resize, call `set()` on the returned frame:
   *  the walls glide to the new rect kinematically, sweeping bodies along
   *  physically instead of leaving them stranded. */
  walls(x: number, y: number, w: number, h: number, opts?: WallsOptions): Walls2D;
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
        slab.setLinearVelocity(new Vec2(0, 0));
      } else if (dist <= ws.speed * dt) {
        slab.setLinearVelocity(new Vec2(dx / dt, dy / dt));
      } else {
        slab.setLinearVelocity(new Vec2((dx / dist) * ws.speed, (dy / dist) * ws.speed));
      }
    });
  };

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
      const dt = stepMs / 1000;
      for (const ws of sweeps) steer(ws, dt);
      pw.step(dt, 8, 3);
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
  ecs.system("phys2d:sync", (w) => {
    for (const [, s, p] of w.query(Sprite, Phys)) {
      s.x = p.body.x;
      s.y = p.body.y;
      s.rot = p.body.rot;
    }
  });
}

/** Namespace-style export, matching `Minimotor.*` ergonomics:
 *  `import { Physics2D } from "minimotor/physics2d"` → `Physics2D.world()`. */
export const Physics2D = { world, attach, Phys };
