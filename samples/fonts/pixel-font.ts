// A hand-drawn 5x7 pixel font, baked to an atlas at startup.
//
// This is the honest version of the demo: real glyphs, drawn pixel by pixel,
// exactly as a sheet bought from itch.io would arrive — just expressed as text
// so the sample stays a single dependency-free import. `Sprites.atlas` turns
// the rows below into the PNG that `Font.atlas` slices back apart.
//
// Every glyph occupies the full 5x7 cell, but almost none of them INK it: "I"
// is three pixels wide and "M" is five. That gap is what `Font.atlas`'s
// trimming measures, and why the sample can show monospaced and proportional
// side by side from one sheet.
import * as Sprites from "minimotor/sprites";
import type { ScratchCanvas } from "minimotor/sprites";

/** Rows are separated by "/", "#" is an inked pixel. */
const GLYPHS: Record<string, string> = {
  " ": "...../...../...../...../...../...../.....",
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.###.",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: ".###./..#../..#../..#../..#../..#../.###.",
  J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#...#/#...#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#...#/#.#.#/##.##/#...#",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  "1": "..#../.##../..#../..#../..#../..#../.###.",
  "2": ".###./#...#/....#/...#./..#../.#.../#####",
  "3": "#####/...#./..#../...#./....#/#...#/.###.",
  "4": "...#./..##./.#.#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/....#/#...#/.###.",
  "6": "..##./.#.../#..../####./#...#/#...#/.###.",
  "7": "#####/....#/...#./..#../.#.../.#.../.#...",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
  "9": ".###./#...#/#...#/.####/....#/...#./.##..",
  ".": "...../...../...../...../...../.##../.##..",
  ",": "...../...../...../...../.##../..#../.#...",
  "!": "..#../..#../..#../..#../..#../...../..#..",
  "?": ".###./#...#/....#/...#./..#../...../..#..",
  ":": "...../.##../.##../...../.##../.##../.....",
  "-": "...../...../...../.###./...../...../.....",
  "'": "..#../..#../...../...../...../...../.....",
  "(": "...#./..#../.#.../.#.../.#.../..#../...#.",
  ")": ".#.../..#../...#./...#./...#./..#../.#...",
  "/": "....#/....#/...#./..#../.#.../#..../#....",
  "+": "...../..#../..#../#####/..#../..#../.....",
  "%": "##..#/##..#/...#./..#../.#.../#..##/#..##",
};

/** The charset, in atlas order. `Font.atlas` needs these in the same order the
 *  cells were baked, which is exactly the key order of the object above. */
export const CHARS = Object.keys(GLYPHS).join("");

export const CELL = { w: 5, h: 7 };
const COLS = 16;

/** Bake the glyphs into one atlas canvas. White on transparent, because
 *  `color` and `outline` tint the art — a sheet drawn in its final colour
 *  could only ever be that colour. */
export function bakeSheet(): ScratchCanvas {
  const rows = Object.values(GLYPHS);
  return Sprites.atlas(
    CELL.w,
    CELL.h,
    rows.length,
    (g, index) => {
      g.fillStyle = "#ffffff";
      rows[index].split("/").forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(x, y, 1, 1);
      });
    },
    { cols: COLS },
  );
}

/** A four-glyph icon sheet for the `Font.glyphs` demo: characters that are
 *  pictures. Cells are 7x7 and deliberately NOT a regular charset — the point
 *  is that a font can be any rects you can name. */
export function bakeIcons(): ScratchCanvas {
  const art = [
    // heart
    ".##.##./#######/#######/.#####./..###../...#.../.......",
    // coin
    "..###../.#####./##.##.#/##.##.#/##.##.#/.#####./..###..",
    // key
    ".###.../#...#../#...#../.###.../..#..../..###../..#.#..",
    // skull
    ".#####./#######/#.#.#.#/#######/.#####./.#.#.#./.......",
  ];
  return Sprites.atlas(
    7,
    7,
    art.length,
    (g, index) => {
      g.fillStyle = "#ffffff";
      art[index].split("/").forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(x, y, 1, 1);
      });
    },
    { cols: art.length },
  );
}
