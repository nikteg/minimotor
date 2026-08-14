/** Components in 0..1. */
export type Rgba = readonly [number, number, number, number];
/** Parse a CSS color used as a canvas fill. Unknown strings → opaque black. */
export declare function parseRgba(color: string): Rgba;
