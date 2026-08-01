// Module-local tile and world tests.
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { grid, world, set, recolor, Tiled, type Skin, type Level } from "@src/tiles/index.js";
import { LADDER, climbable, ladder, ladderThrough, tagged } from "@src/tiles/presets.js";
import * as LDtk from "@src/ldtk/index.js";
import { climbLadder, slide, moveAndSlide, type Solid } from "@src/collision/index.js";
import { createClockHandle } from "@src/clock/index.js";
import { component, createEcs } from "@src/ecs/index.js";

const LEVEL = `
..o..
.===.
P....
#####
`;

function makeLevel() {
  return grid(LEVEL, {
    size: 10,
    legend: {
      "#": { solid: true },
      "=": { solid: true, oneWay: true },
    },
  });
}

describe("Tiles.grid (level = data)", () => {
  it("derives cols/rows/rect from the ascii", () => {
    const level = makeLevel();
    expect(level.cols).toBe(5);
    expect(level.rows).toBe(4);
    expect(level.rect).toEqual({ x: 0, y: 0, w: 50, h: 40 });
  });

  it("reads cells; outside is empty", () => {
    const level = makeLevel();
    expect(level.at(0, 3)).toBe("#");
    expect(level.at(2, 0)).toBe("o");
    expect(level.at(-1, 0)).toBe(".");
    expect(level.at(0, 99)).toBe(".");
  });

  it("marker rule: unknown chars are spawn points at tile centers", () => {
    const level = makeLevel();
    expect(level.spawns("o")).toEqual([{ x: 25, y: 5 }]);
    expect(level.spawnOne("P")).toEqual({ x: 5, y: 25 });
    expect(() => level.spawnOne("Q")).toThrow(/no "Q" marker/);
  });

  it("the whole definition is JSON-serializable data", () => {
    const legend = { "#": { solid: true } };
    expect(() => JSON.stringify({ ascii: LEVEL, size: 10, legend })).not.toThrow();
  });

  it("parses multi-character glyphs as visual multi-cell tiles", () => {
    const level = grid(String.raw`//#\\`, {
      size: 10,
      legend: {
        "//": { slope: "up-right" },
        "#": { solid: true },
        "\\\\": { slope: "up-left" },
      },
    });
    expect(level.cols).toBe(5);
    expect(level.at(0, 0)).toBe("//");
    expect(level.at(1, 0)).toBe(".");
    expect(level.at(3, 0)).toBe("\\\\");
    expect(level.span("//")).toEqual([2, 1]);
    expect(level.solidsNear(level.rect, [])).toEqual([
      { x: 0, y: 0, w: 20, h: 10, oneWay: false, slope: "up-right" },
      { x: 20, y: 0, w: 10, h: 10, oneWay: false, slope: undefined },
      { x: 30, y: 0, w: 20, h: 10, oneWay: false, slope: "up-left" },
    ]);
  });

  it("accepts semantic cell ids without turning them into ASCII glyphs", () => {
    const level = grid(
      [
        ["Player", ".", "."],
        ["Solid", "Slope", "."],
      ],
      {
        size: 10,
        legend: {
          Solid: { solid: true },
          Slope: { slope: "up-right", span: [2, 1] },
        },
      },
    );
    expect(level.at(0, 1)).toBe("Solid");
    expect(level.at(1, 1)).toBe("Slope");
    expect(level.spawnOne("Player")).toEqual({ x: 5, y: 5 });
  });

  it("uses the longest matching legend glyph", () => {
    const level = grid("//", {
      size: 10,
      legend: {
        "/": { solid: true },
        "//": { slope: "up-right" },
      },
    });
    expect(level.at(0, 0)).toBe("//");
    expect(level.solidsNear(level.rect, [])[0]).toMatchObject({ w: 20, slope: "up-right" });
  });

  it("reserves . and space as empty", () => {
    expect(() => grid(".", { size: 8, legend: { ".": { solid: true } } as never })).toThrow(
      /reserved/,
    );
  });

  it("solidAt answers point queries", () => {
    const level = makeLevel();
    expect(level.solidAt(5, 35)).toBe(true); // inside the # floor
    expect(level.solidAt(5, 5)).toBe(false);
  });

  it("set() rewrites cells (breakable blocks)", () => {
    const level = makeLevel();
    level.set(0, 3, null);
    expect(level.at(0, 3)).toBe(".");
    expect(level.solidAt(5, 35)).toBe(false);
  });

  it("solidsNear appends only nearby solid rects, oneWay flagged", () => {
    const level = makeLevel();
    const out: Solid[] = [];
    level.solidsNear({ x: 0, y: 25, w: 50, h: 15 }, out); // bottom two rows
    // The five # floor tiles are merged into one rect with no internal edges.
    expect(out).toEqual([{ x: 0, y: 30, w: 50, h: 10, oneWay: false, slope: undefined }]);
    out.length = 0;
    level.solidsNear({ x: 10, y: 10, w: 10, h: 10 }, out); // the shelf row
    expect(out.some((s) => s.oneWay)).toBe(true);
  });

  it("provides slope solids and ladder queries from legend semantics", () => {
    const level = grid(">/", {
      size: 16,
      legend: {
        ">": { slope: "up-right" },
        "/": ladder,
      },
    });
    const solids = level.solidsNear(level.rect, []);
    expect(solids).toHaveLength(2);
    expect(solids).toContainEqual(expect.objectContaining({ slope: "up-right", w: 16, h: 16 }));
    expect(solids).toContainEqual(expect.objectContaining({ x: 16, y: 0, oneWay: true }));
    expect(level.solidAt(4, 4)).toBe(true);
    expect(level.tagAt(20, 4, LADDER)).toBe(true);
    expect(level.rectsNear(LADDER, level.rect, [])).toEqual([{ x: 16, y: 0, w: 16, h: 16 }]);
  });

  it("lets one map cell own a multi-cell collision or ladder span", () => {
    const level = grid(
      `
R.#
H..
...
`,
      {
        size: 16,
        legend: {
          R: { slope: "up-right", span: [2, 1] },
          H: { ...ladder, span: [1, 2] },
          "#": { solid: true },
        },
      },
    );

    expect(level.solidAt(24, 8)).toBe(true); // empty-looking covered half
    expect(level.tagAt(8, 24, LADDER)).toBe(true);
    expect(level.solidsNear({ x: 20, y: 0, w: 4, h: 12 }, [])).toEqual([
      { x: 0, y: 0, w: 32, h: 16, oneWay: false, slope: "up-right" },
    ]);
    expect(level.rectsNear(LADDER, { x: 0, y: 20, w: 12, h: 4 }, [])).toEqual([
      { x: 0, y: 16, w: 16, h: 32 },
    ]);
  });

  it("uses a tall span for a steeper slope", () => {
    const level = grid(
      `
S#
.#
##
`,
      {
        size: 16,
        legend: {
          S: { slope: "up-right", span: [1, 2] },
          "#": { solid: true },
        },
      },
    );
    expect(level.solidAt(8, 24)).toBe(true);
    expect(level.solidsNear({ x: 0, y: 20, w: 8, h: 8 }, [])).toEqual([
      { x: 0, y: 0, w: 16, h: 32, oneWay: false, slope: "up-right" },
    ]);
  });

  it("rejects invalid or overlapping spans", () => {
    expect(() =>
      grid("R#", {
        size: 16,
        legend: { R: { slope: "up-right", span: [2, 1] }, "#": { solid: true } },
      }),
    ).toThrow(/overlaps/);
    expect(() =>
      grid("R", { size: 16, legend: { R: { slope: "up-right", span: [2, 1] } } }),
    ).toThrow(/leaves the grid/);
    expect(() =>
      grid("R", { size: 16, legend: { R: { slope: "up-right", span: [0, 1] } } }),
    ).toThrow(/positive integers/);
  });

  it("is a SolidSource: moveAndSlide collides against it directly", () => {
    const level = makeLevel();
    const body = { x: 2, y: 10, w: 6, h: 6, vel: { x: 0, y: 30 }, grounded: false };
    moveAndSlide(body, level);
    expect(body.grounded).toBe(true);
    expect(body.y).toBeCloseTo(24, 1); // landed on the # floor (y=30) top
  });

  it("oneWay shelves catch falls from above, pass from below", () => {
    const level = makeLevel();
    const faller = { x: 12, y: 0, w: 6, h: 6 };
    const c = slide(faller, { x: 0, y: 20 }, level);
    expect(c.down).toBe(true);
    expect(faller.y).toBeCloseTo(4, 1); // shelf row is y=10
    const jumper = { x: 12, y: 22, w: 6, h: 6 };
    const cj = slide(jumper, { x: 0, y: -20 }, level);
    expect(cj.up).toBe(false); // sailed through
  });

  it("climbs a one-cell ladder shaft surrounded by ground", () => {
    const level = grid(
      `
#T#
#T#
#T#
#T#
###
`,
      {
        size: 16,
        legend: {
          "#": { solid: true },
          T: ladder,
        },
      },
    );
    const ladderSolids: Solid[] = [];
    level.solidsNear(level.rect, ladderSolids);
    expect(ladderSolids.filter((solid) => solid.oneWay)).toEqual([
      expect.objectContaining({ x: 16, y: 0, w: 16 }),
    ]);
    const body = { x: 18, y: 40, w: 12, h: 24, vel: { x: 0, y: 0 }, grounded: true };
    let climbing = false;
    for (let step = 0; step < 20; step++) {
      climbing = climbLadder(body, climbable(level), -1, { active: climbing, speed: 1.5 });
      moveAndSlide(body, level);
    }
    expect(climbing).toBe(true);
    expect(body.y).toBeLessThan(16);
  });

  it("can opt out of the automatic exposed ladder-top platform", () => {
    const level = grid("T", {
      size: 16,
      legend: { T: ladderThrough },
    });
    expect(level.solidsNear(level.rect, [])).toEqual([]);
    expect(level.tagAt(8, 8, LADDER)).toBe(true);
  });

  it("walks smoothly across a one-cell 1:1 slope in both directions", () => {
    const level = grid(
      `
.A#
##.
`,
      {
        size: 16,
        legend: {
          "#": { solid: true },
          A: { slope: "up-right" },
        },
      },
    );
    const up = {
      x: 2,
      y: -8,
      w: 12,
      h: 24,
      vel: { x: 0, y: 0 },
      grounded: true,
    };
    for (let step = 0; step < 36; step++) {
      up.vel.x = 1;
      up.vel.y = 0.25;
      moveAndSlide(up, level);
    }
    expect(up.x).toBeGreaterThan(32);
    expect(up.grounded).toBe(true);
    expect(up.y + up.h).toBeCloseTo(0, 2);

    const down = {
      x: 34,
      y: -24,
      w: 12,
      h: 24,
      vel: { x: 0, y: 0 },
      grounded: true,
    };
    for (let step = 0; step < 36; step++) {
      down.vel.x = -1;
      down.vel.y = 0.25;
      moveAndSlide(down, level);
    }
    expect(down.x).toBeLessThan(16);
    expect(down.grounded).toBe(true);
    expect(down.y + down.h).toBeCloseTo(16, 2);
  });
});

describe("Tiles.world", () => {
  it("gives tile strings the same multi-level portal contract as LDtk", () => {
    const maps = world(
      {
        field: "....A.\n######",
        cave: ".B....\n######",
      },
      {
        size: 8,
        legend: { "#": { solid: true } },
        portals: [{ between: ["field:A", "cave:B"], transition: "wipe-right", transitionMs: 240 }],
      },
    );

    expect(maps.areas).toEqual(["field", "cave"]);
    expect(maps.markers("A")).toEqual([{ x: 36, y: 4, area: "field" }]);
    expect(maps.portals("field")).toEqual([
      {
        x: 32,
        y: 0,
        w: 8,
        h: 8,
        to: { area: "cave", spawn: "B", anchor: "feet" },
        transition: "wipe-right",
        transitionMs: 240,
      },
    ]);
    expect(maps.resolve(maps.portals("field")[0].to)).toEqual({ x: 12, y: 8 });
  });
});

describe("Tiles skins & rendering", () => {
  function fakeCtx() {
    const fills: Array<[number, number, number, number, string]> = [];
    const images: Array<[number, number, number, number]> = [];
    const smoothing: boolean[] = [];
    const ctx = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect(x: number, y: number, w: number, h: number) {
        fills.push([x, y, w, h, ctx.fillStyle]);
      },
      drawImage(
        _img: unknown,
        _sx: number,
        _sy: number,
        _sw: number,
        _sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) {
        images.push([dx, dy, dw, dh]);
        smoothing.push(ctx.imageSmoothingEnabled);
      },
      canvas: { width: 100, height: 100 },
      fills,
      images,
      smoothing,
    };
    return ctx as unknown as CanvasRenderingContext2D & {
      fills: typeof fills;
      images: typeof images;
      smoothing: typeof smoothing;
    };
  }

  it("skins map chars to colors at the draw site; markers don't draw", () => {
    const level = makeLevel();
    const skin = { "#": "#333", "=": "#555" } satisfies Skin<typeof level>;
    const ctx = fakeCtx();
    level.render(ctx, skin);
    expect(ctx.fills.length).toBe(8); // 5 floor + 3 shelf; o/P markers skipped
    expect(ctx.fills.some(([, , , , c]) => c === "#555")).toBe(true);
  });

  it("null skin entries are deliberately invisible", () => {
    const level = makeLevel();
    const ctx = fakeCtx();
    level.render(ctx, { "#": "#333", "=": null } satisfies Skin<typeof level>);
    expect(ctx.fills.length).toBe(5);
  });

  it("selector cells draw images and see coords + neighbors", () => {
    const level = makeLevel();
    const img = {} as CanvasImageSource;
    const tiles = set(img, { size: 16, names: { ground: [0, 0] } });
    const seen: Array<{ cx: number; right: boolean }> = [];
    const skin = {
      "#": (cell) => {
        seen.push({ cx: cell.cx, right: cell.neighbor(1, 0) });
        return tiles.ground;
      },
      "=": null,
    } satisfies Skin<typeof level>;
    const ctx = fakeCtx();
    level.render(ctx, skin);
    expect(ctx.images.length).toBe(5);
    expect(ctx.smoothing).toEqual([false, false, false, false, false]);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(seen[0].right).toBe(true); // floor run connects
    expect(seen[4].right).toBe(false); // last cell has no right neighbor
  });

  it("places adjacent image tiles on one exact shared edge", () => {
    const level = makeLevel();
    const image = {} as CanvasImageSource;
    const tile = set(image, { size: 16, names: { ground: [0, 0] } }).ground;
    const ctx = fakeCtx();
    level.render(ctx, { "#": tile, "=": null });

    expect(ctx.images).toEqual([
      [0, 30, 10, 10],
      [10, 30, 10, 10],
      [20, 30, 10, 10],
      [30, 30, 10, 10],
      [40, 30, 10, 10],
    ]);
    for (let i = 1; i < ctx.images.length; i++)
      expect(ctx.images[i - 1][0] + ctx.images[i - 1][2]).toBe(ctx.images[i][0]);
  });

  it("draws a multi-cell atlas region as one stamp above ordinary tiles", () => {
    const level = grid("R.#", {
      size: 10,
      legend: {
        R: { slope: "up-right", span: [2, 1] },
        "#": { solid: true },
      },
    });
    const image = {} as CanvasImageSource;
    const tiles = set(image, { size: 16, names: { ground: [0, 0] } });
    const slope = tiles.region(19, 1, 2, 2);
    expect(slope).toMatchObject({ sx: 304, sy: 16, sw: 32, sh: 32, cols: 2, rows: 2 });

    const ctx = fakeCtx();
    level.render(ctx, { R: slope, "#": tiles.ground });
    expect(ctx.images).toEqual([
      [20, 0, 10, 10],
      [0, 0, 20, 20],
    ]);
  });

  it("selector cells see solid semantics through a neighboring span", () => {
    const level = grid("R.#", {
      size: 10,
      legend: {
        R: { slope: "up-right", span: [2, 1] },
        "#": { solid: true },
      },
    });
    let connected = false;
    level.render(fakeCtx(), {
      R: null,
      "#": (at) => {
        connected = at.solid(-1, 0);
        return "#333";
      },
    });
    expect(connected).toBe(true);
  });
});

describe("Tiles.set selectors", () => {
  const img = {} as CanvasImageSource;
  const tiles = set(img, {
    size: 8,
    names: { a: [0, 0], b: [1, 0], base: [4, 4], wide: [2, 3, 2, 1] },
  });

  it("names resolve to source cells", () => {
    expect(tiles.a).toMatchObject({ sx: 0, sy: 0, sw: 8, sh: 8 });
    expect(tiles.b).toMatchObject({ sx: 8, sy: 0 });
    expect(tiles.cell(2, 3)).toMatchObject({ sx: 16, sy: 24 });
    expect(tiles.wide).toMatchObject({ sx: 16, sy: 24, sw: 16, sh: 8, cols: 2, rows: 1 });
  });

  it("region validates its multi-cell dimensions", () => {
    expect(() => tiles.region(0, 0, 0, 1)).toThrow(/positive integers/);
    expect(() => tiles.region(0, 0, 1.5, 1)).toThrow(/positive integers/);
  });

  it("pick is deterministic per cell (stable across frames)", () => {
    const sel = tiles.pick([tiles.a, tiles.b]);
    const at = (cx: number, cy: number) => ({
      cx,
      cy,
      char: "#",
      neighbor: () => false,
      solid: () => false,
    });
    const first = sel(at(3, 7));
    expect(sel(at(3, 7))).toBe(first); // same cell → same variant, every time
  });

  it("anim derives the frame from the clock, phase-offset per cell", () => {
    let steps = 0;
    const clock = createClockHandle(1000 / 60, () => steps);
    const sel = tiles.anim([tiles.a, tiles.b], { fps: 10, clock });
    const at = { cx: 0, cy: 0, char: "~", neighbor: () => false, solid: () => false };
    const before = sel(at);
    steps += 100 / (1000 / 60); // 100ms = one 10fps frame
    expect(sel(at)).not.toBe(before);
  });

  it("pick spreads variants roughly evenly across a 100x100 grid", () => {
    const variants = [tiles.a, tiles.b, tiles.cell(2, 0), tiles.cell(3, 0)];
    const sel = tiles.pick(variants);
    const counts = [0, 0, 0, 0];
    for (let cy = 0; cy < 100; cy++) {
      for (let cx = 0; cx < 100; cx++) {
        counts[
          variants.indexOf(
            sel({ cx, cy, char: "#", neighbor: () => false, solid: () => false }) as never,
          )
        ]++;
      }
    }
    // The integer hash should land each variant near 25% (allow 15-35%).
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(1500);
      expect(n).toBeLessThanOrEqual(3500);
    }
  });

  it("auto16 picks the cell by neighbor bitmask", () => {
    const sel = tiles.auto16(tiles.base);
    // up(1) + right(2) = mask 3 → base col+3, row+0
    const cellRef = sel({
      cx: 0,
      cy: 0,
      char: "#",
      neighbor: (dx, dy) => (dx === 0 && dy === -1) || (dx === 1 && dy === 0),
      solid: () => false,
    });
    expect(cellRef).toMatchObject({ sx: (4 + 3) * 8, sy: 4 * 8 });
  });

  it("auto9 picks edges from a strided 3x3 atlas", () => {
    const sel = tiles.auto9(tiles.a, { stride: 2 });
    const cellRef = sel({
      cx: 0,
      cy: 0,
      char: "#",
      neighbor: (dx, dy) => dy === 1 || Math.abs(dx) === 1,
      solid: () => false,
    });
    // top-middle: base + one horizontal stride
    expect(cellRef).toMatchObject({ sx: 2 * 8, sy: 0 });
    expect(() => tiles.auto9(tiles.a, { stride: 0 })).toThrow(/positive integer/);
  });

  it("auto9 can connect different solid tile kinds", () => {
    const sel = tiles.auto9(tiles.a, { connect: "solid" });
    const cellRef = sel({
      cx: 0,
      cy: 0,
      char: "#",
      neighbor: () => false,
      solid: (dx, dy) => dx === -1 || dy === 1,
    });
    // top-right: connected below and left, open above and right
    expect(cellRef).toMatchObject({ sx: 2 * 8, sy: 0 });
  });

  it("auto9 uses a corner-specific cell for a missing diagonal", () => {
    const inner = tiles.cell(7, 6);
    const sel = tiles.auto9(tiles.a, {
      connect: "solid",
      innerCorners: { bottomRight: inner },
    });
    const cellRef = sel({
      cx: 0,
      cy: 0,
      char: "#",
      neighbor: () => false,
      solid: (dx, dy) => Math.abs(dx) + Math.abs(dy) === 1 || dx !== 1 || dy !== 1,
    });
    expect(cellRef).toBe(inner);
  });
});

describe("editor format adapters", () => {
  it("reads Tiled tileset names, spacing, regions, and animations", () => {
    let steps = 0;
    const clock = createClockHandle(1000 / 60, () => steps);
    const tiles = Tiled.set({} as CanvasImageSource, {
      tilewidth: 8,
      tileheight: 8,
      columns: 4,
      margin: 1,
      spacing: 2,
      tilecount: 8,
      tiles: [
        {
          id: 1,
          class: "bridge",
          properties: [{ name: "cols", type: "int", value: 2 }],
          animation: [
            { tileid: 1, duration: 100 },
            { tileid: 2, duration: 200 },
          ],
        },
      ],
    });

    expect(tiles.named("bridge")).toMatchObject({
      sx: 11,
      sy: 1,
      sw: 18,
      sh: 8,
      cols: 2,
    });
    steps = 9; // 150ms at the fixed 60Hz step.
    expect(tiles.anim("bridge", clock)({} as never).sx).toBe(21);
  });

  it("turns a Tiled tile layer into ordinary level semantics", () => {
    const level = Tiled.grid(
      {
        tilewidth: 12,
        tileheight: 12,
        width: 3,
        height: 2,
        layers: [
          {
            name: "Collision",
            type: "tilelayer",
            width: 3,
            height: 2,
            data: [0, 1, 0, 0x80000002, 0, 0],
          },
        ],
      },
      {
        layer: "Collision",
        tiles: { 0: "#", 1: "=" },
        legend: { "#": { solid: true }, "=": { solid: true, oneWay: true } },
      },
    );

    expect(level.at(1, 0)).toBe("#");
    expect(level.at(0, 1)).toBe("=");
    expect(level.rect).toEqual({ x: 0, y: 0, w: 36, h: 24 });
  });

  it("combines LDtk IntGrid values, rectangle entities, and point markers", () => {
    const level = LDtk.grid(
      {
        levels: [
          {
            identifier: "Test",
            layerInstances: [
              {
                __identifier: "World",
                __type: "IntGrid",
                __gridSize: 10,
                __cWid: 4,
                __cHei: 3,
                intGridCsv: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                entityInstances: [
                  {
                    __identifier: "Platform",
                    __grid: [1, 1],
                    px: [10, 10],
                    width: 20,
                    height: 10,
                  },
                  {
                    __identifier: "Spawn",
                    __grid: [3, 2],
                    px: [30, 20],
                    width: 10,
                    height: 10,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        level: "Test",
        layer: "World",
        values: { 1: "#" },
        legend: { "#": { solid: true }, "=": { solid: true, oneWay: true } },
        entities: { Platform: "=" },
        markers: { Spawn: "P" },
      },
    );

    expect([level.at(1, 1), level.at(2, 1)]).toEqual(["=", "="]);
    expect(level.spawnOne("P")).toEqual({ x: 35, y: 25 });
  });

  it("reads LDtk trigger entities and their custom fields", () => {
    const project = {
      levels: [
        {
          identifier: "Forest",
          layerInstances: [
            {
              __identifier: "Objects",
              __type: "Entities",
              __gridSize: 16,
              __cWid: 8,
              __cHei: 8,
              __pxTotalOffsetX: 4,
              __pxTotalOffsetY: 8,
              entityInstances: [
                {
                  __identifier: "Portal",
                  __grid: [2, 3] as [number, number],
                  px: [32, 48] as [number, number],
                  width: 16,
                  height: 32,
                  fieldInstances: [
                    { __identifier: "Area", __value: "Cave" },
                    { __identifier: "Spawn", __value: "Entrance" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(LDtk.entities(project, { level: "Forest", type: "Portal" })).toEqual([
      expect.objectContaining({
        type: "Portal",
        x: 36,
        y: 56,
        w: 16,
        h: 32,
        fields: { Area: "Cave", Spawn: "Entrance" },
      }),
    ]);
  });

  it("infers semantic entity behavior from terse mm: tags", () => {
    const level = LDtk.grid(
      {
        defs: {
          entities: [
            { identifier: "Ground", tags: ["mm:solid"] },
            {
              identifier: "Ramp",
              tags: ["mm:slope:up-right", "mm:span:2x1"],
            },
            { identifier: "Start", tags: ["mm:marker"] },
          ],
        },
        levels: [
          {
            identifier: "Tagged",
            layerInstances: [
              {
                __identifier: "World",
                __type: "Entities",
                __gridSize: 8,
                __cWid: 4,
                __cHei: 2,
                entityInstances: [
                  { __identifier: "Ground", __grid: [0, 1], px: [0, 8], width: 8, height: 8 },
                  { __identifier: "Ramp", __grid: [1, 1], px: [8, 8], width: 16, height: 8 },
                  { __identifier: "Start", __grid: [0, 0], px: [0, 0], width: 8, height: 8 },
                ],
              },
            ],
          },
        ],
      },
      { level: "Tagged", layer: "World" },
    );

    expect(level.legend).toMatchObject({
      Ground: { solid: true },
      Ramp: { slope: "up-right", span: [2, 1] },
    });
    expect(level.at(1, 1)).toBe("Ramp");
    expect(level.spawnOne("Start")).toEqual({ x: 4, y: 4 });
  });

  it("extracts entity unions and validates complete LDtk skins", () => {
    const project = {
      defs: {
        entities: [
          { identifier: "Ground", tags: ["mm:solid"] },
          { identifier: "Ramp", tags: ["mm:slope:up-right"] },
          { identifier: "Player", tags: ["mm:marker"] },
          { identifier: "Portal", tags: [] },
        ],
      },
      levels: [],
    } as const;

    const types = LDtk.entityTypes(project);
    expect(types).toEqual(["Ground", "Ramp", "Player", "Portal"]);
    expectTypeOf(types).toEqualTypeOf<("Ground" | "Ramp" | "Player" | "Portal")[]>();

    expect(LDtk.skin(project, { Ground: "#654", Ramp: null })).toEqual({
      Ground: "#654",
      Ramp: null,
    });
    expect(() => LDtk.skin(project as unknown, { Ground: "#654" })).toThrow(/missing "Ramp"/);
  });

  it("renders authored LDtk tile layers without a skin", () => {
    const image = {} as CanvasImageSource;
    const layer = LDtk.tiles(
      {
        defs: {
          tilesets: [
            {
              identifier: "Terrain",
              uid: 7,
              tileGridSize: 16,
              pxWid: 64,
              pxHei: 64,
            },
          ],
        },
        levels: [
          {
            identifier: "Forest",
            pxWid: 64,
            pxHei: 32,
            layerInstances: [
              {
                __identifier: "Art",
                __type: "Tiles",
                __gridSize: 16,
                __cWid: 4,
                __cHei: 2,
                __tilesetDefUid: 7,
                __pxTotalOffsetX: 3,
                __pxTotalOffsetY: 4,
                gridTiles: [{ px: [16, 0], src: [32, 16], f: 0, a: 0.5 }],
              },
            ],
          },
        ],
      },
      { level: "Forest", layer: "Art", image },
    );
    const drawImage = vi.fn();
    const ctx = {
      imageSmoothingEnabled: true,
      globalAlpha: 0.8,
      drawImage,
    } as unknown as CanvasRenderingContext2D;

    layer.render(ctx);

    expect(layer.rect).toEqual({ x: 3, y: 4, w: 64, h: 32 });
    expect(drawImage).toHaveBeenCalledWith(image, 32, 16, 16, 16, 19, 4, 16, 16);
    expect(ctx.globalAlpha).toBe(0.8);
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it("loads a whole LDtk world without game-side comprehensions", () => {
    const entityLayer = (entities: unknown[]) => ({
      __identifier: "World",
      __type: "Entities",
      __gridSize: 16,
      __cWid: 4,
      __cHei: 2,
      entityInstances: entities,
    });
    const artLayer = {
      __identifier: "Art",
      __type: "Tiles",
      __gridSize: 16,
      __cWid: 4,
      __cHei: 2,
      gridTiles: [],
    };
    const world = LDtk.world<"A" | "B", "Player" | "Portal" | "Decoration">(
      {
        defs: {
          entities: [
            { identifier: "Player", tags: ["mm:marker"] },
            { identifier: "Portal", tags: ["mm:portal"] },
            { identifier: "Decoration", tags: ["mm:sprite"] },
          ],
        },
        levels: [
          {
            identifier: "A",
            fieldInstances: [{ __identifier: "Name", __value: "Forest" }],
            layerInstances: [
              entityLayer([
                { __identifier: "Player", __grid: [0, 0], px: [0, 0], width: 16, height: 16 },
                {
                  iid: "tree-a",
                  __identifier: "Decoration",
                  __grid: [1, 0],
                  px: [16, 3],
                  width: 20,
                  height: 29,
                  fieldInstances: [{ __identifier: "Asset", __value: "tree" }],
                },
                {
                  iid: "door-a",
                  __identifier: "Portal",
                  __grid: [2, 0],
                  px: [32, 0],
                  width: 16,
                  height: 32,
                  fieldInstances: [
                    { __identifier: "To", __value: { entityIid: "door-b" } },
                    { __identifier: "Transition", __value: "WipeRight" },
                    { __identifier: "TransitionMs", __value: 250 },
                  ],
                },
              ]),
              artLayer,
            ],
          },
          {
            identifier: "B",
            layerInstances: [
              entityLayer([
                {
                  iid: "door-b",
                  __identifier: "Portal",
                  __grid: [0, 0],
                  px: [0, 0],
                  width: 16,
                  height: 32,
                  fieldInstances: [
                    { __identifier: "To", __value: { entityIid: "door-a" } },
                    { __identifier: "Transition", __value: "Fade" },
                  ],
                },
              ]),
              artLayer,
            ],
          },
        ],
      },
      { image: {} as CanvasImageSource },
    );

    expect(world.areas).toEqual(["A", "B"]);
    expect(world.fields("A")).toEqual({ Name: "Forest" });
    expect(world.level("A").spawnOne("Player")).toEqual({ x: 8, y: 8 });
    expect(world.tiles("B").skinless).toBe(true);
    expect(world.entities("Portal")).toHaveLength(2);
    expect(world.points("Decoration")).toEqual([
      { id: "tree-a", type: "Decoration", area: "A", x: 26, y: 17.5 },
    ]);
    const tree = { width: 20, height: 29 } as HTMLImageElement;
    const images = { tree };
    expect(world.sprites("A", images)).toEqual([
      {
        x: 16,
        y: 3,
        w: 20,
        h: 29,
        img: tree,
        ax: 0,
        ay: 0,
      },
    ]);
    expect(world.sprites("A", images)).toBe(world.sprites("A", images));
    const Asset = component<string>("Asset");
    const ecs = createEcs();
    expect(
      world.spawn(
        ecs,
        {
          Decoration: (entity) => Asset.with(String(entity.fields.Asset)),
        },
        "A",
      ),
    ).toHaveLength(1);
    expect(ecs.dense(Asset)).toEqual(["tree"]);
    expect(world.portals("A")).toEqual([
      {
        id: "door-a",
        x: 32,
        y: 0,
        w: 16,
        h: 32,
        to: { area: "B", spawn: "door-b", anchor: "feet" },
        transition: "wipe-right",
        transitionMs: 250,
      },
    ]);
    expect(world.resolve(world.portals("A")[0].to)).toEqual({ x: 8, y: 32 });
  });
});

describe("Tiles static-layer baking (render with { bake: true })", () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    vi.restoreAllMocks();
  });

  // A recording 2d context: per-tile fills vs whole-level blits, plus an
  // optional getTransform so the bake path can read a camera scale.
  function recordingCtx(transformScale?: number) {
    const fills: unknown[][] = [];
    const blits: unknown[][] = [];
    const ctx: Record<string, unknown> = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect: (...a: unknown[]) => fills.push(a),
      drawImage: (...a: unknown[]) => blits.push(a),
      scale: vi.fn(),
      canvas: { width: 100, height: 100 },
      fills,
      blits,
    };
    if (transformScale !== undefined) {
      ctx.getTransform = () => ({
        a: transformScale,
        b: 0,
        c: 0,
        d: transformScale,
        e: 0,
        f: 0,
      });
    }
    return ctx as unknown as CanvasRenderingContext2D & {
      fills: unknown[][];
      blits: unknown[][];
    };
  }

  /** Route offscreen (bake) canvas contexts to recording ctxs; returns them. */
  function installOffscreen() {
    const offscreens: Array<ReturnType<typeof recordingCtx>> = [];
    HTMLCanvasElement.prototype.getContext = function () {
      const c = recordingCtx();
      offscreens.push(c);
      return c as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;
    return offscreens;
  }

  const SKIN = { "#": "#333", "=": "#555" };

  it("bakes once, then blits ONE whole-level canvas instead of per-tile fills", () => {
    const offscreens = installOffscreen();
    const level = makeLevel();
    const ctx = recordingCtx();
    level.render(ctx, SKIN, { bake: true });
    level.render(ctx, SKIN, { bake: true });
    expect(offscreens).toHaveLength(1); // baked exactly once
    expect(offscreens[0].fills).toHaveLength(8); // ALL cells painted into the bake
    expect(ctx.fills).toHaveLength(0); // no per-tile fills on the main ctx
    expect(ctx.blits).toHaveLength(2); // one whole-level blit per frame
    expect(ctx.blits[0].slice(1)).toEqual([0, 0, 50, 40]); // world-sized dest rect
  });

  it("invalidate() and set() drop the bake so the next render re-bakes", () => {
    const offscreens = installOffscreen();
    const level = makeLevel();
    const ctx = recordingCtx();
    level.render(ctx, SKIN, { bake: true });
    level.invalidate();
    level.render(ctx, SKIN, { bake: true });
    expect(offscreens).toHaveLength(2);
    level.set(0, 3, null); // cell mutation invalidates too
    level.render(ctx, SKIN, { bake: true });
    expect(offscreens).toHaveLength(3);
    expect(offscreens[2].fills).toHaveLength(7); // the cleared cell is gone
  });

  it("re-bakes when the camera scale leaves the ±25% window", () => {
    const offscreens = installOffscreen();
    const level = makeLevel();
    level.render(recordingCtx(1), SKIN, { bake: true });
    level.render(recordingCtx(1.2), SKIN, { bake: true }); // within ±25% → reuse
    expect(offscreens).toHaveLength(1);
    level.render(recordingCtx(2), SKIN, { bake: true }); // beyond → re-bake
    expect(offscreens).toHaveLength(2);
  });

  it("oversized levels warn once and fall back to per-tile permanently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installOffscreen();
    // 500 cols × 10px = 5000 device px > the 4096 bake cap.
    const level = grid("#".repeat(500), { size: 10, legend: { "#": { solid: true } } });
    const ctx = recordingCtx();
    level.render(ctx, { "#": "#333" }, { bake: true });
    level.render(ctx, { "#": "#333" }, { bake: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/too large to bake/);
    expect(ctx.blits).toHaveLength(0);
    expect(ctx.fills).toHaveLength(1000); // live per-tile path, both frames
  });

  it("falls back silently when 2d contexts are unavailable (headless/jsdom)", () => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const level = makeLevel();
    const ctx = recordingCtx();
    level.render(ctx, SKIN, { bake: true });
    expect(ctx.fills).toHaveLength(8); // live path
    expect(ctx.blits).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

// Type-level: Skin<typeof level> is exported for `satisfies` — a level with a
// narrower legend accepts exactly its chars.
it("Skin type is usable for annotation", () => {
  const level: Level<"#"> = grid("#", { size: 4, legend: { "#": { solid: true } } });
  const skin: Skin<typeof level> = { "#": "#000" };
  expect(skin["#"]).toBe("#000");
});

describe("Tiles.orient", () => {
  const img = {} as CanvasImageSource;

  function transformCtx() {
    const blits: unknown[][] = [];
    const ops: string[] = [];
    const ctx: Record<string, unknown> = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect: () => {},
      drawImage: (...a: unknown[]) => blits.push(a),
      save: () => ops.push("save"),
      restore: () => ops.push("restore"),
      translate: (x: number, y: number) => ops.push(`translate(${x},${y})`),
      rotate: (r: number) => ops.push(`rotate(${(r / Math.PI) * 2})`),
      scale: (x: number, y: number) => ops.push(`scale(${x},${y})`),
      canvas: { width: 100, height: 100 },
      blits,
      ops,
    };
    return ctx as unknown as CanvasRenderingContext2D & { blits: unknown[][]; ops: string[] };
  }

  it("returns a new cell and composes with an already-oriented one", () => {
    const ts = set(img, { size: 16, names: { ramp: [1, 0] } });
    const once = ts.orient(ts.ramp, { flipX: true, turn: 1 });
    expect(ts.ramp.flipX).toBeUndefined(); // source untouched
    expect(once).toMatchObject({ sx: 16, sy: 0, flipX: true, flipY: false, turn: 1 });

    const twice = ts.orient(once, { flipX: true, turn: 3 });
    expect(twice).toMatchObject({ flipX: false, turn: 0 }); // flips xor, turns add mod 4
  });

  it("draws an unoriented cell without touching the transform", () => {
    const level = grid("#", { size: 10, legend: { "#": { solid: true } } });
    const ts = set(img, { size: 16, names: { ground: [0, 0] } });
    const ctx = transformCtx();
    level.render(ctx, { "#": ts.ground });
    expect(ctx.ops).toEqual([]);
    expect(ctx.blits).toEqual([[img, 0, 0, 16, 16, 0, 0, 10, 10]]);
  });

  it("mirrors and turns around the cell centre, keeping the same footprint", () => {
    const level = grid("#", { size: 10, legend: { "#": { solid: true } } });
    const ts = set(img, { size: 16, names: { ground: [0, 0] } });
    const ctx = transformCtx();
    level.render(ctx, { "#": ts.orient(ts.ground, { flipX: true, turn: 1 }) });
    expect(ctx.ops).toEqual(["save", "translate(5,5)", "rotate(1)", "scale(-1,1)", "restore"]);
    // Drawn centred on the origin of the rotated frame, so it still covers 10×10.
    expect(ctx.blits).toEqual([[img, 0, 0, 16, 16, -5, -5, 10, 10]]);
  });

  it("swaps the drawn axes for an odd quarter-turn of a non-square stamp", () => {
    const level = grid("R.", {
      size: 10,
      legend: { R: { solid: true, span: [2, 1] } },
    });
    const ts = set(img, { size: 16, names: { ground: [0, 0] } });
    const ctx = transformCtx();
    level.render(ctx, { R: ts.orient(ts.region(0, 0, 2, 1), { turn: 1 }) });
    // Footprint is 20×10 world px, so the rotated frame draws 10×20.
    expect(ctx.blits).toEqual([[img, 0, 0, 32, 16, -5, -10, 10, 20]]);
  });
});

describe("Tiles.set.auto4 (dual grid)", () => {
  const img = {} as CanvasImageSource;

  function blitCtx() {
    const blits: unknown[][] = [];
    const ctx: Record<string, unknown> = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      fillRect: () => {},
      drawImage: (...a: unknown[]) => blits.push(a),
      canvas: { width: 100, height: 100 },
      blits,
    };
    return ctx as unknown as CanvasRenderingContext2D & { blits: unknown[][] };
  }

  /** mask → [dx, dy] of every blit, keyed by the atlas cell it came from. */
  function drawn(ctx: { blits: unknown[][] }) {
    return ctx.blits.map((b) => ({
      mask: ((b[2] as number) / 16) * 4 + (b[1] as number) / 16,
      dx: b[5] as number,
      dy: b[6] as number,
    }));
  }

  it("draws one tile per corner of the lattice, offset by half a cell", () => {
    const level = grid("##\n##", { size: 10, legend: { "#": { solid: true } } });
    const ts = set(img, { size: 16, names: { terrain: [0, 0] } });
    const ctx = blitCtx();
    level.render(ctx, { "#": ts.auto4(ts.terrain) });

    // 2×2 solid cells → a 3×3 corner lattice, every corner touching terrain.
    expect(ctx.blits).toHaveLength(9);
    expect(drawn(ctx)).toEqual([
      { mask: 4, dx: -5, dy: -5 }, // only the bottom-right cell is filled
      { mask: 12, dx: 5, dy: -5 }, // bottom-left + bottom-right
      { mask: 8, dx: 15, dy: -5 },
      { mask: 6, dx: -5, dy: 5 },
      { mask: 15, dx: 5, dy: 5 }, // interior: all four corners filled
      { mask: 9, dx: 15, dy: 5 },
      { mask: 2, dx: -5, dy: 15 },
      { mask: 3, dx: 5, dy: 15 },
      { mask: 1, dx: 15, dy: 15 },
    ]);
  });

  it("skips the empty mask unless an explicit cell is given", () => {
    const level = grid("#.\n..", { size: 10, legend: { "#": { solid: true } } });
    const ts = set(img, { size: 16, names: { terrain: [0, 0] } });

    const bare = blitCtx();
    level.render(bare, { "#": ts.auto4(ts.terrain) });
    // Only the four corners around the single filled cell are non-empty.
    expect(bare.blits).toHaveLength(4);

    const filled = blitCtx();
    level.render(filled, { "#": ts.auto4(ts.terrain, { empty: ts.cell(3, 3) }) });
    expect(filled.blits).toHaveLength(9);
  });

  it('honours stride and connects across glyphs with connect: "solid"', () => {
    const level = grid("#R", {
      size: 10,
      legend: { "#": { solid: true }, R: { solid: true } },
    });
    const ts = set(img, { size: 16, names: { terrain: [0, 0] } });

    const same = blitCtx();
    level.render(same, { "#": ts.auto4(ts.terrain), R: null });
    // "same" only sees the "#" cell: 4 corners around it.
    expect(same.blits).toHaveLength(4);

    const solid = blitCtx();
    level.render(solid, { "#": ts.auto4(ts.terrain, { connect: "solid" }), R: null });
    expect(solid.blits).toHaveLength(6); // both cells are solid → a 3×2 lattice

    const strided = blitCtx();
    level.render(strided, { "#": ts.auto4(ts.terrain, { stride: 2 }), R: null });
    // Mask 4 sits at atlas (0,1); stride 2 pushes it to row 2 → sy = 32.
    expect(strided.blits[0][2]).toBe(32);
  });

  it("paints underneath ordinary tiles and is skipped by region overhang", () => {
    const level = grid("#o", { size: 10, legend: { "#": { solid: true } } });
    const ts = set(img, { size: 16, names: { terrain: [0, 0], prop: [5, 5] } });
    const ctx = blitCtx();
    level.render(ctx, { "#": ts.auto4(ts.terrain), o: ts.prop });
    const last = ctx.blits[ctx.blits.length - 1];
    expect(last).toEqual([img, 80, 80, 16, 16, 10, 0, 10, 10]); // the prop, on top
  });

  it("rejects a non-positive stride", () => {
    const ts = set(img, { size: 16, names: { terrain: [0, 0] } });
    expect(() => ts.auto4(ts.terrain, { stride: 0 })).toThrow(/positive integer/);
  });
});

describe("Tiles.recolor", () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  /** A 2×1 RGBA image: opaque green, then a transparent pixel of the same hue. */
  function stubCanvas(pixels: number[]) {
    const data = new Uint8ClampedArray(pixels);
    const put: unknown[] = [];
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        imageSmoothingEnabled: true,
        drawImage: () => {},
        getImageData: () => ({ data }),
        putImageData: (image: unknown) => put.push(image),
      } as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;
    return { data, put };
  }

  it("remaps exact colors and leaves transparent pixels alone", () => {
    const { data, put } = stubCanvas([0x7e, 0xc8, 0x50, 0xff, 0x7e, 0xc8, 0x50, 0x00]);
    const out = recolor({ width: 2, height: 1 } as CanvasImageSource, {
      "#7ec850": "#2c4a3b",
    });
    expect(out).toBeInstanceOf(HTMLCanvasElement);
    expect(put).toHaveLength(1);
    expect(Array.from(data.slice(0, 4))).toEqual([0x2c, 0x4a, 0x3b, 0xff]);
    expect(Array.from(data.slice(4))).toEqual([0x7e, 0xc8, 0x50, 0x00]); // untouched
  });

  it("accepts short hex and applies an alpha given on the value", () => {
    const { data } = stubCanvas([0xaa, 0xbb, 0xcc, 0xff]);
    recolor({ width: 1, height: 1 } as CanvasImageSource, { "#abc": "#1234" });
    expect(Array.from(data)).toEqual([0x11, 0x22, 0x33, 0x44]);
  });

  it("throws on a malformed palette entry", () => {
    stubCanvas([0, 0, 0, 0]);
    expect(() => recolor({ width: 1, height: 1 } as CanvasImageSource, { green: "#000" })).toThrow(
      /not a #rgb/,
    );
  });

  it("returns the original image when there is no 2d context or no size", () => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const image = { width: 4, height: 4 } as CanvasImageSource;
    expect(recolor(image, { "#000": "#fff" })).toBe(image);

    const sizeless = {} as CanvasImageSource;
    expect(recolor(sizeless, { "#000": "#fff" })).toBe(sizeless);
  });
});

describe("Tiles merged collision rects", () => {
  it("merges a solid block on both axes", () => {
    const level = grid("###\n###", { size: 10, legend: { "#": { solid: true } } });
    expect(level.solidsNear(level.rect, [])).toEqual([
      { x: 0, y: 0, w: 30, h: 20, oneWay: false, slope: undefined },
    ]);
  });

  it("merges one-way platforms sideways only, keeping every top surface", () => {
    const level = grid("==\n==", { size: 10, legend: { "=": { solid: true, oneWay: true } } });
    expect(level.solidsNear(level.rect, [])).toEqual([
      { x: 0, y: 0, w: 20, h: 10, oneWay: true, slope: undefined },
      { x: 0, y: 10, w: 20, h: 10, oneWay: true, slope: undefined },
    ]);
  });

  it("keeps a lower one-way platform catchable underneath an upper one", () => {
    const level = grid(
      `
....
====
....
====
`,
      { size: 10, legend: { "=": { solid: true, oneWay: true } } },
    );
    const faller = { x: 5, y: 12, w: 6, h: 6 };
    const hit = slide(faller, { x: 0, y: 20 }, level);
    expect(hit.down).toBe(true);
    expect(faller.y).toBeCloseTo(24, 1); // caught by the LOWER platform's top
  });

  it("never merges slopes or multi-cell spans into their neighbours", () => {
    const level = grid("#R.#", {
      size: 10,
      legend: {
        "#": { solid: true },
        R: { slope: "up-right", span: [2, 1] },
      },
    });
    expect(level.solidsNear(level.rect, [])).toEqual([
      { x: 0, y: 0, w: 10, h: 10, oneWay: false, slope: undefined },
      { x: 10, y: 0, w: 20, h: 10, oneWay: false, slope: "up-right" },
      { x: 30, y: 0, w: 10, h: 10, oneWay: false, slope: undefined },
    ]);
  });

  it("merges a ladder column and rebuilds after set()", () => {
    const level = grid("H\nH\nH", { size: 10, legend: { H: ladder } });
    expect(level.rectsNear(LADDER, level.rect, [])).toEqual([{ x: 0, y: 0, w: 10, h: 30 }]);
    // The exposed top is still its own one-way standing surface.
    expect(level.solidsNear(level.rect, [])).toEqual([
      { x: 0, y: 0, w: 10, h: 10, oneWay: true, slope: undefined },
    ]);

    level.set(0, 1, null);
    expect(level.rectsNear(LADDER, level.rect, [])).toEqual([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 20, w: 10, h: 10 },
    ]);
    // The newly exposed lower ladder gains its own standing surface.
    expect(level.solidsNear(level.rect, [])).toHaveLength(2);
  });

  it("returns each merged rect once however many rows the query spans", () => {
    const level = grid("#\n#\n#\n#", { size: 10, legend: { "#": { solid: true } } });
    expect(level.solidsNear({ x: 0, y: 0, w: 10, h: 40 }, [])).toEqual([
      { x: 0, y: 0, w: 10, h: 40, oneWay: false, slope: undefined },
    ]);
  });

  it("still culls to the query area", () => {
    const level = grid("#..#", { size: 10, legend: { "#": { solid: true } } });
    expect(level.solidsNear({ x: 0, y: 0, w: 10, h: 10 }, [])).toEqual([
      { x: 0, y: 0, w: 10, h: 10, oneWay: false, slope: undefined },
    ]);
  });
});

describe("Tiles merged collision index", () => {
  it("returns exactly the overlapping rects on a wide sparse row", () => {
    // Ten one-tile pillars with gaps — ten separate merged rects in one row.
    const level = grid("#.#.#.#.#.#.#.#.#.#.", { size: 10, legend: { "#": { solid: true } } });
    expect(level.solidsNear(level.rect, [])).toHaveLength(10);
    expect(level.solidsNear({ x: 95, y: 0, w: 30, h: 10 }, [])).toEqual([
      { x: 100, y: 0, w: 10, h: 10, oneWay: false, slope: undefined },
      { x: 120, y: 0, w: 10, h: 10, oneWay: false, slope: undefined },
    ]);
    expect(level.solidsNear({ x: 11, y: 0, w: 8, h: 10 }, [])).toEqual([]); // in a gap
  });

  it("finds a wide rect from a query far to its right", () => {
    const level = grid("####################\n..................#.", {
      size: 10,
      legend: { "#": { solid: true } },
    });
    expect(level.solidsNear({ x: 185, y: 0, w: 5, h: 20 }, [])).toEqual([
      { x: 0, y: 0, w: 200, h: 10, oneWay: false, slope: undefined },
      { x: 180, y: 10, w: 10, h: 10, oneWay: false, slope: undefined },
    ]);
  });
});

describe("Tiles region tags", () => {
  it("indexes an arbitrary tag the engine has never heard of", () => {
    const level = grid("ww\nww", {
      size: 10,
      legend: { w: { tags: ["spiderweb"] } },
    });
    expect(level.tagAt(5, 5, "spiderweb")).toBe(true);
    expect(level.tagAt(5, 5, "ladder")).toBe(false);
    // Merged on both axes, like any pure region query.
    expect(level.rectsNear("spiderweb", level.rect, [])).toEqual([{ x: 0, y: 0, w: 20, h: 20 }]);
  });

  it("keeps one index per tag and rebuilds them all after set()", () => {
    const level = grid("ab", {
      size: 10,
      legend: { a: { tags: ["ice"] }, b: { tags: ["mud", "ice"] } },
    });
    expect(level.rectsNear("ice", level.rect, [])).toEqual([{ x: 0, y: 0, w: 20, h: 10 }]);
    expect(level.rectsNear("mud", level.rect, [])).toEqual([{ x: 10, y: 0, w: 10, h: 10 }]);

    level.set(1, 0, null);
    expect(level.rectsNear("ice", level.rect, [])).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
    expect(level.rectsNear("mud", level.rect, [])).toEqual([]);
  });

  it("returns nothing for a tag no glyph carries, without throwing", () => {
    const level = grid("##", { size: 10, legend: { "#": { solid: true } } });
    expect(level.rectsNear("nobody-uses-this", level.rect, [])).toEqual([]);
    expect(level.tagAt(5, 5, "nobody-uses-this")).toBe(false);
  });

  it("standOnTop gives a run one surface at the top, not one per cell", () => {
    const level = grid("V\nV\nV", {
      size: 10,
      legend: { V: { tags: ["vine"], standOnTop: true } },
    });
    expect(level.solidsNear(level.rect, [])).toEqual([
      { x: 0, y: 0, w: 10, h: 10, oneWay: true, slope: undefined },
    ]);
  });
});

describe("Tiles presets are data, not privilege", () => {
  it("ladder is nothing but a tag plus standOnTop", () => {
    expect(ladder).toEqual({ tags: [LADDER], standOnTop: true });
    expect(ladderThrough).toEqual({ tags: [LADDER] });
  });

  it("a hand-rolled tag climbs identically to the built-in ladder", () => {
    // The claim is equivalence, so assert it against the real thing rather than
    // against a threshold: same map, same physics, only the tag name differs.
    const climb = (spec: object, tag: string) => {
      const level = grid("###\n#T#\n#T#\n###", {
        size: 16,
        legend: { "#": { solid: true }, T: spec },
      });
      const body = { x: 18, y: 40, w: 12, h: 24, vel: { x: 0, y: 0 }, grounded: true };
      let climbing = false;
      for (let step = 0; step < 20; step++) {
        climbing = climbLadder(body, climbable(level, tag), -1, { active: climbing, speed: 1.5 });
        moveAndSlide(body, level);
      }
      return { climbing, y: body.y };
    };
    const rope = climb({ tags: ["rope"], standOnTop: true }, "rope");
    expect(rope.climbing).toBe(true);
    expect(rope).toEqual(climb(ladder, LADDER));
  });

  it("climbable caches its view per level and tag", () => {
    const level = grid("H", { size: 10, legend: { H: ladder } });
    expect(climbable(level)).toBe(climbable(level));
    expect(climbable(level, "rope")).not.toBe(climbable(level));
  });

  it("tagged() composes with other semantics", () => {
    expect(tagged("conveyor", { solid: true })).toEqual({ solid: true, tags: ["conveyor"] });
    expect(tagged("b", tagged("a"))).toEqual({ tags: ["a", "b"] });
  });
});

describe("LDtk mm: tags become region tags", () => {
  const project = (tags: string[]) => ({
    defaultGridSize: 8,
    defs: { entities: [{ identifier: "Thing", tags }] },
    levels: [
      {
        identifier: "A",
        pxWid: 16,
        pxHei: 8,
        layerInstances: [
          {
            __identifier: "World",
            __type: "Entities",
            __gridSize: 8,
            __cWid: 2,
            __cHei: 1,
            entityInstances: [
              { __identifier: "Thing", __grid: [0, 0], px: [0, 0], width: 8, height: 8 },
            ],
          },
          {
            __identifier: "Art",
            __type: "Tiles",
            __gridSize: 8,
            __cWid: 2,
            __cHei: 1,
            gridTiles: [],
          },
        ],
      },
    ],
  });

  it("passes an unrecognised mm: tag straight through — no engine change needed", () => {
    const level = LDtk.world(project(["mm:quicksand"]), { image: new Image() }).level("A");
    expect(level.legend.Thing).toEqual({ tags: ["quicksand"] });
    expect(level.rectsNear("quicksand", level.rect, [])).toEqual([{ x: 0, y: 0, w: 8, h: 8 }]);
  });

  it("keeps mm:ladder climbable, standing surface and all", () => {
    const level = LDtk.world(project(["mm:ladder"]), { image: new Image() }).level("A");
    expect(level.legend.Thing).toEqual({ tags: [LADDER], standOnTop: true });
    expect(climbable(level).laddersNear(level.rect, [])).toEqual([{ x: 0, y: 0, w: 8, h: 8 }]);
  });

  it("does NOT turn entity-role tags into tiles", () => {
    // `mm:portal` is read by `world.portals()`. Making it a legend entry would
    // stamp its glyph over the floor beneath it.
    for (const role of ["mm:portal", "mm:sprite", "mm:marker"]) {
      // `portal` names the entity LDtk.world resolves destinations for; this
      // fixture has no destinations, so point it at an identifier nothing uses.
      const world = LDtk.world(project([role]), { image: new Image(), portal: "Unused" });
      const level = world.level("A");
      expect(level.legend.Thing, role).toBeUndefined();
    }
  });
});
