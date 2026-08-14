import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
import { plane } from "./mesh.js";
import type { App } from "../engine/index.js";
import type { Camera3D } from "./camera.js";
import type { Material } from "./scene.js";
import type { MeshData } from "./mesh.js";
/** How to build a UI surface. */
export interface UiSurfaceOptions {
    /** The app this surface belongs to — the same one `createUI` was given.
     *
     *  `draw` places the pointer BEFORE it runs `build`, and the pointer is
     *  per-app state, so it has to know which app before a single bound widget
     *  function has had a chance to say. Omitting this works only when `draw` is
     *  itself called from inside a bound UI call (a `UI.viewport3d` render
     *  callback, say); called from a bare `Loop.draw` it throws "no active app".
     *  Pass it and the surface works anywhere. */
    app?: App;
    /** Surface size in UI pixels — the coordinate space widgets lay out in, and
     *  the texture's resolution before `pixelRatio`. */
    width: number;
    height: number;
    /** Extra texture resolution. 2 renders the UI at twice the size and lets the
     *  GPU downsample, which is the difference between crisp and mushy text on a
     *  quad seen up close. Costs 4× the upload. */
    pixelRatio?: number;
    /** World size of the quad's WIDTH. The height follows from the aspect ratio,
     *  so a surface never distorts its own text. Default 1. */
    worldWidth?: number;
    /** Fill drawn under the UI each frame. `null` leaves the surface
     *  transparent, so only what the UI paints appears on the quad — which is
     *  how a floating label or a holographic readout is made. */
    background?: string | null;
    /** Sample the texture with nearest-neighbour. Default false: unlike sprite
     *  art, UI text on a quad is being scaled by an arbitrary perspective factor
     *  and wants the smooth filter. */
    pixelated?: boolean;
}
/** A UI surface: a canvas, the quad that shows it, and the plumbing that makes
 *  the pointer land in the right place. */
export interface UiSurface {
    /** The offscreen canvas the UI draws into — this is the texture. */
    readonly canvas: HTMLCanvasElement;
    /** Its 2D context. */
    readonly ctx: CanvasRenderingContext2D;
    /** Surface size in UI pixels. */
    readonly width: number;
    readonly height: number;
    /** A quad in the XY plane facing +Z, sized `worldWidth` × its aspect. Give
     *  it to a `Node3D` and place that node however you like. */
    readonly mesh: MeshData;
    /** The material to draw it with. Unlit and transparent, because a UI has its
     *  own contrast and being shaded by the scene's lights makes it unreadable
     *  from the wrong angle. */
    readonly material: Material;
    /** Render one frame of UI into the surface.
     *
     *  `model` is the quad node's world matrix and `camera` the camera it will
     *  be seen from; together with `pointer` (the pointer in the coordinates of
     *  whatever is showing the 3D view) they place the pointer on the surface.
     *  Pass `pointer: null` for a non-interactive surface. */
    draw(opts: UiSurfaceDrawOptions, build: () => void): void;
    /** Where a pointer ray lands on this surface, in surface pixels, or null if
     *  it misses. Exposed for callers doing their own picking. */
    hitTest(model: Mat4, camera: Camera3D, ray: Ray): {
        x: number;
        y: number;
    } | null;
}
/** Everything `draw` needs to place the pointer. */
export interface UiSurfaceDrawOptions {
    /** The quad node's world matrix (`node.world` after `updateWorldMatrices`). */
    model: Mat4;
    /** The camera the surface is seen from. */
    camera: Camera3D;
    /** The pointer's position within the 3D view, and that view's size — i.e.
     *  the `viewport3d` widget's rect. Null for a non-interactive surface. */
    pointer: {
        x: number;
        y: number;
        viewW: number;
        viewH: number;
    } | null;
}
/** A world-space ray. */
export interface Ray {
    origin: Vec3;
    direction: Vec3;
}
/** Create a UI surface. The canvas is offscreen and never enters the document,
 *  so it costs no layout. */
export declare function createUiSurface(opts: UiSurfaceOptions): UiSurface;
/** Where a ray crosses a `worldWidth` × `worldHeight` quad centred on the
 *  origin in the XY plane, after `model` places it — as `u`/`v` in 0..1 with
 *  `v = 0` at the TOP, or null if it misses.
 *
 *  The intersection is done in the quad's LOCAL space, where the plane is just
 *  z = 0 and the whole test is one division. Transforming the ray by the
 *  inverse model matrix is both cheaper and far more robust than recovering a
 *  world-space plane from the matrix's columns, and it handles a scaled or
 *  sheared quad for free. */
export declare function intersectQuad(model: Mat4, ray: Ray, worldWidth: number, worldHeight: number): {
    u: number;
    v: number;
} | null;
/** The world-space ray under a pointer, given the camera and the size of the
 *  view it is over. Unprojects a clip-space point on the near plane and aims
 *  from the eye through it. */
export declare function pointerRay(camera: Camera3D, pointer: {
    x: number;
    y: number;
    viewW: number;
    viewH: number;
}, out?: Ray): Ray;
export { plane };
