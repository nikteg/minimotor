// ---------- Tile-grid frame and autotile analysis ----------
//
// A nine-slice cut from one contiguous rect is only one way to build a frame.
// The other common one — Kenney-style packs, LDtk auto-layers — assembles it
// from nine *separate* tiles on a grid, and an autotile set generalises that to
// 16 or 47 tiles chosen by neighbour mask.
//
// A tile frame is checked by *assembling* it and handing the result to the
// nine-slice analyser. Once the nine cells are laid out, the top edge tile is
// the centre band of the x axis and the side tiles are the centre band of the
// y axis, so every measurement that module already makes — period, phase,
// wrap seam — applies unchanged, and to the pixels as they will actually be
// drawn rather than to the atlas they were cut from.
//
// Autotile sets need the one thing a frame does not: *socket* agreement. Any
// tile claiming a given neighbour state can be placed against any other tile
// claiming the matching one, so all of them have to present the same edge.
// That is an equality test on interned edge strips — exact, no threshold.

import { analyzeRegion, type Finding, type Rect } from "./analyze.js";
import type { Pixels } from "./png.js";

export interface Grid {
  /** Origin of the first tile in the atlas. */
  x: number;
  y: number;
  tile: { w: number; h: number };
  /** Gap between tiles, for sheets that were not de-gutted. */
  spacing?: number;
}

/** Rect of one tile in a grid, by column and row. */
export const cellRect = (grid: Grid, column: number, row: number): Rect => ({
  sx: grid.x + column * (grid.tile.w + (grid.spacing ?? 0)),
  sy: grid.y + row * (grid.tile.h + (grid.spacing ?? 0)),
  sw: grid.tile.w,
  sh: grid.tile.h,
});

/** The four edge strips of a tile, interned so two tiles that present the same
 *  edge share a socket id. This is what makes an autotile set checkable: every
 *  tile that claims "solid on the north side" must present the same north
 *  socket, or the set will not join up however the rules place it. */
export interface Sockets {
  north: string;
  south: string;
  west: string;
  east: string;
}

/** Serialise one edge line as raw samples.
 *
 *  Deliberately NOT `sliceIds`: that interns per rect, so an all-grey tile and
 *  an all-white tile would both come back as `0,0` and compare equal. A socket
 *  only means anything across tiles, so it has to carry the actual pixels.
 *  Fully transparent samples are flattened to one value, since an exporter's
 *  leftover RGB behind zero alpha is not part of the edge. */
const strip = (image: Pixels, rect: Rect, edge: keyof Sockets): string => {
  const horizontal = edge === "north" || edge === "south";
  const length = horizontal ? rect.sw : rect.sh;
  const x = edge === "east" ? rect.sx + rect.sw - 1 : rect.sx;
  const y = edge === "south" ? rect.sy + rect.sh - 1 : rect.sy;
  const parts: string[] = [];
  for (let i = 0; i < length; i++) {
    const at = ((y + (horizontal ? 0 : i)) * image.width + x + (horizontal ? i : 0)) * 4;
    const alpha = image.data[at + 3];
    parts.push(
      alpha === 0 ? "_" : `${image.data[at]}.${image.data[at + 1]}.${image.data[at + 2]}.${alpha}`,
    );
  }
  return parts.join(",");
};

/** Read a tile's four edge sockets. */
export const sockets = (image: Pixels, rect: Rect): Sockets => ({
  north: strip(image, rect, "north"),
  south: strip(image, rect, "south"),
  west: strip(image, rect, "west"),
  east: strip(image, rect, "east"),
});

/** Names of the nine cells, in the order a 3×3 frame reads. */
export const FRAME_CELLS = [
  ["topLeft", "top", "topRight"],
  ["left", "centre", "right"],
  ["bottomLeft", "bottom", "bottomRight"],
] as const;

/** Where each of the nine cells sits, when the frame is gathered from tiles
 *  scattered around an atlas rather than laid out as a contiguous 3×3. */
export type FrameCells = readonly (readonly [number, number])[][];

/** Copy nine cells, in reading order, into one contiguous 3×3 image. */
function assemble(image: Pixels, cells: readonly Rect[], tile: { w: number; h: number }): Pixels {
  const width = tile.w * 3;
  const out: Pixels = { width, height: tile.h * 3, data: new Uint8Array(width * tile.h * 3 * 4) };
  cells.forEach((rect, index) => {
    const ox = (index % 3) * tile.w;
    const oy = Math.floor(index / 3) * tile.h;
    for (let y = 0; y < tile.h; y++) {
      const from = ((rect.sy + y) * image.width + rect.sx) * 4;
      out.data.set(image.data.subarray(from, from + tile.w * 4), ((oy + y) * width + ox) * 4);
    }
  });
  return out;
}

/** Verify a frame assembled from nine tiles on a grid.
 *
 *  Pass `cells` when the nine tiles are scattered around the atlas rather than
 *  laid out as a contiguous 3×3; the frame is assembled from wherever they are
 *  and checked as a unit.
 *
 *  Note what this cannot tell you: whether a corner was gathered from the wrong
 *  place. A corner is drawn once and repeats nothing, so any art at all is
 *  self-consistent there. Only the cells that repeat — the edges and the
 *  centre — carry a checkable constraint. */
export function analyzeTileFrame(
  image: Pixels,
  grid: Grid,
  cells?: FrameCells,
  name = "frame",
): Finding[] {
  const findings: Finding[] = [];
  const cell = (column: number, row: number) => {
    const at = cells?.[row]?.[column];
    return at ? cellRect(grid, at[0], at[1]) : cellRect(grid, column, row);
  };

  const all = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => cell(column, row)));
  const outside = all.some(
    (rect) =>
      rect.sx < 0 ||
      rect.sy < 0 ||
      rect.sx + rect.sw > image.width ||
      rect.sy + rect.sh > image.height,
  );
  if (outside) {
    findings.push({
      level: "error",
      region: name,
      code: "grid-out-of-bounds",
      message: `a 3×3 grid of ${grid.tile.w}×${grid.tile.h} tiles at ${grid.x},${grid.y} does not fit the ${image.width}×${image.height} atlas`,
    });
    return findings;
  }

  // Everything else a tile frame can get wrong is something the nine-slice
  // analyser already measures — it just has to be handed the assembled frame
  // rather than a rect of the atlas. Assembling first also means the repeating
  // cells are checked exactly as they will be drawn: the top edge becomes the
  // centre band of the x axis, the side edges the centre band of the y axis.
  const assembled = assemble(image, all, grid.tile);
  const region = analyzeRegion(assembled, {
    name,
    rect: { sx: 0, sy: 0, sw: grid.tile.w * 3, sh: grid.tile.h * 3 },
    insets: { left: grid.tile.w, top: grid.tile.h, right: grid.tile.w, bottom: grid.tile.h },
  });
  findings.push(...region.findings);

  const top = sockets(image, cell(1, 0));
  const bottom = sockets(image, cell(1, 2));
  if (top.west !== bottom.west || top.east !== bottom.east) {
    findings.push({
      level: "info",
      region: name,
      code: "asymmetric",
      message:
        "the top and bottom edge tiles present different side sockets, so the frame is not " +
        "vertically symmetric — intentional for a titled panel, a mistake otherwise",
    });
  }

  return findings;
}

/** Verify an autotile set: every tile in the set, indexed by neighbour mask.
 *
 *  A blob/wang set only works if tiles that claim the same neighbour state
 *  present the same socket, because the rule engine will place any of them
 *  against any other. Rather than encode a particular 16- or 47-tile layout,
 *  this takes the mask each tile is meant to answer and derives what its four
 *  sockets have to agree with — so it checks a set in whatever order the sheet
 *  happens to store it. */
export function analyzeAutotile(
  image: Pixels,
  grid: Grid,
  tiles: readonly { mask: number; column: number; row: number }[],
  name = "autotile",
): Finding[] {
  const findings: Finding[] = [];
  // Bit order matches the usual 4-bit cardinal mask: N=1, E=2, S=4, W=8.
  const SIDES: [keyof Sockets, number][] = [
    ["north", 1],
    ["east", 2],
    ["south", 4],
    ["west", 8],
  ];
  const byState = new Map<string, { socket: string; at: string }[]>();

  for (const tile of tiles) {
    const rect = cellRect(grid, tile.column, tile.row);
    const edge = sockets(image, rect);
    for (const [side, bit] of SIDES) {
      const connected = (tile.mask & bit) !== 0;
      const state = `${side}:${connected ? "open" : "closed"}`;
      const seen = byState.get(state) ?? [];
      seen.push({ socket: edge[side], at: `mask ${tile.mask} at ${tile.column},${tile.row}` });
      byState.set(state, seen);
    }
  }

  for (const [state, entries] of byState) {
    const distinct = new Set(entries.map((entry) => entry.socket));
    if (distinct.size <= 1) continue;
    const groups = [...distinct].map(
      (socket) =>
        `[${entries
          .filter((entry) => entry.socket === socket)
          .map((entry) => entry.at)
          .join("; ")}]`,
    );
    findings.push({
      level: "error",
      region: name,
      code: "socket-mismatch",
      message:
        `${entries.length} tiles declare ${state} but present ${distinct.size} different edges: ` +
        `${groups.join(" vs ")}. The rule engine will butt these against each other, so whichever ` +
        `group is wrong shows a seam wherever it lands next to the other.`,
    });
  }

  const masks = new Set(tiles.map((tile) => tile.mask));
  if (masks.size !== tiles.length) {
    findings.push({
      level: "warning",
      region: name,
      code: "duplicate-mask",
      message: `${tiles.length} tiles cover only ${masks.size} distinct masks — two entries answer the same neighbour state`,
    });
  }
  for (let mask = 0; mask < 16; mask++) {
    if (!masks.has(mask)) {
      findings.push({
        level: "warning",
        region: name,
        code: "missing-mask",
        message: `no tile answers neighbour mask ${mask} (${
          SIDES.filter(([, bit]) => mask & bit)
            .map(([side]) => side)
            .join("+") || "isolated"
        }) — that placement will fall back to whatever the engine defaults to`,
      });
    }
  }
  return findings;
}
