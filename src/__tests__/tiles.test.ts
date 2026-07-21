import { describe, it, expect, vi } from "vitest";
import { grid } from "../tiles.js";

// 4×3 level: border of 1s along the bottom + a floating block of 2.
//   0 0 0 0
//   0 2 0 0
//   1 1 1 1
const level = () => [
  [0, 0, 0, 0],
  [0, 2, 0, 0],
  [1, 1, 1, 1],
];

const TW = 16;

function mockCtx() {
  return {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    fillRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
}

describe("Tiles.grid", () => {
  it("exposes grid and world dimensions", () => {
    const map = grid(level(), { tw: TW });
    expect(map.cols).toBe(4);
    expect(map.rows).toBe(3);
    expect(map.worldW).toBe(64);
    expect(map.worldH).toBe(48);
  });

  it("reads cells, world points, and 0 outside the grid", () => {
    const map = grid(level(), { tw: TW });
    expect(map.at(1, 1)).toBe(2);
    expect(map.at(-1, 0)).toBe(0);
    expect(map.at(0, 99)).toBe(0);
    expect(map.tileAt(1 * TW + 8, 1 * TW + 8)).toBe(2); // center of cell (1,1)
    expect(map.tileAt(-5, -5)).toBe(0);
  });

  it("treats ragged rows as empty cells", () => {
    const map = grid([[1], [1, 1, 1]], { tw: TW });
    expect(map.cols).toBe(3);
    expect(map.at(2, 0)).toBe(0);
  });

  it("set writes inside the grid and ignores out-of-bounds", () => {
    const data = level();
    const map = grid(data, { tw: TW });
    map.set(3, 0, 7);
    expect(map.at(3, 0)).toBe(7);
    map.set(-1, 0, 9);
    map.set(0, 99, 9);
    expect(data[0][0]).toBe(0);
  });

  it("solidAt: every non-zero tile is solid by default", () => {
    const map = grid(level(), { tw: TW });
    expect(map.solidAt(8, 2 * TW + 8)).toBe(true); // floor
    expect(map.solidAt(TW + 8, TW + 8)).toBe(true); // the 2-block
    expect(map.solidAt(8, 8)).toBe(false); // air
  });

  it("solidAt honors a custom solidity predicate", () => {
    const map = grid(level(), { tw: TW, solid: (t) => t === 1 });
    expect(map.solidAt(TW + 8, TW + 8)).toBe(false); // 2 is decorative now
    expect(map.solidAt(8, 2 * TW + 8)).toBe(true); // 1 still solid
  });

  it("solidInRect overlaps but does not count edge-touching", () => {
    const map = grid(level(), { tw: TW });
    // Rect resting exactly on the floor (bottom edge at y=32) — no collision.
    expect(map.solidInRect({ x: 4, y: 16, w: 8, h: 16 })).toBe(false);
    // One px lower — overlapping the floor.
    expect(map.solidInRect({ x: 4, y: 17, w: 8, h: 16 })).toBe(true);
    // Spanning into the floating block from the left.
    expect(map.solidInRect({ x: 8, y: 20, w: 12, h: 8 })).toBe(true);
  });

  it("draws non-empty tiles from the color table and reports the count", () => {
    const map = grid(level(), { tw: TW, colors: { 1: "#654321" } });
    const ctx = mockCtx();
    expect(map.draw(ctx)).toBe(5); // 4 floor + 1 block
    expect(ctx.fillRect).toHaveBeenCalledTimes(5);
    expect(ctx.fillRect).toHaveBeenCalledWith(1 * TW, 1 * TW, TW, TW); // the 2-block
  });

  it("culls drawing to the view rect", () => {
    const map = grid(level(), { tw: TW });
    const ctx = mockCtx();
    // View covering only the leftmost column.
    expect(map.draw(ctx, { x: 0, y: 0, w: 15, h: 48 })).toBe(1); // just the floor tile
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it("blits atlas cells with the n-1 (firstgid) convention", () => {
    const atlas = { width: 32, height: 16 } as HTMLCanvasElement; // 2 cells side by side
    const map = grid(level(), { tw: TW, atlas });
    const ctx = mockCtx();
    map.draw(ctx);
    // Tile 2 at cell (1,1) → atlas cell 1 → source x = 16.
    expect(ctx.drawImage).toHaveBeenCalledWith(atlas, 16, 0, TW, TW, TW, TW, TW, TW);
    // Tile 1 (floor) → atlas cell 0 → source x = 0.
    expect(ctx.drawImage).toHaveBeenCalledWith(atlas, 0, 0, TW, TW, 0, 32, TW, TW);
  });

  it("mutating the level data live is reflected in queries", () => {
    const data = level();
    const map = grid(data, { tw: TW });
    expect(map.solidAt(3 * TW + 8, 8)).toBe(false);
    map.set(3, 0, 1);
    expect(map.solidAt(3 * TW + 8, 8)).toBe(true);
  });
});

describe("Tiles.moveAABB", () => {
  // A room: floor row (y cells 8), left wall (x cell 0) and right wall
  // (x cell 9), over a 10-wide × 9-tall grid of 16px tiles (160×144 world).
  const room = () => {
    const g: number[][] = [];
    for (let cy = 0; cy < 9; cy++) {
      g.push(Array.from({ length: 10 }, (_, cx) => (cy === 8 || cx === 0 || cx === 9 ? 1 : 0)));
    }
    return g;
  };
  const roomMap = () => grid(room(), { tw: TW });

  it("falls and lands exactly on the floor top, reporting bottom contact", () => {
    const map = roomMap();
    const r = { x: 32, y: 100, w: 12, h: 16 }; // bottom at 116, floor top at 128
    const hit = map.moveAABB(r, 0, 40); // would reach 156, past the floor
    expect(hit.bottom).toBe(true);
    expect(hit.rect.y).toBe(128 - 16); // bottom snapped to y=128
    expect(hit.rect.y + hit.rect.h).toBe(128);
    expect(hit.top).toBe(false);
  });

  it("hits a ceiling and reports top contact", () => {
    const map = grid(
      [
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      { tw: TW },
    );
    const r = { x: 20, y: 20, w: 10, h: 10 }; // top at 20, ceiling bottom at 16
    const hit = map.moveAABB(r, 0, -12); // up past y=16
    expect(hit.top).toBe(true);
    expect(hit.rect.y).toBe(16); // top snapped to the ceiling
  });

  it("stops at the left and right walls", () => {
    const left = roomMap();
    const rl = { x: 20, y: 40, w: 12, h: 12 }; // wall (cell 0) right edge at 16
    const hitL = left.moveAABB(rl, -12, 0);
    expect(hitL.left).toBe(true);
    expect(hitL.rect.x).toBe(16);

    const right = roomMap();
    const rr = { x: 130, y: 40, w: 12, h: 12 }; // wall (cell 9) left edge at 144
    const hitR = right.moveAABB(rr, 12, 0);
    expect(hitR.right).toBe(true);
    expect(hitR.rect.x + hitR.rect.w).toBe(144);
  });

  it("resolves X and Y independently so a corner move stops on both faces", () => {
    const map = roomMap();
    // Diagonal dive into the bottom-right corner: right wall @144, floor @128.
    const r = { x: 100, y: 100, w: 16, h: 16 };
    const hit = map.moveAABB(r, 60, 60);
    expect(hit.right).toBe(true); // stopped by the right wall (x cell 9 @ 144)
    expect(hit.bottom).toBe(true); // and by the floor (y cell 8 @ 128)
    expect(hit.rect.x + hit.rect.w).toBe(144);
    expect(hit.rect.y + hit.rect.h).toBe(128);
  });

  it("sweeps a large delta through crossed cells instead of tunneling", () => {
    const map = roomMap();
    const r = { x: 20, y: 40, w: 8, h: 8 };
    // Far more than the room width — must stop at the right wall, not pass it.
    const hit = map.moveAABB(r, 1000, 0);
    expect(hit.right).toBe(true);
    expect(hit.rect.x + hit.rect.w).toBe(144);
  });

  it("does not shove a rect already overlapping a solid (spawn-overlap safe)", () => {
    const map = roomMap();
    // Straddling the right wall (right edge at 152, inside wall cell 9 @144-160).
    // A boundary behind the leading edge is never reverse-snapped, so the body
    // is not teleported and can work itself free.
    const nudge = map.moveAABB({ x: 140, y: 40, w: 12, h: 12 }, 4, 0);
    expect(nudge.rect.x).toBe(144); // kept its relative motion, not yanked back
    // Moving toward open space, it slides out unobstructed.
    const free = map.moveAABB({ x: 140, y: 40, w: 12, h: 12 }, -20, 0);
    expect(free.rect.x).toBe(120);
    expect(free.left).toBe(false);
  });

  it("treats out-of-map space as empty (no walls unless tiled)", () => {
    const map = grid([[0, 0, 0]], { tw: TW });
    const r = { x: 0, y: 0, w: 8, h: 8 };
    const hit = map.moveAABB(r, 500, 500);
    expect(hit.rect.x).toBe(500);
    expect(hit.rect.y).toBe(500);
    expect(hit.right || hit.bottom || hit.left || hit.top).toBe(false);
  });

  it("honors a solid filter (non-solid tiles are passed through)", () => {
    // tile 2 is a hazard that doesn't block; tile 1 does.
    const map = grid(
      [
        [0, 2, 0, 1],
        [0, 0, 0, 0],
      ],
      { tw: TW, solid: () => true }, // map default: everything solid...
    );
    const r = { x: 4, y: 0, w: 8, h: 8 };
    const hit = map.moveAABB(r, 40, 0, { solid: (t) => t === 1 }); // ...override
    expect(hit.right).toBe(true);
    expect(hit.rect.x + hit.rect.w).toBe(3 * TW); // stopped at the tile-1 column, through the 2
  });

  it("one-way platform: blocks a landing from above, passes through from below", () => {
    // Row of tile 3 at cy=2 (top at y=32); empty elsewhere.
    const data = [
      [0, 0, 0],
      [0, 0, 0],
      [3, 3, 3],
    ];
    const oneway = { oneway: (t: number) => t === 3 };

    // Falling onto it from above → lands on top.
    const land = grid(
      data.map((r) => [...r]),
      { tw: TW },
    );
    const falling = { x: 4, y: 20, w: 10, h: 10 }; // bottom 30, platform top 32
    const hit = land.moveAABB(falling, 0, 10, oneway);
    expect(hit.bottom).toBe(true);
    expect(hit.rect.y + hit.rect.h).toBe(32);

    // Rising from below → passes straight through (no top contact).
    const rise = grid(
      data.map((r) => [...r]),
      { tw: TW },
    );
    const jumping = { x: 4, y: 40, w: 10, h: 10 }; // top 40, below the platform
    const up = rise.moveAABB(jumping, 0, -20, oneway);
    expect(up.top).toBe(false);
    expect(up.rect.y).toBe(20); // moved freely through

    // Moving sideways under/into it → not blocked horizontally.
    const side = grid(
      data.map((r) => [...r]),
      { tw: TW },
    );
    const walking = { x: 4, y: 34, w: 10, h: 10 }; // overlapping the platform row
    const across = side.moveAABB(walking, 12, 0, oneway);
    expect(across.right).toBe(false);
    expect(across.rect.x).toBe(16);
  });

  it("reports the delta actually applied", () => {
    const map = roomMap();
    const r = { x: 32, y: 100, w: 12, h: 16 };
    const hit = map.moveAABB(r, 0, 40); // lands at y=112 (from 100)
    expect(hit.dy).toBe(12);
    expect(hit.dx).toBe(0);
  });
});
