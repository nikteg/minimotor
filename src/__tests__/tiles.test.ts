import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { grid, world, set, Tiled, type Skin, type Level } from "../tiles/index.js";
import * as LDtk from "../ldtk/index.js";
import { climbLadder, slide, moveAndSlide, type Solid } from "../collision.js";
import { createClockHandle } from "../clock.js";
import { component, create } from "../ecs/index.js";

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
    expect(out.length).toBe(5); // the # floor row only
    expect(out.every((s) => !s.oneWay)).toBe(true);
    out.length = 0;
    level.solidsNear({ x: 10, y: 10, w: 10, h: 10 }, out); // the shelf row
    expect(out.some((s) => s.oneWay)).toBe(true);
  });

  it("provides slope solids and ladder queries from legend semantics", () => {
    const level = grid(">/", {
      size: 16,
      legend: {
        ">": { slope: "up-right" },
        "/": { ladder: true },
      },
    });
    const solids = level.solidsNear(level.rect, []);
    expect(solids).toHaveLength(2);
    expect(solids).toContainEqual(expect.objectContaining({ slope: "up-right", w: 16, h: 16 }));
    expect(solids).toContainEqual(expect.objectContaining({ x: 16, y: 0, oneWay: true }));
    expect(level.solidAt(4, 4)).toBe(true);
    expect(level.ladderAt(20, 4)).toBe(true);
    expect(level.laddersNear(level.rect, [])).toEqual([{ x: 16, y: 0, w: 16, h: 16 }]);
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
          H: { ladder: true, span: [1, 2] },
          "#": { solid: true },
        },
      },
    );

    expect(level.solidAt(24, 8)).toBe(true); // empty-looking covered half
    expect(level.ladderAt(8, 24)).toBe(true);
    expect(level.solidsNear({ x: 20, y: 0, w: 4, h: 12 }, [])).toEqual([
      { x: 0, y: 0, w: 32, h: 16, oneWay: false, slope: "up-right" },
    ]);
    expect(level.laddersNear({ x: 0, y: 20, w: 12, h: 4 }, [])).toEqual([
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
          T: { ladder: true },
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
      climbing = climbLadder(body, level, -1, { active: climbing, speed: 1.5 });
      moveAndSlide(body, level);
    }
    expect(climbing).toBe(true);
    expect(body.y).toBeLessThan(16);
  });

  it("can opt out of the automatic exposed ladder-top platform", () => {
    const level = grid("T", {
      size: 16,
      legend: { T: { ladder: true, ladderTop: false } },
    });
    expect(level.solidsNear(level.rect, [])).toEqual([]);
    expect(level.ladderAt(8, 8)).toBe(true);
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
    const clock = createClockHandle(() => steps);
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
    const clock = createClockHandle(() => steps);
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
    const ecs = create();
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
