import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getSprite,
  getLayer,
  clearSpriteCache,
  atlas,
  packAtlas,
  contentBounds,
  tint,
  Sprite,
  interpolate,
} from "../sprites.js";
import { create } from "../ecs/index.js";

beforeEach(() => {
  clearSpriteCache();
  // jsdom's getContext("2d") returns null — patch it
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return null;
    const methods = [
      "scale",
      "translate",
      "drawImage",
      "clearRect",
      "save",
      "restore",
      "beginPath",
      "arc",
      "fill",
      "fillRect",
      "setTransform",
      "createLinearGradient",
      "createRadialGradient",
    ];
    const ctx = Object.create(null);
    for (const m of methods) ctx[m] = vi.fn();
    ctx.canvas = this;
    return ctx as unknown as CanvasRenderingContext2D;
  };
});

describe("Sprites", () => {
  it("creates sprite canvas", () => {
    expect(getSprite("a", 32, 1, () => {})).toBeInstanceOf(HTMLCanvasElement);
  });
  it("caches same key", () => {
    let n = 0;
    const a = getSprite("k", 32, 1, () => {
      n++;
    });
    const b = getSprite("k", 32, 1, () => {
      n++;
    });
    expect(a).toBe(b);
    expect(n).toBe(1);
  });
  it("different keys create different sprites", () => {
    const a = getSprite("a", 32, 1, () => {});
    const b = getSprite("b", 32, 1, () => {});
    expect(a).not.toBe(b);
  });
  it("scales by DPR", () => {
    const s = getSprite("d", 32, 2, () => {});
    expect(s.width).toBe(64);
  });
  it("clearCache forces redraw", () => {
    let n = 0;
    getSprite("k", 32, 1, () => {
      n++;
    });
    clearSpriteCache();
    getSprite("k", 32, 1, () => {
      n++;
    });
    expect(n).toBe(2);
  });
});

describe("Sprites.tint", () => {
  it("returns a same-size silhouette, cached per (source, color)", () => {
    const src = getSprite("tintsrc", 20, 1, () => {});
    const white = tint(src, "#fff");
    expect(white).toBeInstanceOf(HTMLCanvasElement);
    expect(white.width).toBe(src.width);
    expect(white.height).toBe(src.height);
    expect(tint(src, "#fff")).toBe(white); // same (source, color) → cached
    expect(tint(src, "#f00")).not.toBe(white); // different color → new canvas
  });
});

describe("Sprites.getLayer", () => {
  it("bakes a non-square DPR-scaled canvas", () => {
    const layer = getLayer("strip", 200, 12, 2, () => {});
    expect(layer).toBeInstanceOf(HTMLCanvasElement);
    expect(layer.width).toBe(400);
    expect(layer.height).toBe(24);
  });
  it("caches by key and re-bakes on a new key", () => {
    let n = 0;
    const a = getLayer("theme:dark:800", 800, 12, 1, () => n++);
    const b = getLayer("theme:dark:800", 800, 12, 1, () => n++);
    const c = getLayer("theme:dark:900", 900, 12, 1, () => n++);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(n).toBe(2);
  });
  it("clearSpriteCache also clears layers", () => {
    let n = 0;
    getLayer("x", 10, 10, 1, () => n++);
    clearSpriteCache();
    getLayer("x", 10, 10, 1, () => n++);
    expect(n).toBe(2);
  });
});

describe("Sprites.atlas", () => {
  it("sizes the canvas to the cell grid and draws each cell once, in order", () => {
    const seen: number[] = [];
    const sheet = atlas(16, 12, 5, (_ctx, i) => seen.push(i), { cols: 2 });
    expect(sheet.width).toBe(32); // 2 cols × 16
    expect(sheet.height).toBe(36); // ceil(5/2) = 3 rows × 12
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
  it("defaults to a single row", () => {
    const sheet = atlas(10, 10, 4, () => {});
    expect(sheet.width).toBe(40);
    expect(sheet.height).toBe(10);
  });
  it("puts the origin at each cell's top-left by default (save/translate/restore per cell)", () => {
    let ctxRef: Record<string, ReturnType<typeof vi.fn>> | undefined;
    atlas(24, 24, 3, (ctx) => {
      ctxRef = ctx as unknown as Record<string, ReturnType<typeof vi.fn>>;
    });
    expect(ctxRef!.save).toHaveBeenCalledTimes(3);
    expect(ctxRef!.restore).toHaveBeenCalledTimes(3);
    // Cell corners, no centre offset: (0,0), (24,0), (48,0).
    expect(ctxRef!.translate).toHaveBeenNthCalledWith(1, 0, 0);
    expect(ctxRef!.translate).toHaveBeenNthCalledWith(2, 24, 0);
    expect(ctxRef!.translate).toHaveBeenNthCalledWith(3, 48, 0);
  });
  it("centres the context on each cell with origin: 'center'", () => {
    let ctxRef: Record<string, ReturnType<typeof vi.fn>> | undefined;
    atlas(
      20,
      20,
      3,
      (ctx) => {
        ctxRef = ctx as unknown as Record<string, ReturnType<typeof vi.fn>>;
      },
      { origin: "center" },
    );
    // First cell centre = (fw/2, fh/2) = (10, 10).
    expect(ctxRef!.translate).toHaveBeenNthCalledWith(1, 10, 10);
    // Third cell (single row) centre x = 2*20 + 10 = 50.
    expect(ctxRef!.translate).toHaveBeenNthCalledWith(3, 50, 10);
  });
});

describe("Sprites.packAtlas", () => {
  const img = (w: number, h: number) =>
    ({ width: w, height: h }) as unknown as CanvasImageSource & { width: number; height: number };

  it("packs frames into one row, inferring frame size from the first image", () => {
    const sheet = packAtlas([img(24, 32), img(24, 32), img(24, 32)]);
    expect(sheet.width).toBe(72);
    expect(sheet.height).toBe(32);
  });
  it("honours explicit frame size and cols", () => {
    const sheet = packAtlas([img(8, 8), img(8, 8), img(8, 8), img(8, 8)], {
      fw: 8,
      fh: 8,
      cols: 2,
    });
    expect(sheet.width).toBe(16);
    expect(sheet.height).toBe(16);
  });
  it("throws when given no frames", () => {
    expect(() => packAtlas([])).toThrow(/no frames/);
  });
});

describe("Sprites.contentBounds", () => {
  // Install a getContext whose getImageData returns a crafted RGBA buffer.
  function withPixels(w: number, h: number, opaque: Array<[number, number]>) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of opaque) data[(y * w + x) * 4 + 3] = 255;
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        drawImage: vi.fn(),
        getImageData: () => ({ data, width: w, height: h }),
      } as unknown as CanvasRenderingContext2D;
    };
  }

  it("returns the opaque bounding box, trimming transparent padding", () => {
    withPixels(4, 4, [
      [1, 2],
      [2, 2],
      [2, 3],
    ]);
    const box = contentBounds({ width: 4, height: 4 } as HTMLImageElement);
    expect(box).toEqual({ x: 1, y: 2, w: 2, h: 2 });
  });
  it("returns the full rect when nothing clears the threshold", () => {
    withPixels(6, 5, []);
    const box = contentBounds({ width: 6, height: 5 } as HTMLImageElement);
    expect(box).toEqual({ x: 0, y: 0, w: 6, h: 5 });
  });
});

describe("Sprites.Sprite + interpolate (ECS integration)", () => {
  const img = { width: 20, height: 20 } as HTMLCanvasElement;

  it("is just a normal component — the ECS gives it no special treatment", () => {
    const ecs = create();
    ecs.spawn(Sprite.with({ x: 5, y: 6, img }));
    // No interpolate registered → update() does NOT snapshot px/py.
    ecs.update();
    expect(ecs.dense(Sprite)[0].px).toBeUndefined();
  });

  it("interpolate() snapshots px/py BEFORE movement systems run", () => {
    const ecs = create();
    interpolate(ecs); // registered first → runs first
    ecs.system("move", (w) => {
      for (const s of w.dense(Sprite)) s.x += 10;
    });
    ecs.spawn(Sprite.with({ x: 0, y: 0, img }));
    ecs.update(); // snapshot px=0, then move to x=10
    expect(ecs.dense(Sprite)[0]).toMatchObject({ x: 10, px: 0, py: 0 });
  });
});

describe("bounded caches", () => {
  it("getSprite evicts rather than growing without bound", () => {
    // A size derived from an animating value mints a new key every call. The
    // cache must cap instead of piling up offscreen canvases forever.
    const first = getSprite("orb", 10, 1, (g) => g.fillRect(0, 0, 1, 1));
    for (let i = 0; i < 400; i++) {
      getSprite("orb", 10 + i, 1, (g) => g.fillRect(0, 0, 1, 1));
    }
    // The original size was evicted long ago, so it re-bakes to a NEW canvas.
    expect(getSprite("orb", 10, 1, (g) => g.fillRect(0, 0, 1, 1))).not.toBe(first);
    // …while a recently used size is still served from cache.
    const recent = getSprite("orb", 409, 1, (g) => g.fillRect(0, 0, 1, 1));
    expect(getSprite("orb", 409, 1, (g) => g.fillRect(0, 0, 1, 1))).toBe(recent);
  });

  it("tint caches per (source, color) and evicts churned colors", () => {
    const source = document.createElement("canvas");
    source.width = source.height = 4;
    const red = tint(source, "#f00");
    expect(tint(source, "#f00")).toBe(red); // same color → same canvas
    for (let i = 0; i < 40; i++) tint(source, `hsl(${i}, 50%, 50%)`);
    expect(tint(source, "#f00")).not.toBe(red); // evicted, re-baked
  });
});
