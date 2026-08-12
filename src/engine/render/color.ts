// ---------- CSS color → RGBA ----------
// Enough of a parser for `background` clears and tile/particle fillStyle
// strings. Named colours other than `transparent`/`black`/`white` fall back
// to opaque black so a bad string still clears the buffer.

/** Components in 0..1. */
export type Rgba = readonly [number, number, number, number];

function hexNibble(ch: number): number {
  if (ch >= 48 && ch <= 57) return ch - 48;
  if (ch >= 97 && ch <= 102) return ch - 87;
  if (ch >= 65 && ch <= 70) return ch - 55;
  return 0;
}

function hexByte(a: number, b: number): number {
  return (hexNibble(a) * 16 + hexNibble(b)) / 255;
}

/** Parse a CSS color used as a canvas fill. Unknown strings → opaque black. */
export function parseRgba(color: string): Rgba {
  const s = color.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  if (s === "black") return [0, 0, 0, 1];
  if (s === "white") return [1, 1, 1, 1];
  if (s.charCodeAt(0) === 35) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = hexNibble(hex.charCodeAt(0));
      const g = hexNibble(hex.charCodeAt(1));
      const b = hexNibble(hex.charCodeAt(2));
      const a = hex.length === 4 ? hexNibble(hex.charCodeAt(3)) : 15;
      return [r / 15, g / 15, b / 15, a / 15];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = hexByte(hex.charCodeAt(0), hex.charCodeAt(1));
      const g = hexByte(hex.charCodeAt(2), hex.charCodeAt(3));
      const b = hexByte(hex.charCodeAt(4), hex.charCodeAt(5));
      const a = hex.length === 8 ? hexByte(hex.charCodeAt(6), hex.charCodeAt(7)) : 1;
      return [r, g, b, a];
    }
  }
  const rgb =
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/.exec(s);
  if (rgb) {
    const a = rgb[4] !== undefined ? Number(rgb[4]) : 1;
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, a];
  }
  return [0, 0, 0, 1];
}
