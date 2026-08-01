import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASCII, atlas, glyphs } from "@src/font/index.js";
import type { FontImage } from "@src/font/index.js";

// ---------- a readable fake atlas ----------
// jsdom has no rasteriser, so `alphaMap` would always decline and every font
// would come back monospaced — which is the fallback, not the feature. These
// tests carry their own pixels: the image is a plain object with an alpha
// buffer, and the patched 2D context hands that buffer back from
// `getImageData`. That exercises the real trimming code against art we can
// state exactly.

interface FakeImage {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

/** An `w x h` atlas whose pixel (x, y) is opaque when `ink(x, y)`. */
function image(w: number, h: number, ink: (x: number, y: number) => boolean): FakeImage {
  const alpha = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (ink(x, y)) alpha[(y * w + x) * 4 + 3] = 255;
  }
  return { width: w, height: h, alpha };
}

const asFont = (img: FakeImage) => img as unknown as FontImage;

/** Every blit a render made, as `[source, sx, sy, sw, sh, dx, dy, dw, dh]`. */
let blits: unknown[][] = [];
/** Make `getImageData` throw, standing in for a tainted cross-origin atlas. */
let unreadable = false;

function fakeCtx(): CanvasRenderingContext2D {
  let drawn: FakeImage | undefined;
  const ctx = {
    canvas: undefined,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    drawImage(...args: unknown[]) {
      // 3 args is `alphaMap` sampling the atlas, 5 is `tint` recolouring it,
      // 9 is a glyph landing on screen. Only the last is what tests assert on.
      if (args.length === 3) drawn = args[0] as FakeImage;
      if (args.length === 9) blits.push(args);
    },
    fillRect: vi.fn(),
    getImageData(_x: number, _y: number, w: number, h: number) {
      if (unreadable) throw new Error("tainted canvas");
      return { data: drawn ? drawn.alpha : new Uint8ClampedArray(w * h * 4) };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

// Patched at module load, not just in `beforeEach`: the fonts below are built
// while the describes are being collected, which is before any hook runs.
HTMLCanvasElement.prototype.getContext = function (type: string) {
  return type === "2d" ? fakeCtx() : null;
} as never;

beforeEach(() => {
  blits = [];
  unreadable = false;
});

// A 8x4 sheet of two 4x4 cells:
//   "A" inks x = 1..2   ->  2px wide, 1px in from its cell
//   "B" inks x = 4      ->  1px wide, flush with its cell
const AB = image(8, 4, (x) => x === 1 || x === 2 || x === 4);

describe("Font.atlas", () => {
  it("trims each glyph to its ink, making the font proportional", () => {
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2 });
    expect(font.glyph("A")).toMatchObject({ sx: 1, sy: 0, sw: 2, sh: 4, advance: 2 });
    expect(font.glyph("B")).toMatchObject({ sx: 4, sy: 0, sw: 1, sh: 4, advance: 1 });
    expect(font.measure("AB")).toBe(3);
  });

  it("keeps whole cells when trim is off", () => {
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2, trim: false });
    expect(font.glyph("A")).toMatchObject({ sx: 0, sw: 4, advance: 4 });
    expect(font.glyph("B")).toMatchObject({ sx: 4, sw: 4, advance: 4 });
    expect(font.measure("AB")).toBe(8);
  });

  it("falls back to monospace when the atlas pixels cannot be read", () => {
    // The failure a cross-origin sheet actually produces. A font that quietly
    // became monospaced beats a game that will not boot.
    unreadable = true;
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2 });
    expect(font.measure("AB")).toBe(8);
  });

  it("treats a blank cell as a space", () => {
    // Third cell is empty, which is exactly what a trimmed " " looks like.
    const sheet = image(12, 4, (x) => x === 1 || x === 4);
    const font = atlas(asFont(sheet), { cell: 4, chars: "AB ", cols: 3, space: 3 });
    expect(font.glyph(" ")?.advance).toBe(3);
    expect(font.measure("A B")).toBe(1 + 3 + 1);
  });

  it("defaults the space to a third of the cell", () => {
    const sheet = image(12, 6, (x) => x === 1);
    const font = atlas(asFont(sheet), { cell: 6, chars: "A ", cols: 2 });
    expect(font.glyph(" ")?.advance).toBe(2);
  });

  it("puts tracking between glyphs and not after the last one", () => {
    // The off-by-one that silently shifts every centred label.
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2, tracking: 1 });
    expect(font.measure("A")).toBe(2);
    expect(font.measure("AB")).toBe(2 + 1 + 1);
    expect(font.measure("")).toBe(0);
  });

  it("honours explicit advance overrides", () => {
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2, advances: { B: 5 } });
    expect(font.glyph("B")?.advance).toBe(5);
    expect(font.measure("AB")).toBe(7);
  });

  it("advances past a character it has no glyph for", () => {
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2, space: 3 });
    expect(font.glyph("Z")).toBeUndefined();
    expect(font.measure("AZ")).toBe(2 + 3);
  });

  it("substitutes a fallback glyph when asked", () => {
    const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2, fallback: "B" });
    expect(font.glyph("Z")).toBe(font.glyph("B"));
    expect(font.measure("AZ")).toBe(3);
  });

  it("reads the grid through origin and gap", () => {
    // A sheet with a 1px margin and 1px gutters — the common packed layout.
    const sheet = image(10, 6, (x, y) => y >= 1 && y <= 4 && (x === 2 || x === 7));
    const font = atlas(asFont(sheet), {
      cell: 4,
      chars: "AB",
      cols: 2,
      origin: { x: 1, y: 1 },
      gap: 1,
    });
    expect(font.glyph("A")).toMatchObject({ sx: 2, sy: 1, sw: 1 });
    expect(font.glyph("B")).toMatchObject({ sx: 7, sy: 1, sw: 1 });
  });

  it("infers columns from the atlas width", () => {
    const font = atlas(asFont(AB), { cell: 4, chars: "AB" });
    expect(font.glyph("B")).toMatchObject({ sy: 0 });
  });

  it("stops at the edge rather than reading glyphs from outside the image", () => {
    // `chars` longer than the sheet is a typo in the charset, not a licence to
    // slice past the atlas.
    const font = atlas(asFont(AB), { cell: 4, chars: "ABCD", cols: 2 });
    expect(font.chars).toEqual(["A", "B"]);
  });

  it("rejects a cell that cannot fit at all", () => {
    expect(() => atlas(asFont(AB), { cell: 40, chars: "A" })).toThrow(/no glyph fits/);
    expect(() => atlas(asFont(AB), { cell: 0, chars: "A" })).toThrow(/positive size/);
  });

  it("defaults its charset to printable ASCII", () => {
    expect(ASCII).toHaveLength(95);
    expect(ASCII[0]).toBe(" ");
    expect(ASCII.at(-1)).toBe("~");
  });
});

describe("Font.glyphs", () => {
  it("takes arbitrary rects", () => {
    const font = glyphs(asFont(AB), { glyphs: { A: [0, 0, 3, 4], B: [4, 0, 2, 4] } });
    expect(font.measure("AB")).toBe(5);
    expect(font.size).toBe(4);
  });

  it("takes a full glyph when advance or offset must differ from the rect", () => {
    const font = glyphs(asFont(AB), {
      glyphs: { A: { sx: 0, sy: 0, sw: 3, sh: 4, advance: 6, ox: 1, oy: -1 } },
    });
    expect(font.measure("A")).toBe(6);
    expect(font.glyph("A")).toMatchObject({ ox: 1, oy: -1 });
  });

  it("requires at least one glyph", () => {
    expect(() => glyphs(asFont(AB), { glyphs: {} })).toThrow(/at least one glyph/);
  });
});

describe("measuring blocks and wrapping", () => {
  const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2 });

  it("measures the widest line and the full height", () => {
    expect(font.measureBlock("A\nAB")).toEqual({ w: 3, h: 8 });
  });

  it("wraps to a pixel width", () => {
    // Each "A" is 2px and each space 1px, so 5px fits "A A" and not "A A A".
    expect(font.wrap("A A A", 5)).toEqual(["A A", "A"]);
  });

  it("gives a word wider than the limit its own line", () => {
    expect(font.wrap("AAAA B", 3)).toEqual(["AAAA", "B"]);
  });

  it("keeps hard newlines while wrapping", () => {
    expect(font.wrap("A\nB", 100)).toEqual(["A", "B"]);
  });
});

describe("rendering", () => {
  const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2 });
  const dest = (i: number) => ({ x: blits[i][5], y: blits[i][6], w: blits[i][7], h: blits[i][8] });

  it("walks the pen by each glyph's advance", () => {
    font.render(fakeCtx(), "AB", 10, 20);
    expect(blits).toHaveLength(2);
    expect(blits[0].slice(1, 5)).toEqual([1, 0, 2, 4]);
    expect(dest(0)).toEqual({ x: 10, y: 20, w: 2, h: 4 });
    expect(dest(1)).toEqual({ x: 12, y: 20, w: 1, h: 4 });
  });

  it("scales source rects into destination size", () => {
    font.render(fakeCtx(), "AB", 0, 0, { scale: 3 });
    expect(dest(0)).toEqual({ x: 0, y: 0, w: 6, h: 12 });
    expect(dest(1)).toEqual({ x: 6, y: 0, w: 3, h: 12 });
  });

  it("aligns a line horizontally around x", () => {
    font.render(fakeCtx(), "AB", 100, 0, { align: "center" });
    expect(dest(0).x).toBe(100 - 3 / 2);
    blits = [];
    font.render(fakeCtx(), "AB", 100, 0, { align: "right" });
    expect(dest(0).x).toBe(97);
  });

  it("anchors a multi-line block vertically", () => {
    font.render(fakeCtx(), "A\nA", 0, 100, { baseline: "middle" });
    // Two 4px lines: the block is 8 tall, so it starts 4 above the anchor.
    expect(dest(0).y).toBe(96);
    expect(dest(1).y).toBe(100);
  });

  it("aligns each line of a block independently", () => {
    font.render(fakeCtx(), "A\nAB", 100, 0, { align: "right" });
    expect(dest(0).x).toBe(98);
    expect(dest(1).x).toBe(97);
  });

  it("skips a glyph with no ink but still advances", () => {
    const sheet = image(12, 4, (x) => x === 1 || x === 4);
    const spaced = atlas(asFont(sheet), { cell: 4, chars: "AB ", cols: 3, space: 3 });
    blits = [];
    spaced.render(fakeCtx(), "A B", 0, 0);
    expect(blits).toHaveLength(2);
    expect(dest(1).x).toBe(1 + 3);
  });

  it("draws nothing for an unknown character but keeps the pen moving", () => {
    font.render(fakeCtx(), "AZB", 0, 0, { tracking: 0 });
    expect(blits).toHaveLength(2);
    // "A" is 2, the unknown "Z" advances by the default space (4/3 -> 1).
    expect(dest(1).x).toBe(3);
  });

  it("tints from a recoloured copy rather than the original atlas", () => {
    font.render(fakeCtx(), "A", 0, 0, { color: "#f00" });
    expect(blits.at(-1)![0]).not.toBe(AB);
  });

  it("draws the atlas itself when no colour is given", () => {
    font.render(fakeCtx(), "A", 0, 0);
    expect(blits.at(-1)![0]).toBe(AB);
  });
});

describe("outline and shadow", () => {
  const font = atlas(asFont(AB), { cell: 4, chars: "AB", cols: 2 });
  const dest = (i: number) => ({ x: blits[i][5] as number, y: blits[i][6] as number });

  it("haloes a glyph on all eight neighbours", () => {
    font.render(fakeCtx(), "A", 10, 10, { outline: "#000" });
    expect(blits).toHaveLength(9);
    const around = blits.slice(0, 8).map((b) => `${b[5]},${b[6]}`);
    expect(new Set(around).size).toBe(8);
    // The fill lands last, dead centre, so the halo cannot paint over it.
    expect(dest(8)).toEqual({ x: 10, y: 10 });
  });

  it("uses four offsets for a cross outline", () => {
    font.render(fakeCtx(), "A", 10, 10, { outline: "#000", outlineStyle: "cross" });
    expect(blits).toHaveLength(5);
    expect(
      blits
        .slice(0, 4)
        .map((b) => `${b[5]},${b[6]}`)
        .sort(),
    ).toEqual(["10,11", "10,9", "11,10", "9,10"]);
  });

  it("measures the outline in FONT pixels, so it scales with the glyphs", () => {
    // A hairline outline on a 4x font would vanish; this is the whole reason
    // the offset is multiplied by scale rather than used raw.
    font.render(fakeCtx(), "A", 100, 100, { outline: "#000", outlineWidth: 2, scale: 3 });
    const xs = blits.slice(0, 8).map((b) => b[5] as number);
    expect(Math.min(...xs)).toBe(100 - 6);
    expect(Math.max(...xs)).toBe(100 + 6);
  });

  it("does not change how wide the text measures", () => {
    // The outline grows outward from glyphs that were already placed, so
    // layout code can keep trusting `measure`.
    const plain = font.measure("AB");
    font.render(fakeCtx(), "AB", 0, 0, { outline: "#000" });
    const fill = blits.slice(-2);
    expect((fill[1][5] as number) + (fill[1][7] as number)).toBe(plain);
  });

  it("offsets a shadow and draws it behind everything", () => {
    font.render(fakeCtx(), "A", 10, 10, { shadow: { x: 1, y: 2 }, scale: 2 });
    expect(blits).toHaveLength(2);
    expect(dest(0)).toEqual({ x: 12, y: 14 });
    expect(dest(1)).toEqual({ x: 10, y: 10 });
  });

  it("stacks shadow, outline and fill in that order", () => {
    font.render(fakeCtx(), "A", 0, 0, { shadow: { x: 2, y: 2 }, outline: "#000", color: "#fff" });
    expect(blits).toHaveLength(1 + 8 + 1);
    expect(dest(0)).toEqual({ x: 2, y: 2 });
    expect(dest(9)).toEqual({ x: 0, y: 0 });
  });

  it("tints the shadow separately from the outline when asked", () => {
    font.render(fakeCtx(), "A", 0, 0, { shadow: { x: 1, y: 1 }, shadowColor: "#123" });
    expect(blits[0][0]).not.toBe(AB);
  });
});
