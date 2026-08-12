// ---------- Sprite-batch CPU math ----------
// Affine transforms, pixel-edge snapping, clip-space conversion, and the
// interleaved vertex pack the WebGL2 batcher uploads. No GL types — unit-
// tested on their own so the thin `webgl2.ts` wrapper does not have to be.

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

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const FLOATS_PER_VERTEX = 8;
export const VERTS_PER_QUAD = 4;
export const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * VERTS_PER_QUAD;

const scratch = { x: 0, y: 0 };

/** Copy `a,b,c,d,e,f` off a DOMMatrix (or anything shaped like one). */
export function affineFromDom(m: Affine): Affine {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

export function copyAffine(
  m: Affine,
  out: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
): Affine {
  out.a = m.a;
  out.b = m.b;
  out.c = m.c;
  out.d = m.d;
  out.e = m.e;
  out.f = m.f;
  return out;
}

/** `out = m * n` — `n` is applied to the point first, matching canvas CTM post-multiply. */
export function multiplyAffine(m: Affine, n: Affine, out: Affine): Affine {
  const a = m.a * n.a + m.c * n.b;
  const b = m.b * n.a + m.d * n.b;
  const c = m.a * n.c + m.c * n.d;
  const d = m.b * n.c + m.d * n.d;
  const e = m.a * n.e + m.c * n.f + m.e;
  const f = m.b * n.e + m.d * n.f + m.f;
  out.a = a;
  out.b = b;
  out.c = c;
  out.d = d;
  out.e = e;
  out.f = f;
  return out;
}

export function transformPoint(
  m: Affine,
  x: number,
  y: number,
  out = scratch,
): { x: number; y: number } {
  out.x = m.a * x + m.c * y + m.e;
  out.y = m.b * x + m.d * y + m.f;
  return out;
}

/** True when the matrix is a scale+translate (no rotation/skew) with nonzero axes. */
export function isAxisAligned(m: Affine): boolean {
  return m.b === 0 && m.c === 0 && m.a !== 0 && m.d !== 0;
}

/** Snap a dest rect in user space so that, after `m`, both neighbours share a
 *  device-pixel edge — the same rule as `blitPixelAligned`. */
export function snapDest(
  m: Affine,
  x: number,
  y: number,
  w: number,
  h: number,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (!isAxisAligned(m)) return { x, y, w, h };
  const x0 = (Math.round(m.a * x + m.e) - m.e) / m.a;
  const y0 = (Math.round(m.d * y + m.f) - m.f) / m.d;
  const x1 = (Math.round(m.a * (x + w) + m.e) - m.e) / m.a;
  const y1 = (Math.round(m.d * (y + h) + m.f) - m.f) / m.d;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** GL scissor rect in integer backing-store pixels, origin bottom-left. */
export interface Scissor {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned clip rect in user space → GL scissor (y-up). Null when the
 *  transformed rect misses the canvas entirely. */
export function scissorFromRect(
  m: Affine,
  x: number,
  y: number,
  w: number,
  h: number,
  canvasW: number,
  canvasH: number,
): Scissor | null {
  const x0 = m.a * x + m.c * y + m.e;
  const y0 = m.b * x + m.d * y + m.f;
  const x1 = m.a * (x + w) + m.c * y + m.e;
  const y1 = m.b * (x + w) + m.d * y + m.f;
  const x2 = m.a * x + m.c * (y + h) + m.e;
  const y2 = m.b * x + m.d * (y + h) + m.f;
  const x3 = m.a * (x + w) + m.c * (y + h) + m.e;
  const y3 = m.b * (x + w) + m.d * (y + h) + m.f;
  const minX = Math.min(x0, x1, x2, x3);
  const maxX = Math.max(x0, x1, x2, x3);
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);
  const sx = Math.round(minX);
  const syTop = Math.round(minY);
  const sw = Math.round(maxX) - sx;
  const sh = Math.round(maxY) - syTop;
  const glY = canvasH - (syTop + sh);
  const cx = Math.max(0, sx);
  const cy = Math.max(0, glY);
  const cw = Math.min(canvasW, sx + sw) - cx;
  const ch = Math.min(canvasH, glY + sh) - cy;
  if (cw <= 0 || ch <= 0) return null;
  return { x: cx, y: cy, w: cw, h: ch };
}

/** Device-space (y-down) → clip space (y-up). */
export function toClipSpace(
  x: number,
  y: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  const w = canvasW || 1;
  const h = canvasH || 1;
  return { x: (x / w) * 2 - 1, y: 1 - (y / h) * 2 };
}

function writeVertex(
  buf: Float32Array,
  o: number,
  x: number,
  y: number,
  u: number,
  v: number,
  r: number,
  g: number,
  b: number,
  a: number,
  canvasW: number,
  canvasH: number,
): void {
  const clip = toClipSpace(x, y, canvasW, canvasH);
  buf[o] = clip.x;
  buf[o + 1] = clip.y;
  buf[o + 2] = u;
  buf[o + 3] = v;
  buf[o + 4] = r;
  buf[o + 5] = g;
  buf[o + 6] = b;
  buf[o + 7] = a;
}

/** Pack one axis-aligned dest rect (user space) through `m` into `buf` at `quad`. */
export function writeQuad(
  buf: Float32Array,
  quad: number,
  m: Affine,
  x: number,
  y: number,
  w: number,
  h: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  r: number,
  g: number,
  b: number,
  a: number,
  canvasW: number,
  canvasH: number,
): void {
  const to = snapDest(m, x, y, w, h);
  const x0 = m.a * to.x + m.c * to.y + m.e;
  const y0 = m.b * to.x + m.d * to.y + m.f;
  const x1 = m.a * (to.x + to.w) + m.c * to.y + m.e;
  const y1 = m.b * (to.x + to.w) + m.d * to.y + m.f;
  const x2 = m.a * (to.x + to.w) + m.c * (to.y + to.h) + m.e;
  const y2 = m.b * (to.x + to.w) + m.d * (to.y + to.h) + m.f;
  const x3 = m.a * to.x + m.c * (to.y + to.h) + m.e;
  const y3 = m.b * to.x + m.d * (to.y + to.h) + m.f;
  const o = quad * FLOATS_PER_QUAD;
  writeVertex(buf, o, x0, y0, u0, v0, r, g, b, a, canvasW, canvasH);
  writeVertex(buf, o + 8, x1, y1, u1, v0, r, g, b, a, canvasW, canvasH);
  writeVertex(buf, o + 16, x2, y2, u1, v1, r, g, b, a, canvasW, canvasH);
  writeVertex(buf, o + 24, x3, y3, u0, v1, r, g, b, a, canvasW, canvasH);
}

/** Pack a quad from four ambient-space corners (already rotated/scaled). No rect snap. */
export function writeQuadCorners(
  buf: Float32Array,
  quad: number,
  m: Affine,
  corners: readonly [number, number, number, number, number, number, number, number],
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  r: number,
  g: number,
  b: number,
  a: number,
  canvasW: number,
  canvasH: number,
): void {
  const o = quad * FLOATS_PER_QUAD;
  const uvs: readonly [number, number, number, number, number, number, number, number] = [
    u0,
    v0,
    u1,
    v0,
    u1,
    v1,
    u0,
    v1,
  ];
  for (let i = 0; i < 4; i++) {
    const p = transformPoint(m, corners[i * 2], corners[i * 2 + 1]);
    writeVertex(buf, o + i * 8, p.x, p.y, uvs[i * 2], uvs[i * 2 + 1], r, g, b, a, canvasW, canvasH);
  }
}

/** Ambient-space corners of a sprite about its anchor, with rot/scale/flip applied. */
export function spriteCorners(
  x: number,
  y: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  rot: number,
  scale: number,
  flipX: boolean,
  flipY: boolean,
): [number, number, number, number, number, number, number, number] {
  const kx = scale * (flipX ? -1 : 1);
  const ky = scale * (flipY ? -1 : 1);
  const cos = rot === 0 ? 1 : Math.cos(rot);
  const sin = rot === 0 ? 0 : Math.sin(rot);
  const locals: readonly [number, number, number, number, number, number, number, number] = [
    -ax * w,
    -ay * h,
    (1 - ax) * w,
    -ay * h,
    (1 - ax) * w,
    (1 - ay) * h,
    -ax * w,
    (1 - ay) * h,
  ];
  const out: [number, number, number, number, number, number, number, number] = [
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  for (let i = 0; i < 4; i++) {
    const lx = locals[i * 2] * kx;
    const ly = locals[i * 2 + 1] * ky;
    out[i * 2] = x + lx * cos - ly * sin;
    out[i * 2 + 1] = y + lx * sin + ly * cos;
  }
  return out;
}

type BlitImage = CanvasImageSource & { width: number; height: number };

/** Sort by `(z, texture identity)`. Equal keys keep insertion order (stable sort). */
export function sortSpritesByZAndTexture(list: DrawSprite[]): void {
  const ids = new Map<BlitImage, number>();
  let next = 0;
  const texId = (img: BlitImage): number => {
    let id = ids.get(img);
    if (id === undefined) {
      id = next++;
      ids.set(img, id);
    }
    return id;
  };
  for (const s of list) texId(s.img);
  list.sort((a, b) => {
    const z = (a.z ?? 0) - (b.z ?? 0);
    if (z !== 0) return z;
    return texId(a.img) - texId(b.img);
  });
}

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
export function prepareSprites(list: Iterable<DrawSprite>, scratch: DrawSprite[]): DrawSprite[] {
  scratch.length = 0;
  for (const s of list) scratch.push(s);
  sortSpritesByZAndTexture(scratch);
  return scratch;
}

export function resolveSprite(
  s: DrawSprite,
  lerp: number | undefined,
  view: DrawSpritesOptions["view"],
): ResolvedSprite | null {
  if (s.visible === false) return null;
  const alpha = s.alpha ?? 1;
  if (alpha <= 0) return null;
  const img = s.img;
  const clipped = s.sw !== undefined && s.sh !== undefined;
  const w = s.w ?? (clipped ? s.sw! : (img.logicalSize ?? img.width));
  const h = s.h ?? (clipped ? s.sh! : (img.logicalSize ?? img.height));
  let x = s.x;
  let y = s.y;
  if (lerp !== undefined && s.px !== undefined && s.py !== undefined) {
    x = s.px + (s.x - s.px) * lerp;
    y = s.py + (s.y - s.py) * lerp;
  }
  const scale = s.scale ?? 1;
  if (view) {
    const ext = (w + h) * scale;
    if (
      x + ext < view.x ||
      x - ext > view.x + view.w ||
      y + ext < view.y ||
      y - ext > view.y + view.h
    ) {
      return null;
    }
  }
  return {
    img,
    x,
    y,
    w,
    h,
    ax: s.ax ?? 0.5,
    ay: s.ay ?? 0.5,
    rot: s.rot ?? 0,
    scale,
    flipX: s.flipX === true,
    flipY: s.flipY === true,
    alpha,
    sx: s.sx ?? 0,
    sy: s.sy ?? 0,
    sw: clipped ? s.sw! : img.width,
    sh: clipped ? s.sh! : img.height,
    clipped,
  };
}

export function imageSize(img: CanvasImageSource): { w: number; h: number } {
  const src = img as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number | unknown;
    height?: number | unknown;
  };
  const w = src.naturalWidth ?? (typeof src.width === "number" ? src.width : 0);
  const h = src.naturalHeight ?? (typeof src.height === "number" ? src.height : 0);
  return { w, h };
}

export function readTransform(ctx: { getTransform?: () => Affine | DOMMatrix }): Affine {
  if (typeof ctx.getTransform !== "function") return { ...IDENTITY };
  try {
    const m = ctx.getTransform();
    if (!m) return { ...IDENTITY };
    return affineFromDom(m);
  } catch {
    return { ...IDENTITY };
  }
}
