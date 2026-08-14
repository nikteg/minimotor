/** Straight-alpha 8-bit RGBA pixels, row-major, four bytes per pixel. */
export interface Pixels {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
}
/** Decode a PNG file into straight-alpha RGBA pixels. */
export declare function decodePng(file: Uint8Array): Pixels;
/** Encode straight-alpha RGBA pixels as an 8-bit RGBA PNG. */
export declare function encodePng(image: Pixels): Buffer;
/** Allocate a transparent image. */
export declare const blank: (width: number, height: number) => Pixels;
