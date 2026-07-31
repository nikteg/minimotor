import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type DrawApi } from "@src/engine/index.js";
import { createEcs } from "@src/ecs/index.js";
import { Sprite } from "@src/sprites/index.js";
import type { DrawSprite } from "@src/engine/index.js";

// A fake 2d context recording the calls the Draw primitives make.
function fakeGradient() {
  return { addColorStop: vi.fn() } as unknown as CanvasGradient;
}

let ctx: Record<string, unknown> & { calls: string[] };
let Draw: DrawApi;

beforeEach(() => {
  const origGc = HTMLCanvasElement.prototype.getContext;
  const calls: string[] = [];
  ctx = {
    calls,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    smoothingAtDraw: [] as boolean[],
    fillStyle: "" as string | CanvasGradient,
    strokeStyle: "" as string | CanvasGradient,
    lineWidth: 1,
    setTransform: vi.fn(),
    fillRect: vi.fn(() => calls.push("fillRect")),
    beginPath: vi.fn(),
    closePath: vi.fn(() => calls.push("closePath")),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) =>
      calls.push(`strokeRect ${x},${y} ${w}x${h}`),
    ),
    arc: vi.fn((x: number, y: number, r: number) => calls.push(`arc ${x},${y} r${r}`)),
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
      (ctx.smoothingAtDraw as boolean[]).push(ctx.imageSmoothingEnabled as boolean);
      calls.push(`draw ${dx},${dy} ${dw}x${dh} @${ctx.globalAlpha}`);
    }),
    canvas: null,
  };
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    ctx.canvas = this;
    return ctx as unknown as CanvasRenderingContext2D;
  };
  Draw = createApp(document.createElement("canvas")).Draw;
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

describe("Draw stroke + poly + image primitives", () => {
  it("rectStroke takes positional and structural forms, width defaulting to 1", () => {
    Draw.rectStroke(1, 2, 3, 4, "#0f0", 5);
    expect(ctx.strokeStyle).toBe("#0f0");
    expect(ctx.lineWidth).toBe(5);
    expect(ctx.calls).toContain("strokeRect 1,2 3x4");

    Draw.rectStroke({ x: 10, y: 20, w: 30, h: 40 }, "#00f");
    expect(ctx.strokeStyle).toBe("#00f");
    expect(ctx.lineWidth).toBe(1); // default
    expect(ctx.calls).toContain("strokeRect 10,20 30x40");
  });

  it("circleStroke strokes rather than fills, in both forms", () => {
    Draw.circleStroke(5, 6, 7, "#f0f", 3);
    expect(ctx.strokeStyle).toBe("#f0f");
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.calls).toContain("arc 5,6 r7");
    expect(ctx.calls).toContain("stroke");
    expect(ctx.calls).not.toContain("fill"); // an outline, not a disc

    Draw.circleStroke({ x: 1, y: 2 }, 8, "#fff");
    expect(ctx.calls).toContain("arc 1,2 r8");
    expect(ctx.lineWidth).toBe(1);
  });

  it("poly walks the points and closes the path", () => {
    const pts = [
      { x: 0, y: -10 },
      { x: 8, y: 8 },
      { x: -8, y: 8 },
    ];
    Draw.poly(pts, "#abc");
    expect(ctx.fillStyle).toBe("#abc");
    expect(ctx.moveTo).toHaveBeenCalledWith(0, -10);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 8, 8);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, -8, 8);
    expect(ctx.calls).toContain("closePath");
    expect(ctx.calls).toContain("fill");
  });

  it("poly draws nothing for a degenerate shape", () => {
    Draw.poly(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      "#fff",
    );
    Draw.poly([], "#fff");
    expect(ctx.calls).not.toContain("fill");
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it("image blits at natural size, or scaled when given w/h", () => {
    const img = { width: 40, height: 30 } as HTMLCanvasElement;
    Draw.image(img, 5, 6);
    // Natural-size images use the same pixel-aligned destination path.
    expect(ctx.drawImage).toHaveBeenLastCalledWith(img, 5, 6, 40, 30);

    Draw.image(img, 5, 6, 80, 60);
    expect(ctx.calls).toContain("draw 5,6 80x60 @1");
    expect(ctx.smoothingAtDraw).toEqual([false, false]);
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it("image fills in the intrinsic dimension the caller left out", () => {
    const img = { width: 40, height: 30 } as HTMLCanvasElement;
    Draw.image(img, 0, 0, 80); // width only → natural height
    expect(ctx.calls).toContain("draw 0,0 80x30 @1");
  });

  it("image prefers naturalWidth for a loaded <img>", () => {
    // A DOM-attached <img> can report a layout `width` that isn't its real
    // size; `naturalWidth` is the source of truth.
    const img = {
      naturalWidth: 200,
      naturalHeight: 100,
      width: 16,
      height: 8,
    } as HTMLImageElement;
    Draw.image(img, 0, 0, undefined, 50);
    expect(ctx.calls).toContain("draw 0,0 200x50 @1");
  });

  it("preserves a trimmed sprite's placement in its original frame", () => {
    const image = { width: 32, height: 32 } as HTMLImageElement;
    Draw.sprite(
      {
        sheet: { image },
        rect: {
          sx: 4,
          sy: 5,
          sw: 8,
          sh: 10,
          sourceW: 16,
          sourceH: 20,
          offsetX: 3,
          offsetY: 4,
        },
      },
      { x: 100, y: 50, w: 32, h: 40 },
    );
    expect(ctx.calls).toContain("draw 106,58 16x20 @1");
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
    Draw.sprites([{ x: 10, y: 0, img, px: 0, py: 0 }], { interpolation: 0.5 });
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
    const ecs = createEcs();
    ecs.spawn(Sprite.with({ x: 100, y: 50, img }));
    Draw.sprites(ecs.dense(Sprite));
    expect(ctx.calls).toContain("draw 90,40 20x20 @1");
  });
});
