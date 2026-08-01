// ---------- The char-grid glyph contract ----------
// One fact, stated once: which glyph means "no tile here".
//
// It lives in `tiles` because `tiles` is what ENFORCES it — `Tiles.grid` throws
// if a legend tries to claim the empty glyph as its own. But three capabilities
// have to agree on it: `tiles` parses maps written with it, `procgen` pads and
// fills grids with it, and `ldtk` rejects imported glyphs that collide with it.
// Before this file they each declared their own copy, and `ldtk` had a second,
// hand-rolled version of `isEmptyChar` besides — three independent statements of
// a rule that only works if all three match.
//
// THIS FILE MUST HAVE NO IMPORTS. That is what lets `procgen` depend on it
// without pulling `@src/engine` (and therefore canvas) into a module whose whole
// promise is that it also runs on a server.
//
// `tiles.core.test.ts` fails the build if a fourth copy appears.

/** The glyph meaning "no tile here".
 *
 *  Written output uses this one. It is a VISIBLE character on purpose: grids
 *  get written to disk (`mm procgen gen -o`, committed golden files), and a
 *  whitespace empty would leave trailing spaces for editors and CI linters to
 *  strip out from under an exact-match drift check. It also makes a hand-drawn
 *  map's columns countable by eye. */
export const EMPTY = ".";

/** Is this glyph empty? Deliberately more permissive than `EMPTY` itself —
 *  input is read liberally so a hand-drawn map may use spaces for open air and
 *  ragged rows need no padding, while everything the engine WRITES is `EMPTY`. */
export function isEmptyChar(ch: string): boolean {
  return ch === EMPTY || ch === " " || ch === "";
}
