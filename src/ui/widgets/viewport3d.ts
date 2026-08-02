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

import { Flowable, place, theme, uiCtx } from "@src/ui/core/index.js";
import { claimWheel, setCursor, uiPointer } from "@src/ui/core/input.js";
import { dolly, orbit } from "@src/render3d/camera.js";
import { updateWorldMatrices } from "@src/render3d/scene.js";
import type { Camera3D } from "@src/render3d/camera.js";
import type { Renderer3D } from "@src/render3d/renderer.js";
import type { Scene3D } from "@src/render3d/scene.js";

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
  /** Stable id — for layout capture and for keeping drag state across frames
   *  when several viewports are on screen. */
  id?: string;
}

/** What the viewport reports back this frame. */
export interface Viewport3DState {
  /** The rect it occupied, in UI coords. */
  rect: { x: number; y: number; w: number; h: number };
  /** Pointer is inside. */
  hovered: boolean;
  /** Pointer is dragging this viewport (only when `interactive`). */
  dragging: boolean;
}

// Drag state is keyed by widget id rather than held in one slot: two
// interactive viewports on one screen must not fight over a single "who is
// dragging" flag, and the pointer can only be in one of them anyway.
interface DragState {
  id: string;
  lastX: number;
  lastY: number;
}
let active: DragState | null = null;

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
export function viewport3d(opts: Viewport3DOptions): Viewport3DState {
  // `place`, not `fillRect`: a viewport has a natural size and must reserve
  // only that, or the sibling after it in the row gets nothing.
  const rect = place(opts, opts.w ?? 160, opts.h ?? 120, "viewport3d", true);
  const ctx = uiCtx();
  const p = uiPointer();
  const hovered = p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h;

  const id = opts.id ?? "viewport3d";
  let dragging = false;
  if (opts.interactive) {
    if (hovered && p.pressed && !active) active = { id, lastX: p.x, lastY: p.y };
    if (active?.id === id) {
      if (!p.down) {
        active = null;
      } else {
        dragging = true;
        // A per-frame DELTA, not the offset from the press point: orbiting is
        // relative, so accumulating from the press would re-apply the whole
        // drag every frame and spin the camera away.
        orbit(opts.camera, p.x - active.lastX, p.y - active.lastY, opts.sensitivity ?? 0.01);
        active.lastX = p.x;
        active.lastY = p.y;
      }
    }
    if (dragging) setCursor("grabbing", 1);
    else if (hovered) setCursor("grab", 0);

    // `claimWheel` keeps a viewport inside a scrolling list from stealing the
    // list's scroll — and vice versa. atMin/atMax report the dolly limits, so
    // a fully zoomed-in viewport passes the wheel on rather than swallowing it.
    const wheel = claimWheel(hovered, p.wheel, false, false);
    if (wheel !== 0) dolly(opts.camera, wheel * 0.0015);
  }

  if (rect.w < 1 || rect.h < 1) return { rect, hovered, dragging };

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
    opts.renderer.resize(rect.w, rect.h, deviceScale(ctx), { retainBackingStore: true });
    updateWorldMatrices(opts.scene);
    opts.renderer.render(opts.scene, opts.camera);
  }

  // A shared renderer may retain a larger backing store after drawing the hero
  // view. Crop to the region written by this viewport instead of scaling the
  // whole canvas, which would include stale pixels from the larger target.
  ctx.drawImage(
    opts.renderer.canvas,
    0,
    0,
    opts.renderer.renderWidth,
    opts.renderer.renderHeight,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
  );

  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = theme.borderWidth;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }

  return { rect, hovered, dragging };
}

/** How many device pixels one UI unit covers, read back from the context's
 *  own transform — the ground truth for how large this rect lands on the
 *  display, and already inclusive of DPR, letterboxing and `UI.scaled`. */
function deviceScale(ctx: CanvasRenderingContext2D): number {
  const t = ctx.getTransform?.();
  if (!t) return 1;
  // A rotated or skewed context has no single scale; the magnitude of the
  // first basis vector is the right answer for the uniform case and a
  // reasonable one otherwise.
  return Math.hypot(t.a, t.b) || 1;
}
