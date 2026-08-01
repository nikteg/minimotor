// ---------- Room layouts ----------
// Two classic, deterministic layout generators. Neither is clever, and that is
// the point: rooms and corridors are STRUCTURE, and structure is much easier to
// get right by construction than to find by search.
//
//   `rooms`  — recursive binary-space partition; one room per leaf, siblings
//              joined by an L corridor. Predictable, always connected.
//   `chunks` — hand-authored room templates stitched on a coarse grid with a
//              guaranteed path carved through them (the Spelunky method).
//              A human authored every tile the player sees.

import { createRng } from "@src/rng/index.js";
import {
  type CellRect,
  type CharGrid,
  asGrid,
  cols,
  fillRect,
  makeGrid,
  put,
  rows,
} from "./grid.js";

export interface RoomsOptions {
  /** Grid width in cells. */
  cols: number;
  /** Grid height in cells. */
  rows: number;
  /** Seed for the splits and room sizes. */
  seed?: number;
  /** Smallest partition that may still be split, in cells. Default 8. */
  minPartition?: number;
  /** Smallest room, in cells. Default 3. */
  minRoom?: number;
  /** How deep the partition may go. Default 5 (up to 32 rooms). */
  maxDepth?: number;
  /** Glyph for solid rock. Default "#". */
  wall?: string;
  /** Glyph for room and corridor floor. Default ".". */
  floor?: string;
}

/** A placed room, in cell coordinates. */
export interface Room extends CellRect {
  /** Index in `RoomsResult.rooms`. */
  id: number;
  /** Centre cell, where corridors meet. */
  cx: number;
  cy: number;
}

export interface RoomsResult {
  grid: CharGrid;
  rooms: Room[];
  /** Corridor connections as room-index pairs. */
  links: Array<readonly [number, number]>;
}

/** Carve BSP rooms joined by L-shaped corridors. Always fully connected. */
export function rooms(options: RoomsOptions): RoomsResult {
  const width = options.cols;
  const height = options.rows;
  const wall = options.wall ?? "#";
  const floor = options.floor ?? ".";
  const minPartition = options.minPartition ?? 8;
  const minRoom = options.minRoom ?? 3;
  const maxDepth = options.maxDepth ?? 5;
  const rng = createRng(options.seed ?? 0);
  const grid = makeGrid(width, height, wall);
  const placed: Room[] = [];
  const links: Array<readonly [number, number]> = [];

  /** Split a partition, or place a room in it, and return that room. */
  const split = (area: CellRect, depth: number): Room => {
    const canSplitX = area.w >= minPartition * 2;
    const canSplitY = area.h >= minPartition * 2;
    if (depth < maxDepth && (canSplitX || canSplitY)) {
      // Split the longer axis, with a jittered cut so rooms differ in size.
      const vertical = canSplitX && (!canSplitY || area.w >= area.h);
      const span = vertical ? area.w : area.h;
      const cut = rng.integer(minPartition, span - minPartition);
      const first = vertical
        ? { x: area.x, y: area.y, w: cut, h: area.h }
        : { x: area.x, y: area.y, w: area.w, h: cut };
      const second = vertical
        ? { x: area.x + cut, y: area.y, w: area.w - cut, h: area.h }
        : { x: area.x, y: area.y + cut, w: area.w, h: area.h - cut };
      const a = split(first, depth + 1);
      const b = split(second, depth + 1);
      corridor(grid, a, b, floor);
      links.push([a.id, b.id] as const);
      return rng.random() < 0.5 ? a : b;
    }
    // Leaf: inset a room, leaving at least one cell of rock on every side.
    const maxW = Math.max(minRoom, area.w - 2);
    const maxH = Math.max(minRoom, area.h - 2);
    const w = Math.min(maxW, rng.integer(minRoom, Math.max(minRoom, maxW)));
    const h = Math.min(maxH, rng.integer(minRoom, Math.max(minRoom, maxH)));
    const x = area.x + 1 + rng.integer(0, Math.max(0, area.w - w - 2));
    const y = area.y + 1 + rng.integer(0, Math.max(0, area.h - h - 2));
    const room: Room = {
      id: placed.length,
      x,
      y,
      w,
      h,
      cx: x + (w >> 1),
      cy: y + (h >> 1),
    };
    fillRect(grid, room, floor);
    placed.push(room);
    return room;
  };

  split({ x: 0, y: 0, w: width, h: height }, 0);
  return { grid, rooms: placed, links };
}

/** Dig an L corridor between two room centres — across, then down. */
function corridor(grid: CharGrid, a: Room, b: Room, floor: string): void {
  const stepX = Math.sign(b.cx - a.cx);
  const stepY = Math.sign(b.cy - a.cy);
  let x = a.cx;
  let y = a.cy;
  while (x !== b.cx) {
    put(grid, x, y, floor);
    x += stepX;
  }
  while (y !== b.cy) {
    put(grid, x, y, floor);
    y += stepY;
  }
  put(grid, x, y, floor);
}

export interface ChunkOptions {
  /** Hand-authored room templates, all the same size. Char grids or text. */
  templates: ReadonlyArray<CharGrid | string>;
  /** Chunk columns in the finished level. */
  cols: number;
  /** Chunk rows in the finished level. */
  rows: number;
  /** Seed for template choice and the path walk. */
  seed?: number;
  /** Glyph carved to open a doorway between chunks. Default ".". */
  floor?: string;
  /** Glyph filling chunks the solution path never visits. When omitted, those
   *  chunks get a template too — set it to a wall glyph for solid rock. */
  offPath?: string;
  /** Marker written at the centre of the first path chunk. Default "S". */
  entrance?: string;
  /** Marker written at the centre of the last path chunk. Default "E". */
  exit?: string;
}

export interface ChunkResult {
  grid: CharGrid;
  /** Chunk coordinates the guaranteed path runs through, start to finish. */
  path: Array<{ x: number; y: number }>;
  /** Cell coordinates of the entrance and exit markers. */
  entrance: { x: number; y: number };
  exit: { x: number; y: number };
}

/** Stitch hand-authored templates on a coarse grid and carve a guaranteed path
 *  through them: a drunkard's walk from a random top chunk to the bottom row,
 *  opening a doorway wherever the path crosses a chunk boundary.
 *
 *  Everything the player sees was drawn by a person; only the arrangement and
 *  the doorways are generated. That is why it holds up better than most
 *  fully-generated layouts. */
export function chunks(options: ChunkOptions): ChunkResult {
  if (options.templates.length === 0) {
    throw new Error("Procgen.chunks: at least one template is required");
  }
  const templates = options.templates.map((template) => asGrid(template));
  const tw = cols(templates[0]);
  const th = rows(templates[0]);
  for (const template of templates) {
    if (cols(template) !== tw || rows(template) !== th) {
      throw new Error("Procgen.chunks: every template must be the same size");
    }
  }
  if (tw < 3 || th < 3) throw new Error("Procgen.chunks: templates must be at least 3×3");

  const across = options.cols;
  const down = options.rows;
  const floor = options.floor ?? ".";
  const rng = createRng(options.seed ?? 0);
  const grid = makeGrid(across * tw, down * th, options.offPath ?? floor);

  // ---- walk the solution path: wander sideways, drop a row, repeat ----
  const path: Array<{ x: number; y: number }> = [];
  let cx = rng.integer(0, across - 1);
  for (let cy = 0; cy < down; cy++) {
    path.push({ x: cx, y: cy });
    if (cy === down - 1) break;
    // Sidesteps before dropping, never revisiting a chunk on this row.
    const steps = rng.integer(0, Math.max(0, across - 1));
    const direction = rng.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < steps; i++) {
      const next = cx + direction;
      if (next < 0 || next >= across) break;
      cx = next;
      path.push({ x: cx, y: cy });
    }
  }

  const onPath = new Set(path.map((chunk) => `${chunk.x},${chunk.y}`));
  for (let cy = 0; cy < down; cy++) {
    for (let cx2 = 0; cx2 < across; cx2++) {
      if (options.offPath !== undefined && !onPath.has(`${cx2},${cy}`)) continue;
      stamp(grid, rng.choose(templates), cx2 * tw, cy * th);
    }
  }

  // ---- carve the guaranteed path, centre to centre ----
  // Punching a hole in the shared wall is not enough: a template's interior may
  // not reach that hole (a pillar right behind it, say). Carving all the way
  // between chunk centres opens the doorway AND the run up to it, so the path
  // is walkable whatever the templates look like.
  for (let i = 1; i < path.length; i++) {
    const from = centreOf(path[i - 1], tw, th);
    const to = centreOf(path[i], tw, th);
    const stepX = Math.sign(to.x - from.x);
    const stepY = Math.sign(to.y - from.y);
    let x = from.x;
    let y = from.y;
    put(grid, x, y, floor);
    while (x !== to.x) {
      x += stepX;
      put(grid, x, y, floor);
    }
    while (y !== to.y) {
      y += stepY;
      put(grid, x, y, floor);
    }
  }

  const entrance = centreOf(path[0], tw, th);
  const exit = centreOf(path[path.length - 1], tw, th);
  put(grid, entrance.x, entrance.y, options.entrance ?? "S");
  put(grid, exit.x, exit.y, options.exit ?? "E");

  return { grid, path, entrance, exit };
}

/** The cell at the centre of a chunk. */
function centreOf(
  chunk: { x: number; y: number },
  tw: number,
  th: number,
): { x: number; y: number } {
  return { x: chunk.x * tw + (tw >> 1), y: chunk.y * th + (th >> 1) };
}

/** Copy a template into the grid at a cell offset. */
function stamp(grid: CharGrid, template: CharGrid, x0: number, y0: number): void {
  for (let y = 0; y < template.length; y++) {
    for (let x = 0; x < template[y].length; x++) put(grid, x0 + x, y0 + y, template[y][x]);
  }
}

/** The bounds of a room, for callers that want to place content inside it. */
export function roomBounds(room: Room): CellRect {
  return { x: room.x, y: room.y, w: room.w, h: room.h };
}
