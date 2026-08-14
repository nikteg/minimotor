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
/** Wrap a body in an arcade-car driving model. Call `drive()` each fixed step,
 *  then step your physics world; read `body.x/y/rot` (and `car.speed`) to draw. */
export declare function car(body: DrivableBody, config?: CarConfig): Car;
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
export declare const carPresets: {
    compact: {
        acceleration: number;
        grip: number;
        steer: number;
    };
    muscle: {
        acceleration: number;
        grip: number;
        steer: number;
    };
    drift: {
        acceleration: number;
        grip: number;
        steer: number;
    };
};
/** A key of `carPresets` (`"compact" | "muscle" | "drift"`). */
export type CarPresetId = keyof typeof carPresets;
