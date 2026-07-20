// ---------- Smooth 2D camera ----------
// Follows a target with lerp damping, clamped to world bounds.
// Call `update` each frame, then use `x` / `y` as render offsets.

import { Loop } from "./engine.js";

export interface Camera {
  x: number;
  y: number;
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
  /** Damping factor 0..1 (lower = smoother). Default 0.08 */
  damping?: number;
  /** Horizontal dead-zone as fraction of viewW (0 = track immediately). Default 0 */
  deadZoneX?: number;
  /** Vertical dead-zone as fraction of viewH. Default 0 */
  deadZoneY?: number;
}

export function createCamera(config: CameraConfig): Camera & {
  /** Update camera position toward target. Call once per frame. */
  update(tx: number, ty: number): void;
  /** Convert world X to screen X */
  sx(wx: number): number;
  /** Convert world Y to screen Y */
  sy(wy: number): number;
} {
  const damp = config.damping ?? 0.08;
  const deadX = (config.deadZoneX ?? 0) * config.viewW;
  const deadY = (config.deadZoneY ?? 0) * config.viewH;

  const cam: Camera = { x: 0, y: 0 };

  function update(tx: number, ty: number): void {
    // Center target on screen
    let wantX = tx - config.viewW / 2;
    let wantY = ty - config.viewH / 2;

    // Dead-zone: only move if target is far enough from camera center
    const cx = cam.x + config.viewW / 2;
    const cy = cam.y + config.viewH / 2;
    if (Math.abs(tx - cx) < deadX) wantX = cam.x;
    if (Math.abs(ty - cy) < deadY) wantY = cam.y;

    // Lerp toward target
    cam.x += (wantX - cam.x) * damp;
    cam.y += (wantY - cam.y) * damp;

    // Clamp to world bounds
    cam.x = Math.max(0, Math.min(config.worldW - config.viewW, cam.x));
    cam.y = Math.max(0, Math.min(config.worldH - config.viewH, cam.y));
  }

  function sx(wx: number): number {
    return wx - cam.x;
  }
  function sy(wy: number): number {
    return wy - cam.y;
  }

  return Object.assign(cam, { update, sx, sy });
}

// ---------- Parallax scroll iterator ----------

/** Iterate evenly-spaced columns for a scrolling/parallax background.
 *
 *  `scroll` is how far the layer has moved (e.g. `distance * parallaxFactor`),
 *  `spacing` the gap between columns, `width` the viewport width. For each
 *  visible column `cb` receives:
 *   - `screenX`  — where to draw it (already wrapped),
 *   - `worldSeed`— a value tied to the world column, *stable* across scroll
 *     wraps, so procedural shapes (building heights, peaks) don't shimmer when
 *     the offset resets,
 *   - `index`    — the integer world-column index.
 *
 *  `pad` extends iteration by N columns past each edge for wide props.
 *  Works for negative scroll too. */
export function scrollColumns(
  scroll: number,
  spacing: number,
  width: number,
  cb: (screenX: number, worldSeed: number, index: number) => void,
  pad = 1,
): void {
  const offset = ((scroll % spacing) + spacing) % spacing;
  const colBase = Math.floor(scroll / spacing) * spacing;
  for (let bx = -spacing * pad; bx < width + spacing * pad; bx += spacing) {
    cb(bx - offset, bx + colBase, Math.round((bx + colBase) / spacing));
  }
}

// ---------- Screen shake ----------
// A decaying random offset to translate the scene by, for impact/juice.

/** A live screen-shake offset. `x`/`y` are the current jitter; `add` triggers a
 *  shake; `advance(dt)` ages it (linear falloff to zero over the duration). */
export interface ShakeState {
  readonly x: number;
  readonly y: number;
  /** True while a shake is still playing out. */
  readonly active: boolean;
  /** Start/refresh a shake: `amplitude` px, fading over `durationMs`. Stacks by
   *  taking the stronger amplitude and restarting the fade. */
  add(amplitude: number, durationMs: number): void;
  /** Advance the shake by `dt` ms, re-rolling the offset. */
  advance(dt: number): void;
}

/** Create an independent screen-shake. Pure (drive `advance` yourself); the
 *  default `Camera.shake` wires one to the loop's fixed step. `rng` is injectable
 *  for tests. */
export function createShake(rng: () => number = Math.random): ShakeState {
  let amp = 0;
  let duration = 0;
  let elapsed = 0;
  let ox = 0;
  let oy = 0;
  return {
    get x() {
      return ox;
    },
    get y() {
      return oy;
    },
    get active() {
      return elapsed < duration;
    },
    add(amplitude, durationMs) {
      amp = Math.max(amp, amplitude);
      duration = durationMs;
      elapsed = 0;
    },
    advance(dt) {
      if (elapsed >= duration) {
        amp = 0;
        ox = 0;
        oy = 0;
        return;
      }
      elapsed += dt;
      const k = Math.max(0, 1 - elapsed / duration); // linear falloff
      ox = (rng() * 2 - 1) * amp * k;
      oy = (rng() * 2 - 1) * amp * k;
    },
  };
}

// Default facade: one shake, aged on the loop's fixed step (so it pauses with
// the loop and is frame-rate independent).
let defaultShake = createShake();
let shakeWired = false;

function ensureShakeWired(): void {
  if (shakeWired) return;
  shakeWired = true;
  Loop.onStep(() => defaultShake.advance(Loop.step));
}

/** The default screen-shake, driven by the loop. Trigger with
 *  `Camera.shake(amplitude, durationMs)`, then translate your scene by
 *  `Camera.shakeX` / `Camera.shakeY` before drawing. */
export function shake(amplitude: number, durationMs: number): void {
  ensureShakeWired();
  defaultShake.add(amplitude, durationMs);
}

/** Current horizontal shake offset (px). */
export function shakeX(): number {
  return defaultShake.x;
}

/** Current vertical shake offset (px). */
export function shakeY(): number {
  return defaultShake.y;
}

/** Reset the default shake and its loop wiring — for tests. */
export function _resetShake(): void {
  defaultShake = createShake();
  shakeWired = false;
}
