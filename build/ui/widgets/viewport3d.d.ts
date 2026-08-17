import { Flowable } from "../../ui/core/index.js";
import type { Camera3D } from "../../render3d/camera.js";
import type { Renderer3D } from "../../render3d/renderer.js";
import type { Scene3D } from "../../render3d/scene.js";
/** Inputs to `viewport3d`. */
export interface Viewport3DOptions extends Flowable {
    /** Left edge in px. Omit (with `y`) to auto-flow into the current
     *  row/col/panel like any other widget. */
    x?: number;
    /** Top edge in px (see `x`). */
    y?: number;
    /** Width in px. Auto-flowing in a ROW this is the slot reserved from the
     *  parent; in a column it is ignored unless the column shrink-wraps.
     *  Defaults to 160. */
    w?: number;
    /** Height in px. The other way round: in a COLUMN this is the slot, in a row
     *  it is ignored unless the row shrink-wraps. Defaults to 120.
     *
     *  To make a viewport fill its container, hand it an explicit rect —
     *  `UI.viewport3d({ ...body.fill(96), … })` — rather than omitting the size.
     *  A widget that silently ate the whole remaining axis would be impossible to
     *  put next to a label. */
    h?: number;
    /** The GPU renderer to draw with. One renderer can serve MANY viewports —
     *  it is resized and re-rendered per widget, per frame — so create one per
     *  app, not one per view. */
    renderer: Renderer3D;
    /** What to draw. */
    scene: Scene3D;
    /** Where to draw it from. Mutated in place by `orbit`, so the caller's
     *  camera object holds the interaction state. */
    camera: Camera3D;
    /** Let the pointer orbit (drag) and dolly (wheel) the camera. Off by
     *  default: a decorative turntable should not be draggable. */
    interactive?: boolean;
    /** Drag sensitivity in radians per pixel. */
    sensitivity?: number;
    /** Re-render the scene this frame. False re-blits the previous frame — for
     *  a static preview, or to run a heavy viewport at half rate. Note the
     *  renderer is shared, so "the previous frame" is only the previous frame
     *  OF THIS VIEWPORT when it is the only one; with several, pass true. */
    redraw?: boolean;
    /** Fill behind the 3D, in the UI's 2D context. The scene's own `background`
     *  alpha decides how much of this shows through — leave the scene
     *  transparent and set this to blend the view into a panel. */
    background?: string;
    /** Stroke a 1px border in this colour. */
    border?: string;
    /** Called when the viewport is pressed and released on itself. */
    onClick?: () => void;
    /** Border used while a clickable viewport is hovered. */
    hoverBorder?: string;
    /** Drawn over a clickable viewport while hovered, e.g. a pencil icon. */
    hoverIcon?: string;
    /** Stable id — for layout capture and for keeping drag state across frames
     *  when several viewports are on screen. */
    id?: string;
}
/** What the viewport reports back this frame. */
export interface Viewport3DState {
    /** The rect it occupied, in UI coords. */
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** Pointer is inside. */
    hovered: boolean;
    /** Pointer is dragging this viewport (only when `interactive`). */
    dragging: boolean;
}
/** Draw a live 3D scene as a widget.
 *
 *    const state = UI.viewport3d({
 *      renderer, scene, camera, interactive: true, h: 220,
 *      border: theme.border,
 *    });
 *
 *  Call it in the draw phase, inside whatever container should own the space.
 *  It advances nothing itself — animate the scene before calling, and the
 *  world matrices are refreshed here. */
export declare function viewport3d(opts: Viewport3DOptions): Viewport3DState;
