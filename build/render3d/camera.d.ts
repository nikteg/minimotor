import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import type { MeshData } from "./mesh.js";
/** A perspective (or orthographic) camera positioned by an orbit around a
 *  target — the model previews and turntables this exists for all move that
 *  way, and a free-fly camera is `yaw`/`pitch` with the distance at zero. */
export interface Camera3D {
    /** The point the camera looks at and orbits around. */
    target: Vec3;
    /** Distance from the target. */
    distance: number;
    /** Horizontal angle in radians, 0 looking down −Z. */
    yaw: number;
    /** Vertical angle in radians, clamped by `pitchLimit`. */
    pitch: number;
    /** Vertical field of view in radians. Ignored when `orthographic`. */
    fov: number;
    /** Near clip plane. Too small a value wastes depth precision and causes
     *  z-fighting; keep it as large as the scene allows. */
    near: number;
    /** Far clip plane. `Infinity` is allowed and well-conditioned. */
    far: number;
    /** Use an orthographic projection, sized by `distance` — for isometric
     *  scenes and for icons that must not foreshorten. */
    orthographic?: boolean;
    /** How far the pitch may travel from level, in radians. Defaults to just
     *  under a right angle: at exactly ±90° the view direction is parallel to
     *  the up vector and `lookAt` has no basis to build from. */
    pitchLimit?: number;
    /** Up vector, +Y unless a game says otherwise. */
    up?: Vec3;
}
/** A camera with defaults that frame a roughly unit-sized object. */
export declare function createCamera(init?: Partial<Camera3D>): Camera3D;
/** Where the camera sits in world space, derived from the orbit. */
export declare function cameraPosition(cam: Camera3D, out?: Vec3): Vec3;
/** The view matrix — world space to camera space. */
export declare function viewMatrix(cam: Camera3D, out?: Mat4): Mat4;
/** The projection matrix for an `aspect` (width / height) viewport.
 *
 *  `zeroToOne` MUST come from the device being rendered to — WebGL2 wants
 *  false, WebGPU true. Passing the wrong one does not warn; it renders an
 *  empty viewport or a depth-fighting mess. */
export declare function projectionMatrix(cam: Camera3D, aspect: number, zeroToOne: boolean, out?: Mat4): Mat4;
/** Projection · view, the single matrix a vertex shader needs. */
export declare function viewProjection(cam: Camera3D, aspect: number, zeroToOne: boolean, out?: Mat4): Mat4;
/** Where a world point lands on a `w`×`h` viewport, in the SAME logical pixels
 *  the 2D canvas draws in — so a nameplate, a damage number or a waypoint can
 *  be an ordinary `UI.text` at the returned x/y.
 *
 *  Returns null when the point is at or behind the eye, which is not an error:
 *  it is the cull every screen-space marker needs, and the alternative is a
 *  label mirrored to the opposite side of the screen. `depth` is the clip-space
 *  w — distance along the view axis — which is what to sort overlapping markers
 *  by and what to fade distant ones on.
 *
 *  Uses the WebGL depth convention internally; the choice cancels out of x/y,
 *  so the result is the same on either backend. */
export declare function worldToScreen(cam: Camera3D, point: Vec3, w: number, h: number): {
    x: number;
    y: number;
    depth: number;
} | null;
/** The direction the camera is looking, as a unit vector. */
export declare function cameraForward(cam: Camera3D, out?: Vec3): Vec3;
/** The camera's right vector, level with the horizon — pitch deliberately
 *  ignored, because strafing while looking up should not lift you off the
 *  ground. */
export declare function cameraRight(cam: Camera3D, out?: Vec3): Vec3;
/** Put the camera's EYE at `position`, keeping its current yaw and pitch.
 *
 *  `Camera3D` is written as an orbit — a target plus a distance — because that
 *  is what a model viewer wants. A first-person camera is the same thing with
 *  the roles reversed: this moves the TARGET so that the derived eye lands
 *  where you asked. Everything downstream (`viewMatrix`, `pointerRay`, the
 *  renderer) is unchanged, so one camera type serves both and there is no
 *  second code path to keep in sync.
 *
 *  `distance` only sets how far ahead the target sits; it does not affect the
 *  view. Keep it around 1 — a very small value loses precision in `lookAt`,
 *  and a very large one makes the orbit controls useless if you ever switch. */
export declare function placeEye(cam: Camera3D, position: Vec3, distance?: number): Camera3D;
/** Turn a first-person camera by a mouse delta in PIXELS, with the same
 *  sensitivity convention as `orbit`.
 *
 *  Both axes take the SAME sign as `orbit`, which is worth stating because the
 *  intuition says otherwise — dragging a model turns the model, moving a mouse
 *  turns the head, so one expects a flip somewhere. There isn't one, because
 *  `pitch` already means the same thing to both: raising it lifts the ORBIT eye
 *  above the target (`cameraPosition`) and tilts the FIRST-PERSON forward
 *  vector down (`cameraForward` negates the term). Either way, more pitch is
 *  looking further down.
 *
 *  So `pitch += dy`: mouse down, look down. Subtracting it — which this did —
 *  is a camera that is inverted out of the box, on every game that uses it. */
export declare function look(cam: Camera3D, dxPixels: number, dyPixels: number, sensitivity?: number): void;
/** Orbit by a pointer delta in PIXELS. Taking pixels rather than radians keeps
 *  the sensitivity in one place, so every viewport drags at the same rate
 *  regardless of its size. Pitch is clamped, yaw wraps freely. */
export declare function orbit(cam: Camera3D, dxPixels: number, dyPixels: number, sensitivity?: number): void;
/** Dolly in or out by a wheel/pinch amount. Multiplicative, so a notch moves
 *  the same PROPORTION of the way in whether the camera is near or far — which
 *  is what makes zoom feel linear. Never reaches or passes the target. */
export declare function dolly(cam: Camera3D, amount: number, min?: number, max?: number): void;
/** Point the camera at a mesh and back off far enough to see all of it —
 *  the "I loaded a model of unknown size and got a black screen" fix.
 *
 *  `padding` is a multiplier on the fitted distance (1.2 leaves a comfortable
 *  margin). Near and far are re-derived from the resulting distance, because a
 *  camera framing a 0.01-unit gem and one framing a 500-unit ship cannot share
 *  clip planes without losing all depth precision. */
export declare function frameMesh(cam: Camera3D, mesh: MeshData, padding?: number): Camera3D;
