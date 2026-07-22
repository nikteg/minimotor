import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Draw, Stage } from "../index.js";

// A fake 2d context recording the calls the Draw primitives make.
function fakeGradient() {
  return { addColorStop: vi.fn() } as unknown as CanvasGradient;
}

let ctx: Record<string, unknown> & { calls: string[] };

beforeEach(() => {
  const origGc = HTMLCanvasElement.prototype.getContext;
  const calls: string[] = [];
  ctx = {
    calls,
    globalAlpha: 1,
    fillStyle: "" as string | CanvasGradient,
    strokeStyle: "" as string | CanvasGradient,
    lineWidth: 1,
    setTransform: vi.fn(),
    fillRect: vi.fn(() => calls.push("fillRect")),
    beginPath: vi.fn(),
    arc: vi.fn(() => calls.push("arc")),
    fill: vi.fn(() => calls.push("fill")),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => calls.push("stroke")),
    createLinearGradient: vi.fn(() => fakeGradient()),
    createRadialGradient: vi.fn(() => fakeGradient()),
    canvas: null,
  };
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    ctx.canvas = this;
    return ctx as unknown as CanvasRenderingContext2D;
  };
  Stage.init(document.createElement("canvas"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Draw primitives", () => {
  it("rect accepts positional and structural forms with a color", () => {
    Draw.rect(1, 2, 3, 4, "#f00");
    expect(ctx.fillStyle).toBe("#f00");
    Draw.rect({ x: 5, y: 6, w: 7, h: 8 }, "#0f0");
    expect(ctx.fillStyle).toBe("#0f0");
    expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([5, 6, 7, 8]);
  });

  it("linear/radial build a gradient usable as any fill", () => {
    const g = Draw.linear(0, 0, 0, 100, [
      [0, "#0af"],
      [1, "#014"],
    ]);
    expect(ctx.createLinearGradient).toHaveBeenCalledWith(0, 0, 0, 100);
    Draw.rect(0, 0, 10, 10, g); // gradient flows straight into a primitive
    expect(ctx.fillStyle).toBe(g);

    const r = Draw.radial(50, 50, 40, [
      [0, "#fff"],
      [1, "#000"],
    ]); // 3-arg concentric form
    expect(ctx.createRadialGradient).toHaveBeenCalledWith(50, 50, 0, 50, 50, 40);
    Draw.circle(50, 50, 40, r);
    expect(ctx.fillStyle).toBe(r);
  });

  it("opacity multiplies globalAlpha for the block and restores after (nesting)", () => {
    const seen: number[] = [];
    Draw.opacity(0.5, () => {
      seen.push(ctx.globalAlpha as number);
      Draw.opacity(0.5, () => seen.push(ctx.globalAlpha as number)); // nests → 0.25
    });
    expect(seen).toEqual([0.5, 0.25]);
    expect(ctx.globalAlpha).toBe(1); // restored
  });

  it("opacity restores even if the callback throws", () => {
    expect(() =>
      Draw.opacity(0.3, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(ctx.globalAlpha).toBe(1);
  });
});
