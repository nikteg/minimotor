import type { Rect } from "./app.js";
import { drawText, monoFont, type TextHAlign, type TextVAlign } from "@src/engine/text.js";
import { blitPixelAligned } from "./pixel-raster.js";
import type { SceneRenderer } from "./render/target.js";
import { createDrawRecorder, type DrawRecorder } from "./render/record-ctx.js";
import { readTransform } from "./render/math.js";

type Point = { x: number; y: number };

interface DrawTarget {
  readonly ctx: CanvasRenderingContext2D;
  readonly spriteScratch: DrawSprite[];
  readonly spriteOne: DrawSprite;
  readonly spriteOneList: DrawSprite[];
  readonly scene: SceneRenderer | null;
  readonly recorder: DrawRecorder | null;
}

/** Anything `Draw.text` can draw glyphs from that is not a CSS font string —
 *  in practice a `Font.atlas` bitmap font. Declared structurally here for the
 *  same reason `TilesLike` is: the renderer must not import the capability. */
export interface FontLike {
  /** Draw `str` at (x, y). The `Draw.text` options are passed straight
   *  through, minus the ones only a CSS font understands. */
  render(
    ctx: CanvasRenderingContext2D,
    str: string,
    x: number,
    y: number,
    style: {
      color?: string;
      scale?: number;
      align?: TextHAlign;
      baseline?: TextVAlign;
      tracking?: number;
      lineHeight?: number;
      outline?: string;
      outlineWidth?: number;
      outlineStyle?: "round" | "cross";
      shadow?: { x: number; y: number };
      shadowColor?: string;
    },
  ): void;
}

/** Options for `Draw.text` — plain ambient-space text (world-anchored damage
 *  numbers, name tags). For themed, screen-space HUD text use `UI.text`. */
export interface DrawTextOptions {
  /** Ambient-space x of the text, anchored by `align`. */
  x: number;
  /** Ambient-space y of the text, anchored by `baseline`. */
  y: number;
  /** Font size in px (monospace). Default 16. Ignored by a bitmap font, which
   *  has one true size — use `scale` instead. */
  size?: number;
  /** Full CSS font string — overrides `size` — or a bitmap font from
   *  `Font.atlas`/`Font.glyphs`. */
  font?: string | FontLike;
  /** Fill. A CSS color, or a gradient from `Draw.linear`/`Draw.radial`. Default "#fff".
   *  A bitmap font tints, so it takes colors but not gradients. */
  color?: Fill;
  /** Horizontal anchor of `x`. Default "left". */
  align?: TextHAlign;
  /** Vertical anchor of `y`. Default "top". */
  baseline?: TextVAlign;
  /** Bitmap fonts only: integer upscale factor. Default 1. */
  scale?: number;
  /** Bitmap fonts only: extra pixels between glyphs, overriding the font's own
   *  tracking. */
  tracking?: number;
  /** Bitmap fonts only: line spacing in pixels, for text containing "\n". */
  lineHeight?: number;
  /** Bitmap fonts only: halo colour behind the glyphs, for legibility over
   *  busy backgrounds. Grows outward, so it does not change the text width. */
  outline?: string;
  /** Bitmap fonts only: outline thickness in font pixels. Default 1. */
  outlineWidth?: number;
  /** Bitmap fonts only: "round" haloes all eight neighbours, "cross" only the
   *  four orthogonal. Default "round". */
  outlineStyle?: "round" | "cross";
  /** Bitmap fonts only: drop-shadow offset in font pixels. */
  shadow?: { x: number; y: number };
  /** Bitmap fonts only: shadow colour. Default: `outline`, else black. */
  shadowColor?: string;
}

// ---------- Ambient-space drawing primitives ----------
// Draw.* renders in the AMBIENT coordinate space: screen at the top level,
// world inside `Camera.render` blocks (the camera sets the ctx transform).
// Data never draws itself — this is the only namespace that knows what a
// canvas is. Geometry takes positional args for literals plus a structural
// overload (anything with the fields IS the shape).

/** A fill: a CSS color string, or a gradient from `Draw.linear`/`Draw.radial`. */
export type Fill = string | CanvasGradient;

/** Gradient color stops: `[offset 0..1, color]` pairs. */
export type GradientStops = Array<[number, string]>;

/** Fill a rectangle. Positional (`rect(x, y, w, h, color)`) or structural
 *  (`rect(someRect, color)` — anything with `x`/`y`/`w`/`h`). `color` is a CSS
 *  color or a `Draw.linear`/`Draw.radial` gradient. Screen space at the top
 *  level, world space inside `Camera.render`. */
function rect(this: DrawTarget, x: number, y: number, w: number, h: number, color: Fill): void;
function rect(this: DrawTarget, rect: Rect, color: Fill): void;
function rect(
  this: DrawTarget,
  a: number | Rect,
  b: number | Fill,
  c?: number,
  d?: number,
  e?: Fill,
): void {
  const ctx = this.ctx;
  if (typeof a === "number") {
    ctx.fillStyle = e!;
    ctx.fillRect(a, b as number, c!, d!);
  } else {
    ctx.fillStyle = b as Fill;
    ctx.fillRect(a.x, a.y, a.w, a.h);
  }
}

/** Fill a circle of radius `r`. Positional (`circle(x, y, r, color)`) or with a
 *  point (`circle(pos, r, color)`). */
function circle(this: DrawTarget, x: number, y: number, r: number, color: Fill): void;
function circle(this: DrawTarget, pos: Point, r: number, color: Fill): void;
function circle(
  this: DrawTarget,
  xOrCenter: number | Point,
  yOrRadius: number,
  radiusOrColor: number | Fill,
  maybeColor?: Fill,
): void {
  const ctx = this.ctx;
  let x: number, y: number, r: number, color: Fill;
  if (typeof xOrCenter === "number") {
    x = xOrCenter;
    y = yOrRadius;
    r = radiusOrColor as number;
    color = maybeColor!;
  } else {
    x = xOrCenter.x;
    y = xOrCenter.y;
    r = yOrRadius;
    color = radiusOrColor as Fill;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Stroke a line between two points, `width` px thick (default 1). Positional
 *  (`line(x1, y1, x2, y2, color, width?)`) or point form (`line(a, b, color,
 *  width?)`). */
function line(
  this: DrawTarget,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Fill,
  width?: number,
): void;
function line(this: DrawTarget, a: Point, b: Point, color: Fill, width?: number): void;
function line(
  this: DrawTarget,
  x1OrFrom: number | Point,
  y1OrTo: number | Point,
  x2OrColor?: number | Fill,
  y2OrWidth?: number | Fill,
  maybeColor?: Fill,
  maybeWidth?: number,
): void {
  const ctx = this.ctx;
  let x1: number, y1: number, x2: number, y2: number, color: Fill, width: number;
  if (typeof x1OrFrom === "number") {
    x1 = x1OrFrom;
    y1 = y1OrTo as number;
    x2 = x2OrColor as number;
    y2 = y2OrWidth as number;
    color = maybeColor!;
    width = maybeWidth ?? 1;
  } else {
    x1 = x1OrFrom.x;
    y1 = x1OrFrom.y;
    x2 = (y1OrTo as Point).x;
    y2 = (y1OrTo as Point).y;
    color = x2OrColor as Fill;
    width = (y2OrWidth as number | undefined) ?? 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Outline a rectangle, `width` px thick (default 1). The stroke straddles the
 *  edge, so a 2px outline extends 1px either side. Positional
 *  (`rectStroke(x, y, w, h, color, width?)`) or structural
 *  (`rectStroke(someRect, color, width?)`). */
function rectStroke(
  this: DrawTarget,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Fill,
  width?: number,
): void;
function rectStroke(this: DrawTarget, rect: Rect, color: Fill, width?: number): void;
function rectStroke(
  this: DrawTarget,
  a: number | Rect,
  b: number | Fill,
  // In the structural form this slot carries the line width, not a dimension.
  c?: number,
  d?: number,
  e?: Fill,
  f?: number,
): void {
  const ctx = this.ctx;
  if (typeof a === "number") {
    ctx.strokeStyle = e!;
    ctx.lineWidth = f ?? 1;
    ctx.strokeRect(a, b as number, c as number, d!);
  } else {
    ctx.strokeStyle = b as Fill;
    ctx.lineWidth = (c as number | undefined) ?? 1;
    ctx.strokeRect(a.x, a.y, a.w, a.h);
  }
}

/** Outline a circle of radius `r`, `width` px thick (default 1). Positional
 *  (`circleStroke(x, y, r, color, width?)`) or with a point
 *  (`circleStroke(pos, r, color, width?)`). */
function circleStroke(
  this: DrawTarget,
  x: number,
  y: number,
  r: number,
  color: Fill,
  width?: number,
): void;
function circleStroke(this: DrawTarget, pos: Point, r: number, color: Fill, width?: number): void;
function circleStroke(
  this: DrawTarget,
  xOrCenter: number | Point,
  yOrRadius: number,
  radiusOrColor: number | Fill,
  colorOrWidth?: Fill | number,
  maybeWidth?: number,
): void {
  const ctx = this.ctx;
  let x: number, y: number, r: number, color: Fill, width: number;
  if (typeof xOrCenter === "number") {
    x = xOrCenter;
    y = yOrRadius;
    r = radiusOrColor as number;
    color = colorOrWidth as Fill;
    width = maybeWidth ?? 1;
  } else {
    x = xOrCenter.x;
    y = xOrCenter.y;
    r = yOrRadius;
    color = radiusOrColor as Fill;
    width = (colorOrWidth as number | undefined) ?? 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Fill a closed polygon through `points` — the shape primitive that isn't a
 *  rect or a circle (a triangle ship, a health-bar chevron, a hit spark).
 *  Fewer than 3 points draw nothing.
 *
 *      Draw.poly([{ x: 0, y: -10 }, { x: 8, y: 8 }, { x: -8, y: 8 }], "#0af"); */
function poly(this: DrawTarget, points: readonly Point[], color: Fill): void {
  if (points.length < 3) return;
  const ctx = this.ctx;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
}

/** Blit a plain image — a loaded `HTMLImageElement`, an offscreen canvas from
 *  `Sprites.getSprite`, an `ImageBitmap`. The missing primitive between
 *  `Draw.rect` and the sheet-based `Draw.sprite`/`Draw.sprites`; anchored at
 *  its top-left, unlike the bottom-center `Draw.sprite`.
 *
 *  `w`/`h` default to the image's intrinsic size, so `Draw.image(logo, 20, 20)`
 *  draws it 1:1. Pass one or both to scale. */
function image(
  this: DrawTarget,
  img: CanvasImageSource,
  x: number,
  y: number,
  w?: number,
  h?: number,
): void {
  const ctx = this.ctx;
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  try {
    // Intrinsic size: `naturalWidth` for a loaded <img>, plain `width` for a
    // canvas/bitmap. SVGImageElement's `width` is an SVGAnimatedLength, not a
    // number, hence the typeof guard.
    const src = img as {
      naturalWidth?: number;
      naturalHeight?: number;
      width?: number | unknown;
      height?: number | unknown;
    };
    const iw = src.naturalWidth ?? (typeof src.width === "number" ? src.width : 0);
    const ih = src.naturalHeight ?? (typeof src.height === "number" ? src.height : 0);
    blitPixelAligned(ctx, img, x, y, w ?? iw, h ?? ih);
  } finally {
    ctx.imageSmoothingEnabled = prevSmoothing;
  }
}

/** A linear-gradient fill from (x0,y0) to (x1,y1). Pass the result as any
 *  `Draw`/`UI` color: `Draw.rect(r, Draw.linear(0, 0, 0, h, [[0,"#0af"],[1,"#014"]]))`.
 *  Gradients are immutable and reusable — for static geometry, create the
 *  gradient once and reuse it rather than calling this per frame. */
function linear(
  this: DrawTarget,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: GradientStops,
): CanvasGradient {
  const ctx = this.ctx;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

/** A radial-gradient fill from the inner circle (x0,y0,r0) to the outer
 *  (x1,y1,r1). A 3-arg center form covers the common concentric case.
 *  Gradients are immutable and reusable — for static geometry, create the
 *  gradient once and reuse it rather than calling this per frame. */
function radial(
  this: DrawTarget,
  cx: number,
  cy: number,
  r: number,
  stops: GradientStops,
): CanvasGradient;
function radial(
  this: DrawTarget,
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  stops: GradientStops,
): CanvasGradient;
function radial(
  this: DrawTarget,
  x0: number,
  y0: number,
  r0: number,
  x1OrStops?: number | GradientStops,
  y1?: number,
  r1?: number,
  maybeStops?: GradientStops,
): CanvasGradient {
  const ctx = this.ctx;
  const g = Array.isArray(x1OrStops)
    ? ctx.createRadialGradient(x0, y0, 0, x0, y0, r0)
    : ctx.createRadialGradient(x0, y0, r0, x1OrStops as number, y1!, r1!);
  for (const [at, color] of Array.isArray(x1OrStops) ? x1OrStops : maybeStops!)
    g.addColorStop(at, color);
  return g;
}

/** Run `fn` with a global opacity multiplier applied (nests correctly and
 *  restores after) — fade-outs, ghosts, dimmed layers without touching ctx. */
function opacity(this: DrawTarget, value: number, fn: () => void): void {
  const ctx = this.ctx;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * value;
  try {
    fn();
  } finally {
    ctx.globalAlpha = prev;
  }
}

/** Anything Draw.sprite can render: a sheet cursor (`heroSheet.play(...)`)
 *  or any object exposing a source rect + image. Structural on purpose —
 *  the engine's anim cursors qualify without an import. */
export interface SpriteLike {
  /** The current frame's source sub-rect within `sheet.image` (px). */
  readonly rect: {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    sourceW?: number;
    sourceH?: number;
    offsetX?: number;
    offsetY?: number;
  };
  /** The sheet the frame is blitted from. */
  readonly sheet: { image: CanvasImageSource };
}

/** Per-sprite options for `Draw.sprite` — flip, squash/stretch, rotation, opacity. */
export interface DrawSpriteOptions {
  /** Mirror horizontally (facing). */
  flipX?: boolean;
  /** Mirror vertically. */
  flipY?: boolean;
  /** Squash & stretch. Anchored at the rect's bottom-center (feet planted),
   *  the natural pivot for landing squash. Default 1. */
  scaleX?: number;
  /** Vertical squash & stretch about the bottom-center anchor. Default 1. */
  scaleY?: number;
  /** Rotation in radians about the same anchor. */
  rot?: number;
  /** Opacity 0..1 (ghosts). */
  alpha?: number;
}

/** Blit a single animated sprite: `spr` is anything `SpriteLike` (an
 *  `Anim.fromGrid`/`Anim.fromImages` cursor), `at` is the destination `Rect`. Anchored
 *  bottom-center (feet planted). `opts`: `flipX`/`flipY`, `scaleX`/`scaleY`
 *  (squash & stretch), `rot`, `alpha`. For many ECS sprites at once use
 *  `Draw.sprites`. When a scene renderer is attached, this is the same GPU
 *  path as `Draw.sprites` — not a Canvas2D overlay blit. */
function sprite(this: DrawTarget, spr: SpriteLike, at: Rect, opts: DrawSpriteOptions = {}): void {
  const r = spr.rect;
  const sourceW = r.sourceW ?? r.sw;
  const sourceH = r.sourceH ?? r.sh;
  const dw = (r.sw / sourceW) * at.w;
  const dh = (r.sh / sourceH) * at.h;
  const dx = ((r.offsetX ?? 0) / sourceW) * at.w;
  const dy = ((r.offsetY ?? 0) / sourceH) * at.h;
  if (this.scene) {
    this.scene.setTransform(readTransform(this.ctx));
    const scaleX = opts.scaleX ?? 1;
    const scaleY = opts.scaleY ?? 1;
    const one = this.spriteOne;
    one.img = spr.sheet.image as DrawSprite["img"];
    one.x = at.x + at.w / 2;
    one.y = at.y + at.h;
    one.w = dw * Math.abs(scaleX);
    one.h = dh * Math.abs(scaleY);
    one.ax = dw === 0 ? 0.5 : (at.w / 2 - dx) / dw;
    one.ay = dh === 0 ? 1 : (at.h - dy) / dh;
    one.rot = opts.rot ?? 0;
    one.scale = 1;
    one.flipX = !!opts.flipX !== scaleX < 0;
    one.flipY = !!opts.flipY !== scaleY < 0;
    one.alpha = opts.alpha ?? 1;
    one.sx = r.sx;
    one.sy = r.sy;
    one.sw = r.sw;
    one.sh = r.sh;
    one.visible = true;
    one.z = 0;
    one.px = undefined;
    one.py = undefined;
    this.scene.sprites(this.spriteOneList);
    return;
  }
  const ctx = this.ctx;
  // Fast path: no flip/squash/rotation/alpha means the transform below is
  // identity apart from position (translate to the bottom-center anchor, then
  // blit back up-left by the same amounts) — one direct drawImage, no
  // save/translate/scale/restore.
  if (
    !opts.flipX &&
    !opts.flipY &&
    (opts.scaleX ?? 1) === 1 &&
    (opts.scaleY ?? 1) === 1 &&
    !opts.rot &&
    opts.alpha === undefined
  ) {
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    blitPixelAligned(ctx, spr.sheet.image, r.sx, r.sy, r.sw, r.sh, at.x + dx, at.y + dy, dw, dh);
    ctx.imageSmoothingEnabled = prev;
    return;
  }
  ctx.save();
  // Nearest-neighbour: interpolated sampling bleeds edge pixels from the
  // ADJACENT sheet cells into the frame (ghost lines above heads); pixel
  // art wants crisp scaling anyway.
  ctx.imageSmoothingEnabled = false;
  ctx.translate(at.x + at.w / 2, at.y + at.h); // bottom-center anchor
  ctx.scale((opts.flipX ? -1 : 1) * (opts.scaleX ?? 1), (opts.flipY ? -1 : 1) * (opts.scaleY ?? 1));
  if (opts.rot) ctx.rotate(opts.rot);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  blitPixelAligned(
    ctx,
    spr.sheet.image,
    r.sx,
    r.sy,
    r.sw,
    r.sh,
    -at.w / 2 + dx,
    -at.h + dy,
    dw,
    dh,
  );
  ctx.restore();
}

// ---------- Batch sprite rendering ----------
// The z-sorted blit-many renderer. It lives HERE, not on the ECS (Draw owns
// rendering; data never draws itself). It takes any iterable of sprite-shaped
// DATA — an ECS Sprite store (`Draw.sprites(ecs.dense(Sprites.Sprite))`), a
// plain array, whatever — so nothing is coupled to the ECS. `DrawSprite` is
// structural, so `Sprites.SpriteData` satisfies it with no import either way.

type BlitImage = CanvasImageSource & { width: number; height: number; logicalSize?: number };

/** One entry the batch renderer can blit. The ECS `Sprite` component's data
 *  matches this structurally. */
export interface DrawSprite {
  /** Ambient-space x of the anchor point (world inside `Camera.render`). */
  x: number;
  /** Ambient-space y of the anchor point. */
  y: number;
  /** Source image blitted. */
  img: BlitImage;
  /** Destination width. Defaults to `sw` when clipped, else the image's
   *  `logicalSize`/`width`. */
  w?: number;
  /** Destination height. Defaults to `sh` when clipped, else the image's
   *  `logicalSize`/`height`. */
  h?: number;
  /** Horizontal anchor as a fraction of `w`: `0` left, `0.5` center (default),
   *  `1` right. `x` lands on this point. */
  ax?: number;
  /** Vertical anchor as a fraction of `h`: `0` top, `0.5` center (default),
   *  `1` bottom. `y` lands on this point. */
  ay?: number;
  /** Rotation in radians about the anchor. Default `0`. */
  rot?: number;
  /** Uniform scale about the anchor. Default `1`. */
  scale?: number;
  /** Mirror horizontally (facing). */
  flipX?: boolean;
  /** Mirror vertically. */
  flipY?: boolean;
  /** Opacity `0..1`. `<= 0` skips the blit. Default `1`. */
  alpha?: number;
  /** Draw order — lower draws first (behind). Ties keep iteration order.
   *  Default `0`. */
  z?: number;
  /** `false` skips drawing this sprite. Default (drawn) when omitted. */
  visible?: boolean;
  /** Source-rect x in `img` (px). With `sy`/`sw`/`sh`, blits a sub-region
   *  (a sheet cell) instead of the whole image. */
  sx?: number;
  /** Source-rect y in `img` (px). */
  sy?: number;
  /** Source-rect width in `img` (px) — presence (with `sh`) marks the sprite
   *  as clipped. */
  sw?: number;
  /** Source-rect height in `img` (px). */
  sh?: number;
  /** Previous-step x — blended toward `x` by `opts.interpolation` for interpolated
   *  motion. Needs `py` too. */
  px?: number;
  /** Previous-step y — blended toward `y` by `opts.interpolation`. */
  py?: number;
}

/** Options for the batched `Draw.sprites`: interpolation and culling. */
export interface DrawSpritesOptions {
  /** Position between previous and current fixed states, from 0 to 1. Pass
   * `Loop.interpolation` to blend px/py→x/y for smooth rendered motion. */
  interpolation?: number;
  /** Visible world rect — sprites fully outside are skipped before transform. */
  view?: { x: number; y: number; w: number; h: number };
}

/** Blit an iterable of sprites, sorted by `z` (ties keep order). Honors
 *  anchor/rotation/scale/flip/alpha/visibility, culls to `view`, and
 *  interpolates px/py when `opts.interpolation` is given. */
function sprites(
  this: DrawTarget,
  list: Iterable<DrawSprite>,
  opts: DrawSpritesOptions = {},
): void {
  if (this.scene) {
    this.scene.setTransform(readTransform(this.ctx));
    this.scene.sprites(list, opts);
    return;
  }
  const ctx = this.ctx;
  const spriteScratch = this.spriteScratch;
  const lerp = opts.interpolation;
  const view = opts.view;

  spriteScratch.length = 0;
  for (const s of list) spriteScratch.push(s);

  let ordered = true;
  for (let i = 1; i < spriteScratch.length; i++) {
    if ((spriteScratch[i].z ?? 0) < (spriteScratch[i - 1].z ?? 0)) {
      ordered = false;
      break;
    }
  }
  if (!ordered) spriteScratch.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  // Nearest-neighbour for the whole batch, toggled ONCE — `Draw.sprite` forces
  // smoothing off per blit and the two paths must render pixel art identically.
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  let ctxAlpha = 1;
  for (const s of spriteScratch) {
    if (s.visible === false) continue;
    const alpha = s.alpha ?? 1;
    if (alpha <= 0) continue;

    const img = s.img;
    const clipped = s.sw !== undefined && s.sh !== undefined;
    const w = s.w ?? (clipped ? s.sw! : (img.logicalSize ?? img.width));
    const h = s.h ?? (clipped ? s.sh! : (img.logicalSize ?? img.height));
    const ax = s.ax ?? 0.5;
    const ay = s.ay ?? 0.5;
    const rot = s.rot ?? 0;
    const scale = s.scale ?? 1;
    const flipX = s.flipX === true;
    const flipY = s.flipY === true;

    let x = s.x;
    let y = s.y;
    if (lerp !== undefined && s.px !== undefined && s.py !== undefined) {
      x = s.px + (s.x - s.px) * lerp;
      y = s.py + (s.y - s.py) * lerp;
    }

    if (view) {
      const ext = (w + h) * scale;
      if (
        x + ext < view.x ||
        x - ext > view.x + view.w ||
        y + ext < view.y ||
        y - ext > view.y + view.h
      ) {
        continue;
      }
    }

    if (alpha !== ctxAlpha) {
      ctx.globalAlpha = alpha;
      ctxAlpha = alpha;
    }

    if (rot === 0 && scale === 1 && !flipX && !flipY) {
      if (clipped) {
        blitPixelAligned(
          ctx,
          img,
          s.sx ?? 0,
          s.sy ?? 0,
          s.sw!,
          s.sh!,
          x - ax * w,
          y - ay * h,
          w,
          h,
        );
      } else {
        blitPixelAligned(ctx, img, x - ax * w, y - ay * h, w, h);
      }
    } else {
      ctx.save();
      ctx.translate(x, y);
      if (rot !== 0) ctx.rotate(rot);
      const kx = scale * (flipX ? -1 : 1);
      const ky = scale * (flipY ? -1 : 1);
      if (kx !== 1 || ky !== 1) ctx.scale(kx, ky);
      if (clipped) {
        blitPixelAligned(ctx, img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, -ax * w, -ay * h, w, h);
      } else {
        blitPixelAligned(ctx, img, -ax * w, -ay * h, w, h);
      }
      ctx.restore();
    }
  }
  if (ctxAlpha !== 1) ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = prevSmoothing;
}

/** Options for `Draw.tiles` — the opt-in static-layer `bake`. */
export interface DrawTilesOptions {
  /** Bake the whole level into one offscreen canvas and blit that per frame
   *  instead of repainting every visible tile — the big fill-rate win, for
   *  STATIC layers only: `anim` selector cells freeze at bake time. Mutating
   *  cells (`level.set`) re-bakes automatically; call `level.invalidate()`
   *  after changing the skin's underlying image pixels. Heavy-zoom cameras
   *  re-bake on large (beyond ±25%) zoom changes, so keep it off for layers
   *  under a constantly-tweening zoom. The skin object must be kept
   *  referentially stable — a fresh skin object per frame re-bakes per frame.
   *  Default false. */
  bake?: boolean;
}

/** Anything Draw.tiles can render — levels expose a `render` channel; the
 *  app calls this instead (data never draws itself). Generic so the skin
 *  type-checks against the level's legend. */
export interface TilesLike<S> {
  /** Paint the level into `ctx` using `skin`. Called by `Draw.tiles` — the
   *  app never invokes it directly. */
  render(ctx: CanvasRenderingContext2D, skin: S, opts?: DrawTilesOptions): void;
}

/** An editor-authored visual tile layer that already knows its source cells. */
export interface SkinlessTilesLike {
  readonly skinless: true;
  render(ctx: CanvasRenderingContext2D): void;
}

/** Paint a tile level (from `Tiles.grid`) with a `skin` mapping each legend key
 *  to a fill. In the ambient space — put it inside `Camera.render` to scroll
 *  with the world. The `skin` type-checks against the level's legend. Pass
 *  `{ bake: true }` to blit a static layer from one baked canvas (see
 *  `DrawTilesOptions`). LDtk Tile/AutoLayers already contain their visuals and
 *  use the shorter `Draw.tiles(layer)` form. */
function tiles(this: DrawTarget, level: SkinlessTilesLike): void;
function tiles<S>(this: DrawTarget, level: TilesLike<S>, skin: S, opts?: DrawTilesOptions): void;
function tiles<S>(
  this: DrawTarget,
  level: TilesLike<S> | SkinlessTilesLike,
  skin?: S,
  opts?: DrawTilesOptions,
): void {
  if (this.scene && this.recorder) {
    this.recorder.begin(this.ctx, this.scene);
    const fake = this.recorder.ctx;
    if ("skinless" in level && level.skinless) level.render(fake);
    else (level as TilesLike<S>).render(fake, skin as S, opts);
    return;
  }
  const ctx = this.ctx;
  if ("skinless" in level && level.skinless) level.render(ctx);
  else (level as TilesLike<S>).render(ctx, skin as S, opts);
}

/** Anything Draw.particles can render — particle systems expose a `render`
 *  channel; the app calls this instead (data never draws itself). */
export interface ParticleLike {
  /** Blit the system's live particles to `ctx`. Called by `Draw.particles` —
   *  the app never invokes it directly. */
  render(ctx: CanvasRenderingContext2D): void;
}

/** Render a particle system (`Particles.createSystem()`), typically inside a
 *  `Camera.render` block for world-space effects. */
function particles(this: DrawTarget, sys: ParticleLike): void {
  if (this.scene && this.recorder) {
    this.recorder.begin(this.ctx, this.scene);
    sys.render(this.recorder.ctx);
    return;
  }
  sys.render(this.ctx);
}

/** Draw plain ambient-space text (world-anchored damage numbers, name tags) —
 *  see `DrawTextOptions` for `x`/`y`/`size`/`color`/`align`/`baseline`. For
 *  themed, screen-space HUD text use `UI.text`. */
function text(this: DrawTarget, str: string, opts: DrawTextOptions): void {
  const ctx = this.ctx;
  if (opts.font !== undefined && typeof opts.font !== "string") {
    // A gradient means nothing to a tinted blit, so it is dropped rather than
    // stringified into a nonsense CSS color.
    opts.font.render(ctx, str, opts.x, opts.y, {
      ...(typeof opts.color === "string" ? { color: opts.color } : {}),
      ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
      ...(opts.align !== undefined ? { align: opts.align } : {}),
      ...(opts.baseline !== undefined ? { baseline: opts.baseline } : {}),
      ...(opts.tracking !== undefined ? { tracking: opts.tracking } : {}),
      ...(opts.lineHeight !== undefined ? { lineHeight: opts.lineHeight } : {}),
      ...(opts.outline !== undefined ? { outline: opts.outline } : {}),
      ...(opts.outlineWidth !== undefined ? { outlineWidth: opts.outlineWidth } : {}),
      ...(opts.outlineStyle !== undefined ? { outlineStyle: opts.outlineStyle } : {}),
      ...(opts.shadow !== undefined ? { shadow: opts.shadow } : {}),
      ...(opts.shadowColor !== undefined ? { shadowColor: opts.shadowColor } : {}),
    });
    return;
  }
  drawText(ctx, str, opts.x, opts.y, {
    font: opts.font ?? (opts.size !== undefined ? monoFont(opts.size) : undefined),
    color: opts.color,
    align: opts.align,
    baseline: opts.baseline,
  });
}

export interface DrawApi {
  /** Raw context under the current screen/camera transform. */
  readonly ctx: CanvasRenderingContext2D;
  rect(x: number, y: number, w: number, h: number, color: Fill): void;
  rect(rect: Rect, color: Fill): void;
  circle(x: number, y: number, r: number, color: Fill): void;
  circle(pos: Point, r: number, color: Fill): void;
  line(x1: number, y1: number, x2: number, y2: number, color: Fill, width?: number): void;
  line(a: Point, b: Point, color: Fill, width?: number): void;
  rectStroke(x: number, y: number, w: number, h: number, color: Fill, width?: number): void;
  rectStroke(rect: Rect, color: Fill, width?: number): void;
  circleStroke(x: number, y: number, r: number, color: Fill, width?: number): void;
  circleStroke(pos: Point, r: number, color: Fill, width?: number): void;
  poly(points: readonly Point[], color: Fill): void;
  image(img: CanvasImageSource, x: number, y: number, w?: number, h?: number): void;
  linear(x0: number, y0: number, x1: number, y1: number, stops: GradientStops): CanvasGradient;
  radial(cx: number, cy: number, r: number, stops: GradientStops): CanvasGradient;
  radial(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
    stops: GradientStops,
  ): CanvasGradient;
  opacity(value: number, fn: () => void): void;
  text(str: string, opts: DrawTextOptions): void;
  sprite(spr: SpriteLike, at: Rect, opts?: DrawSpriteOptions): void;
  sprites(list: Iterable<DrawSprite>, opts?: DrawSpritesOptions): void;
  tiles(level: SkinlessTilesLike): void;
  tiles<S>(level: TilesLike<S>, skin: S, opts?: DrawTilesOptions): void;
  particles(sys: ParticleLike): void;
}

/** Scene-layer clip. `Camera.render` owns this — it is not on the public
 *  `Draw` type so a game cannot scissor the scene without clipping the overlay
 *  (or the reverse). */
export interface DrawSceneClip {
  /** Clip subsequent scene-layer draws (`sprite` / `sprites` / `tiles` /
   *  `particles`) to `rect` in the current overlay space. Overlay Canvas2D
   *  clip is separate. Pass `null` to disable. */
  clipScene(rect: Rect | null): void;
}

/** Create a renderer permanently bound to one app/context. When `scene` is
 *  present, `sprite` / `sprites` / `tiles` / `particles` go there; everything
 *  else stays on the overlay 2D context. */
export function createDraw(
  host: { readonly ctx: CanvasRenderingContext2D },
  scene?: SceneRenderer | null,
): DrawApi & DrawSceneClip {
  const spriteOne: DrawSprite = {
    x: 0,
    y: 0,
    img: { width: 1, height: 1 } as DrawSprite["img"],
  };
  const target: DrawTarget = {
    get ctx() {
      return host.ctx;
    },
    spriteScratch: [],
    spriteOne,
    spriteOneList: [spriteOne],
    scene: scene ?? null,
    recorder: scene ? createDrawRecorder() : null,
  };
  return {
    get ctx() {
      return target.ctx;
    },
    rect: rect.bind(target) as DrawApi["rect"],
    circle: circle.bind(target) as DrawApi["circle"],
    line: line.bind(target) as DrawApi["line"],
    rectStroke: rectStroke.bind(target) as DrawApi["rectStroke"],
    circleStroke: circleStroke.bind(target) as DrawApi["circleStroke"],
    poly: poly.bind(target),
    image: image.bind(target),
    linear: linear.bind(target),
    radial: radial.bind(target) as DrawApi["radial"],
    opacity: opacity.bind(target),
    text: text.bind(target),
    sprite: sprite.bind(target),
    sprites: sprites.bind(target),
    tiles: tiles.bind(target) as DrawApi["tiles"],
    particles: particles.bind(target),
    clipScene(rect) {
      if (!target.scene) return;
      target.scene.setTransform(readTransform(target.ctx));
      target.scene.setClip(rect);
    },
  };
}
