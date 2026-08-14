// ---------- UI on a 3D plane ----------
// The other direction from `UI.viewport3d`. That puts a 3D view inside the UI;
// this puts the UI inside the 3D scene — a diegetic panel on a wall, a HUD
// angled in space, a working monitor on a prop.
//
// The whole thing rests on one observation: **the UI already renders into a
// `CanvasRenderingContext2D`, and a canvas is a texture source.** So no widget
// is ported to the GPU and no text shaping is reimplemented. The UI draws into
// an offscreen 2D canvas exactly as it draws into the app's, that canvas
// uploads as a texture, and the texture goes on a quad. Everything the UI can
// do — nine-slice themes, native-backed selects aside, tooltips, the layout
// recorder — works unchanged.
//
// Input is the part that is NOT free, and it is why this module exists rather
// than being three lines in a sample. Hit-testing a UI on a quad is a RAY CAST:
// unproject the pointer through the camera, intersect the plane, convert the
// hit to uv, scale to surface pixels. That cannot be expressed as the UI's
// existing scale-plus-offset transform, so it goes through
// `pushPointerOverride` instead. Everything else about the pointer — the press
// and release edges, the wheel — is the real device's, because it IS the real
// pointer; only its position has to be re-derived.
//
// Cost, stated plainly: the texture re-uploads every frame the surface is
// redrawn. At 512×512 that is 1 MB a frame, which is fine; at 1920×1080 it is
// 8 MB a frame, which is not. Size a surface for the panel it holds, not for
// the screen, and use `redraw: false` on a surface whose contents are static.
import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { cameraPosition, projectionMatrix, viewMatrix } from "./camera.js";
import { plane } from "./mesh.js";
import { popPointerOverride, pushPointerOverride } from "../ui/core/input.js";
import { popUiSurface, pushUiSurface } from "../ui/core/context.js";
import { withUiApp } from "../ui/core/state.js";
/** Create a UI surface. The canvas is offscreen and never enters the document,
 *  so it costs no layout. */
export function createUiSurface(opts) {
    const width = Math.max(1, Math.round(opts.width));
    const height = Math.max(1, Math.round(opts.height));
    const ratio = opts.pixelRatio ?? 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("UI surface: could not get a 2D context.");
    // Re-bound to a non-null const: `drawSurface` below is hoisted past the
    // guard, so TypeScript's narrowing of `context` does not reach into it.
    const ctx = context;
    const worldWidth = opts.worldWidth ?? 1;
    const worldHeight = (worldWidth * height) / width;
    const mesh = xyQuad(worldWidth, worldHeight);
    const material = {
        texture: canvas,
        textureVersion: 0,
        unlit: true,
        transparent: true,
        doubleSided: true,
        pixelated: opts.pixelated ?? false,
    };
    const ray = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
    function hitTest(model, _camera, r) {
        const uv = intersectQuad(model, r, worldWidth, worldHeight);
        return uv && { x: uv.u * width, y: uv.v * height };
    }
    let version = 0;
    return {
        canvas,
        ctx,
        width,
        height,
        mesh,
        material,
        hitTest,
        draw(drawOpts, build) {
            // Everything below touches per-app state, so it all has to run under one
            // selection rather than letting each bound widget pick its own.
            if (opts.app)
                return withUiApp(opts.app, () => drawSurface(drawOpts, build));
            return drawSurface(drawOpts, build);
        },
    };
    function drawSurface(drawOpts, build) {
        const hit = drawOpts.pointer
            ? hitTest(drawOpts.model, drawOpts.camera, pointerRay(drawOpts.camera, drawOpts.pointer, ray))
            : null;
        ctx.save();
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (opts.background != null) {
            ctx.fillStyle = opts.background;
            ctx.fillRect(0, 0, width, height);
        }
        const prevPointer = pushPointerOverride(hit?.x ?? 0, hit?.y ?? 0, hit === null);
        pushUiSurface(ctx);
        try {
            build();
        }
        finally {
            // Unbalanced, this would leave every widget on the page drawing into an
            // offscreen canvas — a failure that looks like the UI disappearing rather
            // than like an error, so it is worth the `finally`.
            popUiSurface();
            popPointerOverride(prevPointer);
            ctx.restore();
        }
        material.textureVersion = ++version;
    }
}
const invModel = Mat4.create();
const originLocal = { x: 0, y: 0, z: 0 };
const dirLocal = { x: 0, y: 0, z: 0 };
/** Where a ray crosses a `worldWidth` × `worldHeight` quad centred on the
 *  origin in the XY plane, after `model` places it — as `u`/`v` in 0..1 with
 *  `v = 0` at the TOP, or null if it misses.
 *
 *  The intersection is done in the quad's LOCAL space, where the plane is just
 *  z = 0 and the whole test is one division. Transforming the ray by the
 *  inverse model matrix is both cheaper and far more robust than recovering a
 *  world-space plane from the matrix's columns, and it handles a scaled or
 *  sheared quad for free. */
export function intersectQuad(model, ray, worldWidth, worldHeight) {
    if (!Mat4.invert(model, invModel))
        return null;
    Mat4.transformPoint(invModel, ray.origin, originLocal);
    Mat4.transformDirection(invModel, ray.direction, dirLocal);
    if (Math.abs(dirLocal.z) < 1e-9)
        return null; // ray parallel to the surface
    const t = -originLocal.z / dirLocal.z;
    if (t < 0)
        return null; // the surface is behind the viewer
    const x = originLocal.x + dirLocal.x * t;
    const y = originLocal.y + dirLocal.y * t;
    const u = x / worldWidth + 0.5;
    // Flipped: the quad's +Y is up, a UI's +Y is down.
    const v = 0.5 - y / worldHeight;
    if (u < 0 || u > 1 || v < 0 || v > 1)
        return null;
    return { u, v };
}
const eye = { x: 0, y: 0, z: 0 };
const invViewProj = Mat4.create();
const nearPoint = { x: 0, y: 0, z: 0 };
/** The world-space ray under a pointer, given the camera and the size of the
 *  view it is over. Unprojects a clip-space point on the near plane and aims
 *  from the eye through it. */
export function pointerRay(camera, pointer, out) {
    const r = out ?? { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
    // Clip space is −1…1 with +Y UP; a UI rect is +Y down, hence the flip.
    const cx = (pointer.x / pointer.viewW) * 2 - 1;
    const cy = 1 - (pointer.y / pointer.viewH) * 2;
    // Always unproject with the WebGL depth convention: this is pure maths on
    // the CPU, so which backend will eventually rasterise the scene is
    // irrelevant, and picking one convention keeps the near plane at z = −1.
    const aspect = pointer.viewW / pointer.viewH;
    Mat4.mul(projectionMatrix(camera, aspect, false), viewMatrix(camera), invViewProj);
    if (!Mat4.invert(invViewProj, invViewProj)) {
        Vec3.set(r.origin, 0, 0, 0);
        Vec3.set(r.direction, 0, 0, -1);
        return r;
    }
    Vec3.set(nearPoint, cx, cy, -1);
    Mat4.transformPoint(invViewProj, nearPoint);
    cameraPosition(camera, eye);
    Vec3.copy(r.origin, eye);
    if (camera.orthographic) {
        // An orthographic camera has no single eye point: every ray is parallel to
        // the view direction and starts at the near plane instead.
        Vec3.copy(r.origin, nearPoint);
        Vec3.normalize(Vec3.sub(camera.target, eye, r.direction));
        return r;
    }
    Vec3.normalize(Vec3.sub(nearPoint, eye, r.direction));
    return r;
}
/** A quad in the XY plane facing +Z, centred on the origin, with v = 0 at the
 *  TOP so a UI's own coordinates map straight onto it.
 *
 *  `plane()` lies in XZ facing up, which is the ground; a surface wants to
 *  stand up like a screen, and rotating a ground plane by 90° every time is
 *  both noise and an easy way to get the winding wrong. */
function xyQuad(w, h) {
    const x = w / 2;
    const y = h / 2;
    return {
        positions: new Float32Array([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    };
}
// Re-exported so a caller building its own quad geometry does not have to
// import `plane` from two places.
export { plane };
