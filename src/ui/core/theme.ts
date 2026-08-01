// ---------- Theme painting ----------
// Drawing helpers that style from the shared `Theme` tokens. They need text
// measurement (a UI-state concern), so they stay here; the tokens themselves
// are core and re-exported below so `UI.setTheme` stays one import for callers.

import { lineMetrics, measureWidth } from "./measure.js";
import {
  theme,
  type NineSliceRegion,
  type TilesetButtonState,
  type TilesetButtonVariant,
  type TilesetFrameRole,
} from "@src/ui/theme.js";

export {
  defaultTheme,
  getTheme,
  resolveThemeTextPadding,
  setTheme,
  theme,
  withTheme,
} from "@src/ui/theme.js";
export {
  createTilesetSkin,
  createTilesetSkinFromManifest,
  frameFromCell,
  inspectTilesetSkin,
  type NineSliceRegion,
  type TileRegion,
  type TilesetFrameRole,
  type TilesetButtonState,
  type TilesetButtonVariant,
  type TilesetButtonVariants,
  type TilesetSkin,
  type TilesetSkinOptions,
  type TilesetSprite,
  type TilesetCellSource,
  type TilesetManifestRegion,
  type TilesetManifestSprite,
  type TilesetSkinManifest,
  type TilesetMapping,
  type TilesetButtonVariantsManifest,
  type TilesetDebugEntry,
  type TilesetDebugInfo,
  type ThemeOverrides,
  type ThemePadding,
  type ThemeSpacing,
  type ThemeTextPadding,
  type ThemeTextOutline,
  type ThemeButtonText,
  type ThemeSelect,
  type ThemeFocusStyle,
  shade,
} from "@src/ui/theme.js";
export type { Theme } from "@src/ui/theme.js";

export const uiFont = (size = theme.fontSize, bold = false) =>
  `${bold ? "bold " : ""}${size}px ${theme.font}`;

/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export type ThemeBoxRole =
  | "panel"
  | "panelTitle"
  | "menuGroup"
  | "button"
  | "input"
  | "tab"
  | "barTrack"
  | "barFill"
  | "sliderTrack"
  | "sliderFill"
  | "scrollTrack"
  | "scrollThumb";
export type ThemeBoxState = "default" | "hover" | "active" | "disabled";

function rotatedFrame(
  frame: NineSliceRegion,
  axis: "x" | "y" | undefined,
): "cw" | "ccw" | undefined {
  if (!axis || (frame.orientation ?? "x") === axis) return undefined;
  return axis === "y" ? "cw" : "ccw";
}

function orientedInsets(
  frame: NineSliceRegion,
  rotation: "cw" | "ccw" | undefined,
): NineSliceRegion["insets"] {
  if (rotation === "cw") {
    return {
      left: frame.insets.top,
      top: frame.insets.right,
      right: frame.insets.bottom,
      bottom: frame.insets.left,
    };
  }
  if (rotation === "ccw") {
    return {
      left: frame.insets.bottom,
      top: frame.insets.left,
      right: frame.insets.top,
      bottom: frame.insets.right,
    };
  }
  return frame.insets;
}

/** Paint one named sprite from the active skin. Widgets use semantic names
 *  (`selectArrow`, `checkboxOn`, `radioOff`, …), while a theme decides which
 *  atlas region supplies that name. Returns false when the skin has no such
 *  sprite so the caller can use its procedural fallback. */
export function drawThemeSprite(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  w?: number,
  h?: number,
): boolean {
  const sprite = theme.skin?.sprites.icons?.[name];
  if (!sprite) return false;
  const dw = w ?? sprite.region.sw;
  const dh = h ?? sprite.region.sh;
  if (dw <= 0 || dh <= 0) return false;
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  try {
    ctx.drawImage(
      sprite.image,
      sprite.region.sx,
      sprite.region.sy,
      sprite.region.sw,
      sprite.region.sh,
      x,
      y,
      dw,
      dh,
    );
  } finally {
    ctx.imageSmoothingEnabled = previousSmoothing;
  }
  return true;
}

function frameRole(role: ThemeBoxRole, state: ThemeBoxState): TilesetFrameRole {
  if (role === "panel") return "panel";
  if (role === "panelTitle") return "panelTitle";
  if (role === "menuGroup") return "menuGroup";
  if (role === "barTrack") return "barTrack";
  if (role === "barFill") return "barFill";
  if (role === "sliderTrack") return "sliderTrack";
  if (role === "sliderFill") return "sliderFill";
  if (role === "scrollTrack") return "scrollTrack";
  if (role === "scrollThumb") {
    if (state === "active") return "scrollThumbActive";
    if (state === "hover") return "scrollThumbHover";
    return "scrollThumb";
  }
  if (role === "input") {
    if (state === "hover") return "inputHover";
    if (state === "active") return "inputActive";
    if (state === "disabled") return "inputDisabled";
    return "input";
  }
  if (role === "tab") {
    if (state === "active") return "tabActive";
    if (state === "hover") return "tabHover";
    return "tab";
  }
  if (state === "hover") return "buttonHover";
  if (state === "active") return "buttonActive";
  if (state === "disabled") return "disabled";
  return "button";
}

function roleFrame(
  frames: Partial<Record<TilesetFrameRole, NineSliceRegion>> | undefined,
  role: ThemeBoxRole,
  state: ThemeBoxState,
): NineSliceRegion | undefined {
  if (!frames) return undefined;
  const primary = frames[frameRole(role, state)];
  if (primary) return primary;
  if (role === "tab" && state !== "default") return frames.tab;
  if (role === "input" && state !== "default")
    return frames.input ?? (state === "disabled" ? frames.disabled : undefined);
  return undefined;
}

function drawImagePart(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}

function repeatSlice(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  let y = dy;
  let remainingY = dh;
  while (remainingY > 0) {
    const sliceH = Math.min(sh, remainingY);
    let x = dx;
    let remainingX = dw;
    while (remainingX > 0) {
      const sliceW = Math.min(sw, remainingX);
      drawImagePart(ctx, image, sx, sy, sliceW, sliceH, x, y, sliceW, sliceH);
      x += sliceW;
      remainingX -= sliceW;
    }
    y += sliceH;
    remainingY -= sliceH;
  }
}

function drawOrientedNineSlice(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  frame: NineSliceRegion,
  x: number,
  y: number,
  w: number,
  h: number,
  axis?: "x" | "y",
): void {
  const rotation = rotatedFrame(frame, axis);
  if (!rotation) {
    drawNineSlice(ctx, image, frame, x, y, w, h);
    return;
  }

  ctx.save();
  if (rotation === "cw") {
    ctx.translate(x + w, y);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(x, y + h);
    ctx.rotate(-Math.PI / 2);
  }
  drawNineSlice(ctx, image, frame, 0, 0, h, w);
  ctx.restore();
}

/** Paint a pixel-native nine-slice region, clipping partial repeats. */
export function drawNineSlice(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  region: NineSliceRegion,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { left, top, right, bottom } = region.insets;
  const centerW = region.sw - left - right;
  const centerH = region.sh - top - bottom;
  if (w < left + right || h < top + bottom) {
    // A control smaller than its fixed corners cannot be represented without
    // overlapping slices; scale the complete frame only for this edge case.
    drawImagePart(ctx, image, region.sx, region.sy, region.sw, region.sh, x, y, w, h);
    return;
  }

  const dx = x + left;
  const dy = y + top;
  const dw = w - left - right;
  const dh = h - top - bottom;
  const sx = region.sx;
  const sy = region.sy;

  drawImagePart(ctx, image, sx, sy, left, top, x, y, left, top);
  drawImagePart(ctx, image, sx + region.sw - right, sy, right, top, x + w - right, y, right, top);
  drawImagePart(
    ctx,
    image,
    sx,
    sy + region.sh - bottom,
    left,
    bottom,
    x,
    y + h - bottom,
    left,
    bottom,
  );
  drawImagePart(
    ctx,
    image,
    sx + region.sw - right,
    sy + region.sh - bottom,
    right,
    bottom,
    x + w - right,
    y + h - bottom,
    right,
    bottom,
  );

  repeatSlice(ctx, image, sx + left, sy, centerW, top, dx, y, dw, top);
  repeatSlice(
    ctx,
    image,
    sx + left,
    sy + region.sh - bottom,
    centerW,
    bottom,
    dx,
    y + h - bottom,
    dw,
    bottom,
  );
  repeatSlice(ctx, image, sx, sy + top, left, centerH, x, dy, left, dh);
  repeatSlice(
    ctx,
    image,
    sx + region.sw - right,
    sy + top,
    right,
    centerH,
    x + w - right,
    dy,
    right,
    dh,
  );
  repeatSlice(ctx, image, sx + left, sy + top, centerW, centerH, dx, dy, dw, dh);
}

/** Fill (and optionally stroke) a themed box: rounded per `theme.radius`,
 *  stroked at `theme.borderWidth` inset so the outline stays inside the rect.
 *  `radius`/`border` override the theme for one call. */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    fill?: string;
    stroke?: string;
    radius?: number;
    border?: number;
    role?: ThemeBoxRole;
    state?: ThemeBoxState;
    variant?: "default" | TilesetButtonVariant;
    axis?: "x" | "y";
  },
): void {
  const frames = theme.skin?.frames;
  const state = opts.state ?? "default";
  const variant = opts.variant ?? "default";
  const variantFrame =
    opts.role === "button" && variant !== "default"
      ? (theme.skin?.buttonVariants?.[variant]?.[state as TilesetButtonState] ??
        theme.skin?.buttonVariants?.[variant]?.default)
      : undefined;
  const themedRoleFrame = opts.role ? roleFrame(frames, opts.role, state) : undefined;
  const requestedFrame =
    opts.role === "button" && variant !== "default"
      ? variantFrame
      : (variantFrame ?? themedRoleFrame);
  const frame =
    requestedFrame ??
    (opts.role === "button" && variant === "default"
      ? frames?.button
      : opts.role === "tab"
        ? frames?.tab
        : opts.role === "input"
          ? frames?.input
          : undefined);
  if (frame && theme.skin) {
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    try {
      // Some pixel frames are outlines with transparent centers (including
      // the Tiny RPG bar/slider art). Keep the caller's fill visible beneath
      // the nine-slice frame instead of silently dropping it because a skin
      // was selected.
      const needsFrameUnderlay =
        opts.role === "barTrack" ||
        opts.role === "barFill" ||
        opts.role === "sliderTrack" ||
        opts.role === "sliderFill" ||
        opts.role === "scrollTrack" ||
        opts.role === "scrollThumb";
      if (opts.fill && needsFrameUnderlay) {
        const { left, top, right, bottom } = orientedInsets(frame, rotatedFrame(frame, opts.axis));
        const innerW = w >= left + right ? w - left - right : w;
        const innerH = h >= top + bottom ? h - top - bottom : h;
        const innerX = w >= left + right ? x + left : x;
        const innerY = h >= top + bottom ? y + top : y;
        ctx.fillStyle = opts.fill;
        ctx.beginPath();
        ctx.rect(innerX, innerY, innerW, innerH);
        ctx.fill();
      }
      drawOrientedNineSlice(ctx, frame.image ?? theme.skin.image, frame, x, y, w, h, opts.axis);
    } finally {
      ctx.imageSmoothingEnabled = previousSmoothing;
    }
    return;
  }
  const r = opts.radius ?? theme.radius;
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (opts.stroke) {
    const bw = opts.border ?? theme.borderWidth;
    if (bw > 0) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = bw;
      const half = bw / 2;
      roundRectPath(ctx, x + half, y + half, w - bw, h - bw, Math.max(0, r - half));
      ctx.stroke();
    }
  }
}

/** Trim `text` with a trailing ellipsis until it fits `maxW` (binary search).
 *  Returns the string unchanged when it already fits. Every probe goes through
 *  the memo, so a label that keeps its text and width costs map hits after the
 *  first frame instead of ~log₂(n) real measurements. */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0 || measureWidth(ctx, text) <= maxW) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureWidth(ctx, text.slice(0, mid) + ell) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

/** Vertically centered text using stable font line metrics — the canvas
 *  "middle" baseline sits visibly high for most fonts. Honors the current textAlign.
 *  `maxW` clips with an ellipsis (via `ellipsize`) so a label can never spill
 *  out of its widget. */
export function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  maxW?: number,
): void {
  // measureText's actualBoundingBox values are relative to the CURRENT
  // textBaseline — pin it before measuring, or state leaked from caller
  // drawing (e.g. "middle") skews the correction.
  ctx.textBaseline = "alphabetic";
  // Clip to width with an ellipsis rather than passing `maxW` to fillText,
  // which SQUISHES the glyphs horizontally. (Multi-line wrapping is handled by
  // the caller via `wrapLines`; this keeps a single line from stretching.)
  const str = maxW !== undefined ? ellipsize(ctx, text, maxW) : text;
  // Use font-level metrics rather than the current string's actual bounds.
  // This keeps every single-line label on the same alphabetic baseline even
  // when one label contains descenders and another does not.
  const { asc, desc } = lineMetrics(ctx);
  if (asc || desc) {
    const baseline = cy + (asc - desc) / 2;
    const outline = theme.textOutline;
    if (outline && outline.width > 0 && ctx.strokeText) {
      ctx.save();
      ctx.strokeStyle = outline.color;
      ctx.lineWidth = outline.width;
      ctx.lineJoin = "round";
      ctx.strokeText(str, x, baseline);
      ctx.restore();
    }
    ctx.fillText(str, x, baseline);
  } else {
    // Metrics unavailable (mocked ctx) — middle baseline is the best we have.
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, cy);
  }
}
