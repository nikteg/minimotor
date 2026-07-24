import { requireDefault } from "./default-game.js";
import type { Rect } from "./game.js";
import { drawText, monoFont, type TextHAlign, type TextVAlign } from "../text.js";

type Point = { x: number; y: number };

/** Options for `Draw.text` — plain ambient-space text (world-anchored damage
 *  numbers, name tags). For themed, screen-space HUD text use `UI.text`. */
export interface DrawTextOptions {
  /** Ambient-space x of the text, anchored by `align`. */
  x: number;
  /** Ambient-space y of the text, anchored by `baseline`. */
  y: number;
  /** Font size in px (monospace). Default 16. */
  size?: number;
  /** Full CSS font string — overrides `size`. */
  font?: string;
  /** Fill. A CSS color, or a gradient from `Draw.linear`/`Draw.radial`. Default "#fff". */
  color?: Fill;
  /** Horizontal anchor of `x`. Default "left". */
  align?: TextHAlign;
  /** Vertical anchor of `y`. Default "top". */
  baseline?: TextVAlign;
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
function rect(x: number, y: number, w: number, h: number, color: Fill): void;
function rect(rect: Rect, color: Fill): void;
function rect(a: number | Rect, b: number | Fill, c?: number, d?: number, e?: Fill): void {
  const ctx = requireDefault().ctx;
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
function circle(x: number, y: number, r: number, color: Fill): void;
function circle(pos: Point, r: number, color: Fill): void;
function circle(
  xOrCenter: number | Point,
  yOrRadius: number,
  radiusOrColor: number | Fill,
  maybeColor?: Fill,
): void {
  const ctx = requireDefault().ctx;
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
function line(x1: number, y1: number, x2: number, y2: number, color: Fill, width?: number): void;
function line(a: Point, b: Point, color: Fill, width?: number): void;
function line(
  x1OrFrom: number | Point,
  y1OrTo: number | Point,
  x2OrColor?: number | Fill,
  y2OrWidth?: number | Fill,
  maybeColor?: Fill,
  maybeWidth?: number,
): void {
  const ctx = requireDefault().ctx;
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

/** A linear-gradient fill from (x0,y0) to (x1,y1). Pass the result as any
 *  `Draw`/`UI` color: `Draw.rect(r, Draw.linear(0, 0, 0, h, [[0,"#0af"],[1,"#014"]]))`.
 *  Gradients are immutable and reusable — for static geometry, create the
 *  gradient once and reuse it rather than calling this per frame. */
function linear(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: GradientStops,
): CanvasGradient {
  const ctx = requireDefault().ctx;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

/** A radial-gradient fill from the inner circle (x0,y0,r0) to the outer
 *  (x1,y1,r1). A 3-arg center form covers the common concentric case.
 *  Gradients are immutable and reusable — for static geometry, create the
 *  gradient once and reuse it rather than calling this per frame. */
function radial(cx: number, cy: number, r: number, stops: GradientStops): CanvasGradient;
function radial(
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  stops: GradientStops,
): CanvasGradient;
function radial(
  x0: number,
  y0: number,
  r0: number,
  x1OrStops?: number | GradientStops,
  y1?: number,
  r1?: number,
  maybeStops?: GradientStops,
): CanvasGradient {
  const ctx = requireDefault().ctx;
  const g = Array.isArray(x1OrStops)
    ? ctx.createRadialGradient(x0, y0, 0, x0, y0, r0)
    : ctx.createRadialGradient(x0, y0, r0, x1OrStops as number, y1!, r1!);
  for (const [at, color] of Array.isArray(x1OrStops) ? x1OrStops : maybeStops!)
    g.addColorStop(at, color);
  return g;
}

/** Run `fn` with a global opacity multiplier applied (nests correctly and
 *  restores after) — fade-outs, ghosts, dimmed layers without touching ctx. */
function opacity(value: number, fn: () => void): void {
  const ctx = requireDefault().ctx;
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
  readonly rect: { sx: number; sy: number; sw: number; sh: number };
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
 *  `Anim.sheet`/`Anim.states` cursor), `at` is the destination `Rect`. Anchored
 *  bottom-center (feet planted). `opts`: `flipX`/`flipY`, `scaleX`/`scaleY`
 *  (squash & stretch), `rot`, `alpha`. For many ECS sprites at once use
 *  `Draw.sprites`. */
function sprite(spr: SpriteLike, at: Rect, opts: DrawSpriteOptions = {}): void {
  const ctx = requireDefault().ctx;
  const r = spr.rect;
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
    ctx.drawImage(spr.sheet.image, r.sx, r.sy, r.sw, r.sh, at.x, at.y, at.w, at.h);
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
  ctx.drawImage(spr.sheet.image, r.sx, r.sy, r.sw, r.sh, -at.w / 2, -at.h, at.w, at.h);
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
  /** Previous-step x — blended toward `x` by `opts.alpha` for interpolated
   *  motion. Needs `py` too. */
  px?: number;
  /** Previous-step y — blended toward `y` by `opts.alpha`. */
  py?: number;
}

/** Options for the batched `Draw.sprites` — interpolation `alpha` and cull `view`. */
export interface DrawSpritesOptions {
  /** Interpolation factor 0..1 (`Loop.alpha`): blends px/py→x/y for stutter-
   *  free motion on non-60 Hz displays. */
  alpha?: number;
  /** Visible world rect — sprites fully outside are skipped before transform. */
  view?: { x: number; y: number; w: number; h: number };
}

const spriteScratch: DrawSprite[] = [];

/** Blit an iterable of sprites, sorted by `z` (ties keep order). Honors
 *  anchor/rotation/scale/flip/alpha/visibility, culls to `view`, and
 *  interpolates px/py when `opts.alpha` is given. */
function sprites(list: Iterable<DrawSprite>, opts: DrawSpritesOptions = {}): void {
  const ctx = requireDefault().ctx;
  const lerp = opts.alpha;
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
        ctx.drawImage(img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, x - ax * w, y - ay * h, w, h);
      } else {
        ctx.drawImage(img, x - ax * w, y - ay * h, w, h);
      }
    } else {
      ctx.save();
      ctx.translate(x, y);
      if (rot !== 0) ctx.rotate(rot);
      const kx = scale * (flipX ? -1 : 1);
      const ky = scale * (flipY ? -1 : 1);
      if (kx !== 1 || ky !== 1) ctx.scale(kx, ky);
      if (clipped) {
        ctx.drawImage(img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, -ax * w, -ay * h, w, h);
      } else {
        ctx.drawImage(img, -ax * w, -ay * h, w, h);
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
 *  game calls this instead (data never draws itself). Generic so the skin
 *  type-checks against the level's legend. */
export interface TilesLike<S> {
  /** Paint the level into `ctx` using `skin`. Called by `Draw.tiles` — the
   *  game never invokes it directly. */
  render(ctx: CanvasRenderingContext2D, skin: S, opts?: DrawTilesOptions): void;
}

/** Paint a tile level (from `Tiles.grid`) with a `skin` mapping each legend key
 *  to a fill. In the ambient space — put it inside `Camera.render` to scroll
 *  with the world. The `skin` type-checks against the level's legend. Pass
 *  `{ bake: true }` to blit a static layer from one baked canvas (see
 *  `DrawTilesOptions`). */
function tiles<S>(level: TilesLike<S>, skin: S, opts?: DrawTilesOptions): void {
  level.render(requireDefault().ctx, skin, opts);
}

/** Anything Draw.particles can render — particle systems expose a `render`
 *  channel; the game calls this instead (data never draws itself). */
export interface ParticleLike {
  /** Blit the system's live particles to `ctx`. Called by `Draw.particles` —
   *  the game never invokes it directly. */
  render(ctx: CanvasRenderingContext2D): void;
}

/** Render a particle system (`Particles.create()`), typically inside a
 *  `Camera.render` block for world-space effects. */
function particles(sys: ParticleLike): void {
  sys.render(requireDefault().ctx);
}

/** Draw plain ambient-space text (world-anchored damage numbers, name tags) —
 *  see `DrawTextOptions` for `x`/`y`/`size`/`color`/`align`/`baseline`. For
 *  themed, screen-space HUD text use `UI.text`. */
function text(str: string, opts: DrawTextOptions): void {
  const ctx = requireDefault().ctx;
  drawText(ctx, str, opts.x, opts.y, {
    font: opts.font ?? (opts.size !== undefined ? monoFont(opts.size) : undefined),
    color: opts.color,
    align: opts.align,
    baseline: opts.baseline,
  });
}

/** Rendering: ambient-space primitives (screen at top level, world inside
 *  `Camera.render`) plus the raw `ctx` escape hatch.
 *
 *    Draw.rect(player.x, player.y, 32, 32, "#4ecdc4");
 *    Draw.circle(orb, 6, "#ffd166");
 *    Draw.text("score 12", { x: 8, y: 8, color: "#fff" });
 */
export const Draw = {
  /** The raw 2D canvas context — the escape hatch for effects the `Draw.*`
   *  primitives don't cover (gradients, paths, compositing). Under the current
   *  ambient transform (screen, or world inside `Camera.render`). */
  get ctx(): CanvasRenderingContext2D {
    return requireDefault().ctx;
  },
  /** Real time since the previous frame, in fixed steps (see `Game.frameScale`). */
  get frameScale(): number {
    return requireDefault().frameScale;
  },
  /** Render interpolation factor 0..1 — see `Game.alpha`. */
  get alpha(): number {
    return requireDefault().alpha;
  },
  rect,
  circle,
  line,
  linear,
  radial,
  opacity,
  text,
  sprite,
  sprites,
  tiles,
  particles,
};
