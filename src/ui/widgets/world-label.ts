import { Camera, type CameraLens } from "../../camera/index.js";
import { App } from "../../engine/index.js";
import { clamp } from "../../mathf.js";
import { text, type TextOptions } from "../core/index.js";

export interface WorldLabelTarget {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface WorldLabelOptions extends Pick<TextOptions, "size" | "bold" | "font" | "color"> {
  /** Camera used to map the target. Defaults to `Camera`. */
  camera?: Pick<CameraLens, "toScreen">;
  /** Label offset from the target's center in world pixels. Default y = -20. */
  offset?: { x?: number; y?: number };
  /** Screen-edge inset in logical pixels. Default 24. */
  margin?: number;
  /** Append a directional arrow while the target is off screen. Default true. */
  arrow?: boolean;
}

export interface WorldLabelResult {
  x: number;
  y: number;
  offscreen: boolean;
}

const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
const directionArrow = (x: number, y: number) =>
  arrows[Math.round(Math.atan2(y, x) / (Math.PI / 4) + 8) % 8];

/** Draw a camera-aware label over a world target. On-screen labels track the
 * target; off-screen labels clamp to the viewport and point toward it. */
export function worldLabel(
  label: string,
  target: WorldLabelTarget,
  options: WorldLabelOptions = {},
): WorldLabelResult {
  const camera = options.camera ?? Camera;
  const view = App.viewport;
  const wx = target.x + (target.w ?? 0) / 2;
  const wy = target.y + (target.h ?? 0) / 2;
  const center = camera.toScreen({ x: wx, y: wy });
  const labelAt = camera.toScreen({
    x: wx + (options.offset?.x ?? 0),
    y: wy + (options.offset?.y ?? -20),
  });
  const offscreen = center.x < 0 || center.x > view.w || center.y < 0 || center.y > view.h;
  const point = offscreen ? center : labelAt;
  const margin = options.margin ?? 24;
  const x = clamp(point.x, view.safeLeft + margin, view.w - view.safeRight - margin);
  const y = clamp(point.y, view.safeTop + 8, view.h - view.safeBottom - 20);
  const suffix =
    offscreen && options.arrow !== false ? ` ${directionArrow(center.x - x, center.y - y)}` : "";
  text(`${label}${suffix}`, {
    x,
    y,
    align: "center",
    size: options.size,
    bold: options.bold,
    font: options.font,
    color: options.color,
  });
  return { x, y, offscreen };
}
