import { clamp } from "../mathf.js";

export interface Camera {
  x: number;
  y: number;
  /** Magnification (default 1). >1 zooms in. Applied about the view's top-left
   *  in `sx`/`sy`; the follow/clamp logic accounts for it. */
  zoom: number;
}

export interface CameraConfig {
  /** World width in logical pixels */
  worldW: number;
  /** World height in logical pixels */
  worldH: number;
  /** Viewport width (screen pixels) */
  viewW: number;
  /** Viewport height (screen pixels) */
  viewH: number;
  /** Damping factor 0..1 (lower = smoother), normalized to one 60 Hz step.
   *  Default 0.08 */
  damping?: number;
  /** Horizontal dead-zone as fraction of viewW (0 = track immediately). Default 0 */
  deadZoneX?: number;
  /** Vertical dead-zone as fraction of viewH. Default 0 */
  deadZoneY?: number;
}

/** Clamp to world bounds; when the world is smaller than the view, center the
 *  world instead of pinning it to the top-left corner. */
function clampAxis(want: number, world: number, view: number): number {
  if (world < view) return (world - view) / 2;
  // Reachable only when world ≥ view, so `world - view ≥ 0` — a plain clamp.
  return clamp(want, 0, world - view);
}

export function createCamera(config: CameraConfig): Camera & {
  /** Move toward the target with damping. Call once per frame; pass
   *  `Draw.frameScale` as `dtScale` so convergence speed is the same on 60 and
   *  144 Hz displays (defaults to 1 = one fixed step's worth). */
  update(tx: number, ty: number, dtScale?: number): void;
  /** Jump instantly to the target (still clamped) — e.g. on scene entry, so the
   *  camera doesn't visibly lerp in from (0,0). */
  snapTo(tx: number, ty: number): void;
  /** Convert world X to screen X */
  sx(wx: number): number;
  /** Convert world Y to screen Y */
  sy(wy: number): number;
  /** Convert screen X back to world X (pointer → world). */
  wx(screenX: number): number;
  /** Convert screen Y back to world Y. */
  wy(screenY: number): number;
  /** Update the viewport size (call from `Stage.onResize`) so following and
   *  clamping keep matching the screen. */
  setView(viewW: number, viewH: number): void;
} {
  const damp = config.damping ?? 0.08;

  const cam: Camera = { x: 0, y: 0, zoom: 1 };

  /** Where the camera wants to be to frame (tx, ty), clamped to the world. */
  function desired(tx: number, ty: number): { x: number; y: number } {
    // Visible world region shrinks as zoom grows.
    const effW = config.viewW / cam.zoom;
    const effH = config.viewH / cam.zoom;
    let wantX = tx - effW / 2;
    let wantY = ty - effH / 2;

    // Dead-zone: only move if target is far enough from camera center
    const deadX = ((config.deadZoneX ?? 0) * config.viewW) / cam.zoom;
    const deadY = ((config.deadZoneY ?? 0) * config.viewH) / cam.zoom;
    if (Math.abs(tx - (cam.x + effW / 2)) < deadX) wantX = cam.x;
    if (Math.abs(ty - (cam.y + effH / 2)) < deadY) wantY = cam.y;

    return { x: clampAxis(wantX, config.worldW, effW), y: clampAxis(wantY, config.worldH, effH) };
  }

  function update(tx: number, ty: number, dtScale = 1): void {
    const want = desired(tx, ty);
    // Frame-rate-corrected damping: `damp` per 60 Hz step regardless of how
    // many (or few) real frames render per step.
    const k = dtScale === 1 ? damp : 1 - Math.pow(1 - damp, dtScale);
    cam.x += (want.x - cam.x) * k;
    cam.y += (want.y - cam.y) * k;
  }

  function snapTo(tx: number, ty: number): void {
    const want = desired(tx, ty);
    cam.x = want.x;
    cam.y = want.y;
  }

  function sx(wx: number): number {
    return (wx - cam.x) * cam.zoom;
  }
  function sy(wy: number): number {
    return (wy - cam.y) * cam.zoom;
  }
  function toWorldX(screenX: number): number {
    return screenX / cam.zoom + cam.x;
  }
  function toWorldY(screenY: number): number {
    return screenY / cam.zoom + cam.y;
  }

  function setView(viewW: number, viewH: number): void {
    config.viewW = viewW;
    config.viewH = viewH;
  }

  return Object.assign(cam, { update, snapTo, sx, sy, wx: toWorldX, wy: toWorldY, setView });
}
