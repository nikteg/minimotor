import { describe, expect, it, vi } from "vitest";
import { blitPixelAligned, fillPixelAligned } from "@src/engine/pixel-raster.js";

function context() {
  const images: number[][] = [];
  const fills: number[][] = [];
  return {
    drawImage: vi.fn((_image: unknown, ...args: number[]) => images.push(args.slice(-4))),
    fillRect: vi.fn((...args: number[]) => fills.push(args)),
    getTransform: () => ({ a: 5.5, b: 0, c: 0, d: 5.5, e: 0.35, f: 0.65 }),
    images,
    fills,
  } as unknown as CanvasRenderingContext2D & { images: number[][]; fills: number[][] };
}

describe("pixel raster alignment", () => {
  it("gives adjacent image tiles one identical device-pixel edge", () => {
    const ctx = context();
    const image = {} as CanvasImageSource;
    blitPixelAligned(ctx, image, 0, 0, 16, 16, 0, 0, 32, 32);
    blitPixelAligned(ctx, image, 0, 0, 16, 16, 0, 32, 32, 32);

    const first = ctx.images[0];
    const second = ctx.images[1];
    const firstBottom = (first[1] + first[3]) * 5.5 + 0.65;
    const secondTop = second[1] * 5.5 + 0.65;
    expect(firstBottom).toBe(secondTop);
    expect(Number.isInteger(firstBottom)).toBe(true);
  });

  it("uses the same shared-edge rule for adjacent fills", () => {
    const ctx = context();
    fillPixelAligned(ctx, 0, 0, 32, 32);
    fillPixelAligned(ctx, 32, 0, 32, 32);

    const first = ctx.fills[0];
    const second = ctx.fills[1];
    const firstRight = (first[0] + first[2]) * 5.5 + 0.35;
    const secondLeft = second[0] * 5.5 + 0.35;
    expect(firstRight).toBe(secondLeft);
    expect(Number.isInteger(firstRight)).toBe(true);
  });
});
