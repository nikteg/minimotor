/** Snap an axis-aligned destination rect through the canvas's complete current
 * transform. Both neighbors round their shared edge to the same backing-store
 * pixel, preventing gaps without per-asset overlap or padding. */
const rect = { x: 0, y: 0, w: 0, h: 0 };

function snapped(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): typeof rect {
  rect.x = x;
  rect.y = y;
  rect.w = w;
  rect.h = h;
  if (typeof ctx.getTransform !== "function") return rect;
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0 || m.a === 0 || m.d === 0) return rect;
  rect.x = (Math.round(m.a * x + m.e) - m.e) / m.a;
  rect.y = (Math.round(m.d * y + m.f) - m.f) / m.d;
  rect.w = (Math.round(m.a * (x + w) + m.e) - m.e) / m.a - rect.x;
  rect.h = (Math.round(m.d * (y + h) + m.f) - m.f) / m.d - rect.y;
  return rect;
}

/** Pixel-aligned full-image blit. */
export function blitPixelAligned(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
): void;
/** Pixel-aligned source-rect blit. */
export function blitPixelAligned(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void;
export function blitPixelAligned(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  a: number,
  b: number,
  c: number,
  d: number,
  e?: number,
  f?: number,
  g?: number,
  h?: number,
): void {
  if (e === undefined) {
    const to = snapped(ctx, a, b, c, d);
    ctx.drawImage(image, to.x, to.y, to.w, to.h);
  } else {
    const to = snapped(ctx, e, f!, g!, h!);
    ctx.drawImage(image, a, b, c, d, to.x, to.y, to.w, to.h);
  }
}

/** Pixel-aligned fill using the same shared-edge rule as image blits. */
export function fillPixelAligned(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const to = snapped(ctx, x, y, w, h);
  ctx.fillRect(to.x, to.y, to.w, to.h);
}
