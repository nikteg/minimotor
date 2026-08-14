/** The glyph meaning "no tile here".
 *
 *  Written output uses this one. It is a VISIBLE character on purpose: grids
 *  get written to disk (`mm procgen gen -o`, committed golden files), and a
 *  whitespace empty would leave trailing spaces for editors and CI linters to
 *  strip out from under an exact-match drift check. It also makes a hand-drawn
 *  map's columns countable by eye. */
export declare const EMPTY = ".";
/** Is this glyph empty? Deliberately more permissive than `EMPTY` itself —
 *  input is read liberally so a hand-drawn map may use spaces for open air and
 *  ragged rows need no padding, while everything the engine WRITES is `EMPTY`. */
export declare function isEmptyChar(ch: string): boolean;
