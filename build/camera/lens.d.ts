import { type DrawApi, type DrawSceneClip, type Rect } from "../engine/index.js";
import type { Vec2 } from "../math/vec2.js";
/** Anything with a position; a Rect-shaped target is followed by its center. */
export type FollowTarget = {
    x: number;
    y: number;
    w?: number;
    h?: number;
};
/** Config for a camera lens — world bounds, follow/deadzone/damping, zoom, fit. */
export interface CameraOptions {
    /** World rect the camera clamps its view to; `{w, h}` means origin 0,0.
     *  Omit for an unclamped camera. */
    world?: Rect | {
        w: number;
        h: number;
    };
    /** Follow target (see `FollowTarget`). Retarget any time via `follow()`. */
    follow?: FollowTarget | null;
    /** Dead-zone box (world px), centered in the view: the target roams inside
     *  it freely; the camera moves only to keep it inside. Default: none. */
    deadzone?: {
        w?: number;
        h?: number;
    };
    /** Per-step lerp factor toward the desired position (ease-out feel).
     *  1 = rigid lock. Default 0.15. */
    damping?: number;
    /** Magnification. >1 zooms in. Default 1. */
    zoom?: number;
    /** Static lens: always frame this whole rect (minimap). Overrides
     *  follow/damping/zoom. `{w, h}` means origin 0,0. */
    fit?: Rect | {
        w: number;
        h: number;
    };
    /** View size the lens maps onto. Required for standalone lenses. */
    view: {
        w: number;
        h: number;
    };
    /** Fixed-step source — injectable for tests and standalone lenses. */
    steps: () => number;
    /** Renderer used by `render`/`layer`. Scene clip is Camera-owned. */
    draw: DrawApi & DrawSceneClip;
}
/** Options for `Camera.render` — the screen sub-rect (`into`) the lens maps onto. */
export interface RenderOptions {
    /** Destination rect in SCREEN space. The lens maps its world rect into
     *  this rect (uniform scale, centered) and clips to it. Omitted: the whole
     *  canvas. */
    into?: Rect;
}
/** Options for `toWorld` / `toScreen`. */
export interface ScreenMapOptions {
    /** The SAME screen sub-rect the lens was rendered `into`. A lens drawn into
     *  a sub-rect (minimap, split screen) maps world→screen with a different
     *  scale and offset than a full-canvas one, so picking through it must say
     *  which rect it means. Omit for a full-canvas lens. */
    into?: Rect;
}
/** A world→screen lens: position, zoom, follow, shake, and space conversions. */
export interface CameraLens {
    /** Top-left of the visible world rect (before shake). */
    x: number;
    /** Top-left `y` of the visible world rect (before shake). */
    y: number;
    /** Magnification. `>1` zooms in; `1` is identity. */
    zoom: number;
    /** The visible world rect — culling, minimap viewfinders. Reused scratch
     *  object: read, don't hold. */
    readonly rect: Rect;
    /** Set/replace the follow target and optionally reconfigure. */
    follow(target: FollowTarget | null, opts?: Omit<CameraOptions, "follow" | "view" | "steps" | "draw">): void;
    /** Jump straight to the desired position (scene entry — no visible lerp). */
    snap(): void;
    /** Impact shake: `amplitude` px decaying linearly over `ms`. */
    shake(amplitude: number, ms: number): void;
    /** Screen point → world point. `Camera.toWorld(Pointer)` is mouse picking.
     *  Accounts for zoom, shake and the pixel snap — it inverts exactly the
     *  transform `render` applied. For a lens rendered into a screen sub-rect,
     *  pass that rect as `opts.into`. Returns a new vector unless `out` is
     *  supplied for allocation-free hot paths. */
    toWorld(p: Vec2, out?: Vec2 | null, opts?: ScreenMapOptions): Vec2;
    /** World point → screen point (off-screen markers, HUD callouts). The
     *  inverse of `toWorld`; same `opts.into` rule. */
    toScreen(p: Vec2, out?: Vec2 | null, opts?: ScreenMapOptions): Vec2;
    /** Run `fn` with this lens applied: `Draw.*` inside is world space. */
    render(fn: () => void): void;
    render(opts: RenderOptions, fn: () => void): void;
    /** Parallax: run `fn` with this camera's translation scaled by `factor`
     *  (0 = screen-fixed, 1 = world). Call at the top level, not inside
     *  `render` — it applies the camera itself, at reduced strength. */
    layer(factor: number, fn: () => void): void;
}
export interface CameraApi extends CameraLens {
    /** Create another lens bound to the same app renderer, viewport, and clock. */
    create(options?: Omit<CameraOptions, "view" | "steps" | "draw">): CameraLens;
}
export declare function createLens(options: CameraOptions): CameraLens;
