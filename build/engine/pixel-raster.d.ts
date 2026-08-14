/** Pixel-aligned full-image blit. */
export declare function blitPixelAligned(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
/** Pixel-aligned source-rect blit. */
export declare function blitPixelAligned(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, x: number, y: number, w: number, h: number): void;
/** Pixel-aligned fill using the same shared-edge rule as image blits. */
export declare function fillPixelAligned(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
