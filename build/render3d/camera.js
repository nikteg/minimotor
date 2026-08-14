// ---------- 3D camera ----------
// A camera is state (where it is, what it looks at, how wide) plus two derived
// matrices. It does NOT own a projection convention: `viewProjection` takes the
// clip-depth flag from the device it is being rendered by, so one camera can
// feed a WebGL2 target and a WebGPU target in the same frame without either
// silently rendering nothing.
//
// The orbit controls live here rather than in the UI widget because they are
// the same interaction whether they are driven by a pointer, a gamepad or a
// scripted turntable, and a widget should not own a camera model.
import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { bounds } from "./mesh.js";
const DEFAULT_PITCH_LIMIT = Math.PI / 2 - 0.01;
/** A camera with defaults that frame a roughly unit-sized object. */
export function createCamera(init = {}) {
    return {
        target: { x: 0, y: 0, z: 0 },
        distance: 3,
        yaw: 0.6,
        pitch: 0.4,
        fov: Math.PI / 4,
        near: 0.05,
        far: 100,
        ...init,
    };
}
/** Where the camera sits in world space, derived from the orbit. */
export function cameraPosition(cam, out) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    const cp = Math.cos(cam.pitch);
    o.x = cam.target.x + Math.sin(cam.yaw) * cp * cam.distance;
    o.y = cam.target.y + Math.sin(cam.pitch) * cam.distance;
    o.z = cam.target.z + Math.cos(cam.yaw) * cp * cam.distance;
    return o;
}
const UP = { x: 0, y: 1, z: 0 };
const eye = { x: 0, y: 0, z: 0 };
/** The view matrix — world space to camera space. */
export function viewMatrix(cam, out) {
    return Mat4.lookAt(cameraPosition(cam, eye), cam.target, cam.up ?? UP, out);
}
/** The projection matrix for an `aspect` (width / height) viewport.
 *
 *  `zeroToOne` MUST come from the device being rendered to — WebGL2 wants
 *  false, WebGPU true. Passing the wrong one does not warn; it renders an
 *  empty viewport or a depth-fighting mess. */
export function projectionMatrix(cam, aspect, zeroToOne, out) {
    if (cam.orthographic) {
        // Size the box so that, at the target, an orthographic view frames the
        // same height a perspective one would — switching projection then keeps
        // the subject the same size instead of jumping.
        const halfH = Math.tan(cam.fov / 2) * cam.distance;
        const halfW = halfH * aspect;
        return Mat4.ortho(-halfW, halfW, -halfH, halfH, cam.near, cam.far, zeroToOne, out);
    }
    return Mat4.perspective(cam.fov, aspect, cam.near, cam.far, zeroToOne, out);
}
/** Projection · view, the single matrix a vertex shader needs. */
export function viewProjection(cam, aspect, zeroToOne, out) {
    const proj = projectionMatrix(cam, aspect, zeroToOne, out ?? Mat4.create());
    return Mat4.mul(proj, viewMatrix(cam, scratchView), proj);
}
const scratchView = Mat4.create();
const scratchVP = Mat4.create();
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
export function worldToScreen(cam, point, w, h) {
    const m = viewProjection(cam, w / Math.max(1, h), false, scratchVP);
    // Column-major: element (row r, col c) is m[c * 4 + r].
    const cw = m[3] * point.x + m[7] * point.y + m[11] * point.z + m[15];
    if (cw <= 1e-6)
        return null;
    const cx = m[0] * point.x + m[4] * point.y + m[8] * point.z + m[12];
    const cy = m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13];
    return {
        x: ((cx / cw) * 0.5 + 0.5) * w,
        // Clip space is +Y up, the canvas is +Y down.
        y: (0.5 - (cy / cw) * 0.5) * h,
        depth: cw,
    };
}
/** The direction the camera is looking, as a unit vector. */
export function cameraForward(cam, out) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    const cp = Math.cos(cam.pitch);
    // The negative of the orbit offset: the eye sits BACK along this from the
    // target, so looking is the other way.
    o.x = -Math.sin(cam.yaw) * cp;
    o.y = -Math.sin(cam.pitch);
    o.z = -Math.cos(cam.yaw) * cp;
    return o;
}
/** The camera's right vector, level with the horizon — pitch deliberately
 *  ignored, because strafing while looking up should not lift you off the
 *  ground. */
export function cameraRight(cam, out) {
    const o = out ?? { x: 0, y: 0, z: 0 };
    o.x = Math.cos(cam.yaw);
    o.y = 0;
    o.z = -Math.sin(cam.yaw);
    return o;
}
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
export function placeEye(cam, position, distance = 1) {
    cam.distance = distance;
    cameraForward(cam, cam.target);
    cam.target.x = position.x + cam.target.x * distance;
    cam.target.y = position.y + cam.target.y * distance;
    cam.target.z = position.z + cam.target.z * distance;
    return cam;
}
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
export function look(cam, dxPixels, dyPixels, sensitivity = 0.0022) {
    const limit = cam.pitchLimit ?? DEFAULT_PITCH_LIMIT;
    cam.yaw -= dxPixels * sensitivity;
    cam.pitch = Math.min(limit, Math.max(-limit, cam.pitch + dyPixels * sensitivity));
}
/** Orbit by a pointer delta in PIXELS. Taking pixels rather than radians keeps
 *  the sensitivity in one place, so every viewport drags at the same rate
 *  regardless of its size. Pitch is clamped, yaw wraps freely. */
export function orbit(cam, dxPixels, dyPixels, sensitivity = 0.01) {
    const limit = cam.pitchLimit ?? DEFAULT_PITCH_LIMIT;
    cam.yaw -= dxPixels * sensitivity;
    cam.pitch = Math.min(limit, Math.max(-limit, cam.pitch + dyPixels * sensitivity));
}
/** Dolly in or out by a wheel/pinch amount. Multiplicative, so a notch moves
 *  the same PROPORTION of the way in whether the camera is near or far — which
 *  is what makes zoom feel linear. Never reaches or passes the target. */
export function dolly(cam, amount, min = 0.05, max = 1e4) {
    cam.distance = Math.min(max, Math.max(min, cam.distance * Math.exp(amount)));
}
/** Point the camera at a mesh and back off far enough to see all of it —
 *  the "I loaded a model of unknown size and got a black screen" fix.
 *
 *  `padding` is a multiplier on the fitted distance (1.2 leaves a comfortable
 *  margin). Near and far are re-derived from the resulting distance, because a
 *  camera framing a 0.01-unit gem and one framing a 500-unit ship cannot share
 *  clip planes without losing all depth precision. */
export function frameMesh(cam, mesh, padding = 1.2) {
    const { min, max } = bounds(mesh);
    Vec3.scale(Vec3.add(min, max, cam.target), 0.5);
    const radius = Vec3.dist(min, max) / 2;
    if (radius === 0)
        return cam;
    // Fit the bounding sphere to the NARROWER of the two fields of view. The
    // horizontal one is the narrower whenever the viewport is portrait, but the
    // aspect is not known here, so fit vertically and let `padding` cover it.
    cam.distance = (radius / Math.sin(cam.fov / 2)) * padding;
    cam.near = Math.max(1e-4, cam.distance - radius * 2);
    cam.far = cam.distance + radius * 2;
    return cam;
}
