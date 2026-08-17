// ---------- 3D viewport widget ----------
// A live, animated 3D view that behaves like any other widget: it auto-flows
// inside a row/col/panel, clips and scrolls with its container, sits under a
// modal, and can be hovered and dragged.
//
// How it composites, and why this way. The renderer owns an offscreen GL canvas
// sized to this widget's rect; each frame the widget renders into it and blits
// it into the UI's 2D context with one `drawImage`. The alternative — stacking
// the GL canvas under the UI canvas and leaving a transparent hole — costs no
// blit, but it puts the 3D view UNDER every pixel of UI unconditionally: a
// panel's own backdrop would cover it, a modal could not dim it, and it could
// not scroll inside a list. For a full-screen game world that trade is right
// and `Renderer3D` supports it directly (stack its canvas yourself). For a view
// INSIDE the UI, the blit is what makes it a widget rather than a hole.
//
// The blit is one `drawImage` of a small canvas — at 320×240 it is well under
// a tenth of a millisecond. It is not free, and a screen with a dozen live
// viewports should render them at a lower rate; `redraw: false` exists for
// exactly that, and re-blits the last frame without re-rendering.
import { buttonState, place, pointerGestureOwned, uiCtx, widgetId, } from "../../ui/core/index.js";
import { claimWheel, uiPointer } from "../../ui/core/input.js";
import { dolly, orbit } from "../../render3d/camera.js";
import { updateWorldMatrices } from "../../render3d/scene.js";
let active = null;
/** Draw a live 3D scene as a widget.
 *
 *    const state = UI.viewport3d({
 *      renderer, scene, camera, interactive: true, h: 220,
 *    });
 *
 *  Call it in the draw phase, inside whatever container should own the space.
 *  It advances nothing itself — animate the scene before calling, and the
 *  world matrices are refreshed here. */
export function viewport3d(opts) {
    // `place`, not `fillRect`: a viewport has a natural size and must reserve
    // only that, or the sibling after it in the row gets nothing.
    const rect = place(opts, opts.w ?? 160, opts.h ?? 120, "viewport3d", true);
    const ctx = uiCtx();
    const p = uiPointer();
    const hovered = p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h;
    const id = widgetId(opts.id, "viewport3d") ?? "viewport3d";
    const clickState = opts.onClick ? buttonState(rect, p) : null;
    const clicked = Boolean(opts.onClick && clickState?.clicked && !pointerGestureOwned());
    if (clicked)
        opts.onClick?.();
    let dragging = false;
    if (opts.interactive) {
        if (hovered && p.pressed && !active)
            active = { id, lastX: p.x, lastY: p.y };
        const drag = active;
        if (drag?.id === id) {
            if (!p.down) {
                active = null;
            }
            else {
                dragging = true;
                // A per-frame DELTA, not the offset from the press point: orbiting is
                // relative, so accumulating from the press would re-apply the whole
                // drag every frame and spin the camera away.
                orbit(opts.camera, p.x - drag.lastX, p.y - drag.lastY, opts.sensitivity ?? 0.01);
                drag.lastX = p.x;
                drag.lastY = p.y;
            }
        }
        // `claimWheel` keeps a viewport inside a scrolling list from stealing the
        // list's scroll — and vice versa. atMin/atMax report the dolly limits, so
        // a fully zoomed-in viewport passes the wheel on rather than swallowing it.
        const wheel = claimWheel(hovered, p.wheel, false, false);
        if (wheel !== 0)
            dolly(opts.camera, wheel * 0.0015);
    }
    if (rect.w < 1 || rect.h < 1)
        return { rect, dragging };
    if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    if (opts.redraw !== false) {
        // Match the backing store to what the blit will actually cover on the
        // physical display. Rendering at the logical size and letting `drawImage`
        // upscale is the difference between a crisp model and a soft one on every
        // retina screen. The context transform ALREADY carries the app's DPR and
        // letterbox scale as well as any `UI.scaled` block, so it is the whole
        // answer — multiplying by `viewport.dpr` again would double-count it.
        opts.renderer.resize(rect.w, rect.h, deviceScale(ctx) * Math.max(0.1, opts.resolutionScale ?? 1), { retainBackingStore: true });
        updateWorldMatrices(opts.scene);
        opts.renderer.render(opts.scene, opts.camera);
    }
    // A shared renderer may retain a larger backing store after drawing the hero
    // view. Crop to the region written by this viewport instead of scaling the
    // whole canvas, which would include stale pixels from the larger target.
    ctx.drawImage(opts.renderer.canvas, 0, 0, opts.renderer.renderWidth, opts.renderer.renderHeight, rect.x, rect.y, rect.w, rect.h);
    return { rect, dragging };
}
/** How many device pixels one UI unit covers, read back from the context's
 *  own transform — the ground truth for how large this rect lands on the
 *  display, and already inclusive of DPR, letterboxing and `UI.scaled`. */
function deviceScale(ctx) {
    const t = ctx.getTransform?.();
    if (!t)
        return 1;
    // A rotated or skewed context has no single scale; the magnitude of the
    // first basis vector is the right answer for the uniform case and a
    // reasonable one otherwise.
    return Math.hypot(t.a, t.b) || 1;
}
