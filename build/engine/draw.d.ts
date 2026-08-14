import type { Rect } from "./app.js";
import { type TextHAlign, type TextVAlign } from "../engine/text.js";
import type { SceneRenderer } from "./render/target.js";
type Point = {
    x: number;
    y: number;
};
/** Anything `Draw.text` can draw glyphs from that is not a CSS font string —
 *  in practice a `Font.atlas` bitmap font. Declared structurally here for the
 *  same reason `TilesLike` is: the renderer must not import the capability. */
export interface FontLike {
    /** Draw `str` at (x, y). The `Draw.text` options are passed straight
     *  through, minus the ones only a CSS font understands. */
    render(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, style: {
        color?: string;
        scale?: number;
        align?: TextHAlign;
        baseline?: TextVAlign;
        tracking?: number;
        lineHeight?: number;
        outline?: string;
        outlineWidth?: number;
        outlineStyle?: "round" | "cross";
        shadow?: {
            x: number;
            y: number;
        };
        shadowColor?: string;
    }): void;
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
    shadow?: {
        x: number;
        y: number;
    };
    /** Bitmap fonts only: shadow colour. Default: `outline`, else black. */
    shadowColor?: string;
}
/** A fill: a CSS color string, or a gradient from `Draw.linear`/`Draw.radial`. */
export type Fill = string | CanvasGradient;
/** Gradient color stops: `[offset 0..1, color]` pairs. */
export type GradientStops = Array<[number, string]>;
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
    readonly sheet: {
        image: CanvasImageSource;
    };
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
type BlitImage = CanvasImageSource & {
    width: number;
    height: number;
    logicalSize?: number;
};
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
    view?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
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
/** Anything Draw.particles can render — particle systems expose a `render`
 *  channel; the app calls this instead (data never draws itself). */
export interface ParticleLike {
    /** Blit the system's live particles to `ctx`. Called by `Draw.particles` —
     *  the app never invokes it directly. */
    render(ctx: CanvasRenderingContext2D): void;
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
    radial(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: GradientStops): CanvasGradient;
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
export declare function createDraw(host: {
    readonly ctx: CanvasRenderingContext2D;
}, scene?: SceneRenderer | null): DrawApi & DrawSceneClip;
export {};
