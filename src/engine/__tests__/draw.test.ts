import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Draw, Stage } from "../index.js";
import { create } from "../../ecs/index.js";
import { Sprite } from "../../sprites.js";
import type { DrawSprite } from "../index.js";

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
    save: vi.fn(() => calls.push("save")),
    restore: vi.fn(() => calls.push("restore")),
    translate: vi.fn((x: number, y: number) => calls.push(`translate ${x},${y}`)),
    rotate: vi.fn((r: number) => calls.push(`rotate ${r}`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale ${x},${y}`)),
    drawImage: vi.fn((_img: unknown, ...a: number[]) => {
      // Blit → record destination rect (last 4 args) and the current alpha.
      const [dx, dy, dw, dh] = a.slice(-4);
      calls.push(`draw ${dx},${dy} ${dw}x${dh} @${ctx.globalAlpha}`);
    }),
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

describe("Draw.sprites", () => {
  // A blittable image the size inference reads (no logicalSize → uses w/h).
  const img = { width: 20, height: 20 } as unknown as DrawSprite["img"];
  const draws = () => ctx.calls.filter((c) => c.startsWith("draw"));

  it("centers by default and infers size from the image", () => {
    Draw.sprites([{ x: 100, y: 50, img }]);
    // Untransformed fast path: no save/translate, absolute coords.
    // Default anchor 0.5 → 100-10, 50-10; size 20x20; alpha 1.
    expect(ctx.calls).toContain("draw 90,40 20x20 @1");
    expect(ctx.calls.filter((c) => c === "save")).toHaveLength(0);
  });

  it("respects explicit size, anchor and alpha", () => {
    Draw.sprites([{ x: 0, y: 0, img, w: 40, h: 10, ax: 0, ay: 1, alpha: 0.5 }]);
    expect(ctx.calls).toContain("draw 0,-10 40x10 @0.5"); // ax0 → 0, ay1 → -10
  });

  it("draws in ascending z order", () => {
    Draw.sprites([
      { x: 3, y: 0, img, z: 10 },
      { x: 1, y: 0, img, z: -5 },
      { x: 2, y: 0, img, z: 0 },
    ]);
    const order = draws().map((c) => c.split(" ")[1]);
    expect(order).toEqual(["-9,-10", "-8,-10", "-7,-10"]);
  });

  it("skips invisible and fully transparent sprites", () => {
    Draw.sprites([
      { x: 0, y: 0, img, visible: false },
      { x: 0, y: 0, img, alpha: 0 },
    ]);
    expect(draws()).toHaveLength(0);
  });

  it("applies rotation and scale only when non-default", () => {
    Draw.sprites([
      { x: 0, y: 0, img },
      { x: 0, y: 0, img, rot: 1, scale: 2 },
    ]);
    expect(ctx.calls.filter((c) => c.startsWith("rotate"))).toEqual(["rotate 1"]);
    expect(ctx.calls.filter((c) => c.startsWith("scale"))).toEqual(["scale 2,2"]);
  });

  it("flips about the anchor with a negative scale", () => {
    Draw.sprites([{ x: 0, y: 0, img, flipX: true }]);
    expect(ctx.calls).toContain("scale -1,1");
    expect(ctx.calls).toContain("draw -10,-10 20x20 @1"); // anchored offset unchanged
  });

  it("interpolates between the previous and current step positions", () => {
    Draw.sprites([{ x: 10, y: 0, img, px: 0, py: 0 }], { alpha: 0.5 });
    expect(ctx.calls).toContain("draw -5,-10 20x20 @1"); // rendered at x=5
  });

  it("culls sprites outside the view rect", () => {
    Draw.sprites(
      [
        { x: 1000, y: 0, img },
        { x: 10, y: 10, img },
      ],
      { view: { x: 0, y: 0, w: 100, h: 100 } },
    );
    expect(draws()).toHaveLength(1);
  });

  it("renders an ECS Sprite store handed in as ecs.dense(Sprite)", () => {
    const ecs = create();
    ecs.spawn(Sprite.with({ x: 100, y: 50, img }));
    Draw.sprites(ecs.dense(Sprite));
    expect(ctx.calls).toContain("draw 90,40 20x20 @1");
  });
});
