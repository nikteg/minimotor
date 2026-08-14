import type { DrawSprite, DrawSpritesOptions } from "../draw.js";
/** 2D affine matrix in canvas order: `x' = a*x + c*y + e`, `y' = b*x + d*y + f`. */
export interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}
export declare const IDENTITY: Affine;
export declare const FLOATS_PER_VERTEX = 8;
export declare const VERTS_PER_QUAD = 4;
export declare const FLOATS_PER_QUAD: number;
/** Copy `a,b,c,d,e,f` off a DOMMatrix (or anything shaped like one). */
export declare function affineFromDom(m: Affine): Affine;
export declare function copyAffine(m: Affine, out?: Affine): Affine;
/** `out = m * n` — `n` is applied to the point first, matching canvas CTM post-multiply. */
export declare function multiplyAffine(m: Affine, n: Affine, out: Affine): Affine;
export declare function transformPoint(m: Affine, x: number, y: number, out?: {
    x: number;
    y: number;
}): {
    x: number;
    y: number;
};
/** True when the matrix is a scale+translate (no rotation/skew) with nonzero axes. */
export declare function isAxisAligned(m: Affine): boolean;
/** Snap a dest rect in user space so that, after `m`, both neighbours share a
 *  device-pixel edge — the same rule as `blitPixelAligned`. */
export declare function snapDest(m: Affine, x: number, y: number, w: number, h: number): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** GL scissor rect in integer backing-store pixels, origin bottom-left. */
export interface Scissor {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** Axis-aligned clip rect in user space → GL scissor (y-up). Null when the
 *  transformed rect misses the canvas entirely. */
export declare function scissorFromRect(m: Affine, x: number, y: number, w: number, h: number, canvasW: number, canvasH: number): Scissor | null;
/** Device-space (y-down) → clip space (y-up). */
export declare function toClipSpace(x: number, y: number, canvasW: number, canvasH: number): {
    x: number;
    y: number;
};
/** Pack one axis-aligned dest rect (user space) through `m` into `buf` at `quad`. */
export declare function writeQuad(buf: Float32Array, quad: number, m: Affine, x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number, canvasW: number, canvasH: number): void;
/** Pack a quad from four ambient-space corners (already rotated/scaled). No rect snap. */
export declare function writeQuadCorners(buf: Float32Array, quad: number, m: Affine, corners: readonly [number, number, number, number, number, number, number, number], u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number, canvasW: number, canvasH: number): void;
/** Ambient-space corners of a sprite about its anchor, with rot/scale/flip applied. */
export declare function spriteCorners(x: number, y: number, w: number, h: number, ax: number, ay: number, rot: number, scale: number, flipX: boolean, flipY: boolean): [number, number, number, number, number, number, number, number];
type BlitImage = CanvasImageSource & {
    width: number;
    height: number;
};
/** Sort by `(z, texture identity)`. Equal keys keep insertion order (stable sort). */
export declare function sortSpritesByZAndTexture(list: DrawSprite[]): void;
export interface ResolvedSprite {
    img: BlitImage;
    x: number;
    y: number;
    w: number;
    h: number;
    ax: number;
    ay: number;
    rot: number;
    scale: number;
    flipX: boolean;
    flipY: boolean;
    alpha: number;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    clipped: boolean;
}
/** Collect, cull, interpolate, and sort — the GL counterpart of the Canvas2D loop. */
export declare function prepareSprites(list: Iterable<DrawSprite>, scratch: DrawSprite[]): DrawSprite[];
export declare function resolveSprite(s: DrawSprite, lerp: number | undefined, view: DrawSpritesOptions["view"]): ResolvedSprite | null;
export declare function imageSize(img: CanvasImageSource): {
    w: number;
    h: number;
};
export declare function readTransform(ctx: {
    getTransform?: () => Affine | DOMMatrix;
}): Affine;
export {};
