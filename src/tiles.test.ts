import { describe, it, expect, vi } from "vitest";
import { grid } from "./tiles.js";

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
