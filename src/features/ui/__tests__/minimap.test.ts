import { describe, expect, it, vi } from "vitest";
import { grid } from "../../../tiles/index.js";
import { begin, minimap } from "../api.js";

describe("UI.minimap", () => {
  it("projects semantic tiles, points, and a viewport into one rect", () => {
    const fillRect = vi.fn();
    const strokeRect = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      fillRect,
      strokeRect,
    } as unknown as CanvasRenderingContext2D;
    begin(ctx);
    const level = grid("#R", {
      size: 10,
      legend: { "#": { solid: true }, R: { slope: "up-right" } },
    });

    minimap(level, {
      at: { x: 5, y: 10, w: 100, h: 40 },
      points: [{ x: 5, y: 5, color: "red", size: 4 }],
      view: { x: 0, y: 0, w: 10, h: 10 },
    });

    expect(fillRect).toHaveBeenCalledWith(5, 10, 100, 40);
    expect(fillRect).toHaveBeenCalledWith(5, 10, 50.25, 40.25);
    expect(fillRect).toHaveBeenCalledWith(28, 28, 4, 4);
    expect(strokeRect).toHaveBeenCalledWith(5, 10, 50, 40);
  });
});
