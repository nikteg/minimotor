// ---------- Vehicle: an arcade car driving model ----------
// A compact dynamic bicycle model that drives an EXISTING body: engine/brake
// forces act longitudinally, tyres dissipate lateral slip (so the car grips),
// steering yaws the body by wheelbase, and the handbrake breaks rear traction
// for controllable drifts. It only sets the body's tyre-space velocity each
// step — the caller's physics solver still owns all collisions.
//
// The body is duck-typed (`DrivableBody`), so this file has NO physics
// dependency: a `Physics2D.Body2D` satisfies it structurally, but so does any
// object with mutable rot/vx/vy/spin (handy for tests, or a custom integrator).
//
//    const body = phys.box(x, y, 40, 22, { type: "dynamic" }); // Physics2D
//    const car  = Gizmos.car(body, { acceleration: 920, grip: 8 });
//    // each fixed step:
//    car.drive({ throttle, steer, handbrake }, dt);
//    phys.step(dt); // solver resolves walls & car-to-car contacts

/** The minimal body the car drives. Rotation in radians; velocities in px/s;
 *  `spin` is angular velocity in rad/s. `Physics2D.Body2D` satisfies this. */
export interface DrivableBody {
  /** Heading in radians. */
  rot: number;
  /** Velocity x, px/s. */
  vx: number;
  /** Velocity y, px/s. */
  vy: number;
  /** Angular velocity, rad/s. */
  spin: number;
}

/** Tuning for `car()`: engine, grip, steering and drag. All optional. */
export interface CarConfig {
  /** Engine acceleration, px/s². Default 920. */
  acceleration?: number;
  /** Lateral grip: how fast sideways slip bleeds off (higher = less drift). Default 8. */
  grip?: number;
  /** Grip while the handbrake is held (lower = looser tail). Default 0.6. */
  handbrakeGrip?: number;
  /** Max steer angle in radians, ~45° (limited further at speed). Default 0.78. */
  steer?: number;
  /** Base rolling-drag coefficient. Default 0.72. */
  drag?: number;
}

/** Per-step driver input passed to `car.drive()`. */
export interface DriveInput {
  /** -1 (reverse/brake) .. 1 (accelerate). */
  throttle?: number;
  /** -1 (left) .. 1 (right). */
  steer?: number;
  /** Lock the rear wheels for a drift. */
  handbrake?: boolean;
}

/** An arcade-car controller returned by `car()`: read-only telemetry plus `drive()`. */
export interface Car {
  /** Smoothed steer angle in radians, relative to the car's heading — rotate
   *  wheel sprites by `body.rot + steerAngle`. Capped by `CarConfig.steer`
   *  and reduced with speed. */
  readonly steerAngle: number;
  /** Forward speed along the heading, px/s (signed). */
  readonly speed: number;
  /** Throttle magnitude 0..1 last step — brightness for an engine sound. */
  readonly engineLoad: number;
  /** Lateral slip magnitude — drives skid sound / smoke. */
  readonly tireSlip: number;
  /** Apply driver input for `dt` seconds: sets the body's tyre-space velocity. */
  drive(input: DriveInput, dt: number): void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Wrap a body in an arcade-car driving model. Call `drive()` each fixed step,
 *  then step your physics world; read `body.x/y/rot` (and `car.speed`) to draw. */
export function car(body: DrivableBody, config: CarConfig = {}): Car {
  const acceleration = config.acceleration ?? 920;
  const gripCoef = config.grip ?? 8;
  const handbrakeGrip = config.handbrakeGrip ?? 0.6;
  const steerMax = config.steer ?? 0.78;
  const dragBase = config.drag ?? 0.72;

  let steerAngle = 0;
  let speed = 0;
  let engineLoad = 0;
  let tireSlip = 0;

  return {
    get steerAngle() {
      return steerAngle;
    },
    get speed() {
      return speed;
    },
    get engineLoad() {
      return engineLoad;
    },
    get tireSlip() {
      return tireSlip;
    },
    drive(input, dt) {
      const throttle = clamp(input.throttle ?? 0, -1, 1);
      const steerInput = clamp(input.steer ?? 0, -1, 1);
      const handbrake = !!input.handbrake;
      const angle = body.rot;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // Decompose world velocity into forward (along heading) and lateral.
      let forward = body.vx * c + body.vy * s;
      let lateral = -body.vx * s + body.vy * c;

      if (throttle > 0) forward += acceleration * throttle * dt;
      else if (throttle < 0) forward += (forward > 35 ? -1250 : -acceleration * 0.56) * dt;
      const drag = dragBase + Math.abs(forward) * 0.00155;
      forward *= Math.exp(-drag * dt);
      if (handbrake) forward *= Math.exp(-1.8 * dt);
      engineLoad = Math.abs(throttle);

      // Tyres dissipate lateral slip; less grip (handbrake) = more slide.
      const grip = handbrake ? handbrakeGrip : gripCoef;
      tireSlip = Math.abs(lateral) + (handbrake ? Math.abs(forward) * 0.5 + 24 : 0);
      lateral *= Math.exp(-grip * dt);
      // Power + steering can break rear traction: a controllable fishtail.
      if (throttle > 0 && Math.abs(forward) > 230) {
        lateral -= steerInput * Math.abs(forward) * 0.62 * dt;
      }

      // Steer authority drops with speed; smooth toward the target angle.
      const steerLimit = steerMax / (1 + Math.abs(forward) / 700);
      const targetSteer = steerInput * steerLimit;
      steerAngle += (targetSteer - steerAngle) * Math.min(1, dt * 12);

      // Recompose the tyre-space velocity back into world space.
      body.vx = c * forward - s * lateral;
      body.vy = s * forward + c * lateral;
      // Yaw from steering (wheelbase turn), boosted ~2× under handbrake so the
      // tail kicks out into a drift rather than washing sideways.
      const yawGain = handbrake && Math.abs(forward) > 40 ? 2.2 : 1;
      body.spin = Math.abs(forward) > 4 ? (forward / 60) * Math.tan(steerAngle) * yawGain : 0;
      speed = forward;
    },
  };
}

/** Ready-made `CarConfig` tunings for common arcade archetypes — a decent
 *  starting point so a game doesn't hand-tune from scratch. Spread one into
 *  `car()` and override anything:
 *
 *    Gizmos.car(body, Gizmos.carPresets.drift);
 *    Gizmos.car(body, { ...Gizmos.carPresets.muscle, grip: 5 });
 *
 *  - `compact` — nimble, high grip; the balanced default.
 *  - `muscle` — heavier and faster, looser grip, lazier steering.
 *  - `drift` — low grip and sharp steering, happy to slide. */
export const carPresets = {
  compact: { acceleration: 920, grip: 8.4, steer: 0.78 },
  muscle: { acceleration: 1120, grip: 6.1, steer: 0.62 },
  drift: { acceleration: 850, grip: 3.8, steer: 0.9 },
} satisfies Record<string, CarConfig>;

/** A key of `carPresets` (`"compact" | "muscle" | "drift"`). */
export type CarPresetId = keyof typeof carPresets;
