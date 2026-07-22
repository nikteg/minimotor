import { describe, expect, it } from "vitest";
import { grid, set, type Skin, type Level } from "../tiles.js";
import { slide, moveAndSlide, type Solid } from "../collision.js";
import { createClockHandle } from "../clock.js";

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
});

describe("Tiles skins & rendering", () => {
  function fakeCtx() {
    const fills: Array<[number, number, number, number, string]> = [];
    const images: Array<[number, number]> = [];
    const ctx = {
      fillStyle: "",
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
      ) {
        images.push([dx, dy]);
      },
      canvas: { width: 100, height: 100 },
      fills,
      images,
    };
    return ctx as unknown as CanvasRenderingContext2D & {
      fills: typeof fills;
      images: typeof images;
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
    expect(seen[0].right).toBe(true); // floor run connects
    expect(seen[4].right).toBe(false); // last cell has no right neighbor
  });
});

describe("Tiles.set selectors", () => {
  const img = {} as CanvasImageSource;
  const tiles = set(img, { size: 8, names: { a: [0, 0], b: [1, 0], base: [4, 4] } });

  it("names resolve to source cells", () => {
    expect(tiles.a).toMatchObject({ sx: 0, sy: 0, sw: 8, sh: 8 });
    expect(tiles.b).toMatchObject({ sx: 8, sy: 0 });
    expect(tiles.cell(2, 3)).toMatchObject({ sx: 16, sy: 24 });
  });

  it("pick is deterministic per cell (stable across frames)", () => {
    const sel = tiles.pick([tiles.a, tiles.b]);
    const at = (cx: number, cy: number) => ({
      cx,
      cy,
      char: "#",
      neighbor: () => false,
    });
    const first = sel(at(3, 7));
    expect(sel(at(3, 7))).toBe(first); // same cell → same variant, every time
  });

  it("anim derives the frame from the clock, phase-offset per cell", () => {
    let steps = 0;
    const clock = createClockHandle(() => steps);
    const sel = tiles.anim([tiles.a, tiles.b], { fps: 10, clock });
    const at = { cx: 0, cy: 0, char: "~", neighbor: () => false };
    const before = sel(at);
    steps += 100 / (1000 / 60); // 100ms = one 10fps frame
    expect(sel(at)).not.toBe(before);
  });

  it("auto16 picks the cell by neighbor bitmask", () => {
    const sel = tiles.auto16(tiles.base);
    // up(1) + right(2) = mask 3 → base col+3, row+0
    const cellRef = sel({
      cx: 0,
      cy: 0,
      char: "#",
      neighbor: (dx, dy) => (dx === 0 && dy === -1) || (dx === 1 && dy === 0),
    });
    expect(cellRef).toMatchObject({ sx: (4 + 3) * 8, sy: 4 * 8 });
  });
});

// Type-level: Skin<typeof level> is exported for `satisfies` — a level with a
// narrower legend accepts exactly its chars.
it("Skin type is usable for annotation", () => {
  const level: Level<"#"> = grid("#", { size: 4, legend: { "#": { solid: true } } });
  const skin: Skin<typeof level> = { "#": "#000" };
  expect(skin["#"]).toBe("#000");
});
