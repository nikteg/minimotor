import { describe, expect, it } from "vitest";
import {
  analyzeRegion,
  bandPeriod,
  compose,
  deriveInsets,
  longestPeriodicRun,
  overlaps,
  phaseBreaks,
  sliceIds,
  type Insets,
  type Rect,
} from "../analyze.js";
import { decodePng, encodePng, type Pixels } from "../png.js";
import { analyzeAutotile, analyzeTileFrame, sockets } from "../tiles.js";
import { adjacencyFindings, inferAdjacency, toTileModel } from "../adjacency.js";

/** Paint an image from a character map, one character per pixel. */
function paint(rows: string[], palette: Record<string, [number, number, number, number]>): Pixels {
  const width = rows[0].length;
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((glyph, x) => {
      const colour = palette[glyph] ?? [0, 0, 0, 0];
      data.set(colour, (y * width + x) * 4);
    });
  });
  return { width, height, data };
}

const PALETTE: Record<string, [number, number, number, number]> = {
  ".": [0, 0, 0, 0],
  "#": [255, 255, 255, 255],
  o: [128, 128, 128, 255],
  x: [255, 0, 0, 255],
};

const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code);

/** A frame whose edges repeat with period 2 (`#o#o…`) and whose corners are a
 *  distinct 2px `xx`. Every axis measurement in these tests is a fact about
 *  this picture, not about any particular atlas on disk.
 *
 *  `centre` is the width of the repeating band. An even one divides the period
 *  and tiles cleanly; an odd one does not, which is the slit these checks exist
 *  to find. */
const striped = (centre: number): Pixels => {
  const edge = "#o".repeat(centre).slice(0, centre);
  const width = centre + 4;
  return paint(
    [
      `xx${edge}xx`,
      `xx${edge}xx`,
      ...Array.from({ length: centre }, () => `#${"o".repeat(width - 2)}#`),
      `xx${edge}xx`,
      `xx${edge}xx`,
    ],
    PALETTE,
  );
};

const INSETS: Insets = { left: 2, top: 2, right: 2, bottom: 2 };
const rectOf = (image: Pixels): Rect => ({ sx: 0, sy: 0, sw: image.width, sh: image.height });

describe("png", () => {
  it("round-trips pixels through encode and decode", () => {
    const image = paint(["#o.", ".x#"], PALETTE);
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...image.data]);
  });

  it("rejects a file that is not a PNG", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
  });
});

describe("slice interning", () => {
  it("gives identical columns the same id and distinct columns different ones", () => {
    const image = paint(["#o#", "#o#"], PALETTE);
    expect(sliceIds(image, rectOf(image), "x")).toEqual([0, 1, 0]);
  });

  it("treats transparent pixels as equal whatever RGB they carry", () => {
    const image: Pixels = {
      width: 2,
      height: 1,
      data: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 0]),
    };
    expect(sliceIds(image, rectOf(image), "x")).toEqual([0, 0]);
  });
});

describe("period detection", () => {
  it("finds the smallest genuine period", () => {
    expect(bandPeriod([0, 1, 0, 1, 0, 1], 0, 6)).toBe(2);
    expect(bandPeriod([5, 5, 5, 5], 0, 4)).toBe(1);
  });

  it("refuses a period the band cannot show twice", () => {
    // ids[14] and ids[15] happen to match ids[0] and ids[1]; that is two
    // comparisons, not evidence of a 14px repeat. Reported as aperiodic.
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1];
    expect(bandPeriod(ids, 0, 16)).toBe(16);
  });

  it("ignores a long repeat that does not span the middle of the axis", () => {
    // A flat run down one end only. The centre band of a nine-slice is the
    // middle of the frame, so this must not be proposed as one.
    const ids = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(longestPeriodicRun(ids)).toBeUndefined();
  });
});

describe("inset derivation", () => {
  it("recovers the insets a striped frame was built with", () => {
    const image = striped(8);
    expect(deriveInsets(image, rectOf(image))).toEqual(INSETS);
  });
});

describe("analyzeRegion", () => {
  it("passes a frame whose centre band is a whole number of periods", () => {
    const image = striped(8);
    const report = analyzeRegion(image, { name: "ok", rect: rectOf(image), insets: INSETS });
    expect(report.x.period).toBe(2);
    expect(report.x.periodic).toBe(true);
    expect(codes(report.findings)).toEqual([]);
  });

  it("reports a phase break, and the inset that fixes it, when it is not", () => {
    // Nine columns of a 2px repeat: every tile after the first lands half a
    // period along and the pattern jumps.
    const image = striped(9);
    const report = analyzeRegion(image, { name: "slit", rect: rectOf(image), insets: INSETS });
    expect(report.x.period).toBe(2);
    const breakFinding = report.findings.find((finding) => finding.code === "phase-break");
    expect(breakFinding?.fix).toBe("right: 2 → 3 (centre 9 → 8, a multiple of 2)");
  });

  it("reports insets that leave no centre band at all", () => {
    const image = striped(8);
    const insets = { left: 6, top: 6, right: 6, bottom: 6 };
    const report = analyzeRegion(image, { name: "hang", rect: rectOf(image), insets });
    expect(codes(report.findings)).toContain("no-center");
  });

  it("reports a rect that leaves the atlas", () => {
    const image = striped(8);
    const report = analyzeRegion(image, {
      name: "outside",
      rect: { sx: 0, sy: 0, sw: 200, sh: 200 },
      insets: INSETS,
    });
    expect(codes(report.findings)).toContain("out-of-bounds");
  });

  it("reports a rect padded with empty pixels, and where the art really is", () => {
    const image = striped(8);
    const padded: Pixels = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
    for (let y = 0; y < image.height; y++) {
      padded.data.set(
        image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
        ((y + 2) * 16 + 2) * 4,
      );
    }
    const report = analyzeRegion(padded, {
      name: "padded",
      rect: { sx: 0, sy: 0, sw: 16, sh: 16 },
      insets: INSETS,
    });
    const margin = report.findings.find((finding) => finding.code === "transparent-margin");
    expect(margin?.fix).toBe("rect: 2,2 12×12");
  });

  it("reports a rect pointing at blank atlas space", () => {
    const empty: Pixels = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
    const report = analyzeRegion(empty, {
      name: "blank",
      rect: rectOf(empty),
      insets: { left: 1, top: 1, right: 1, bottom: 1 },
    });
    expect(codes(report.findings)).toContain("empty");
  });
});

describe("overlaps", () => {
  const at = (name: string, rect: Rect) => ({ name, rect });

  it("warns only when two frames share pixels by halves", () => {
    const partial = overlaps([
      at("a", { sx: 0, sy: 0, sw: 10, sh: 10 }),
      at("b", { sx: 5, sy: 5, sw: 10, sh: 10 }),
    ]);
    expect(partial.map((finding) => [finding.level, finding.code])).toEqual([
      ["warning", "overlap"],
    ]);
  });

  it("treats a shared or nested rect as the deliberate alias it usually is", () => {
    const alias = overlaps([
      at("a", { sx: 0, sy: 0, sw: 10, sh: 10 }),
      at("b", { sx: 0, sy: 0, sw: 10, sh: 10 }),
      at("c", { sx: 0, sy: 0, sw: 10, sh: 4 }),
    ]);
    expect(alias.every((finding) => finding.level === "info")).toBe(true);
    expect(codes(alias)).toEqual(["alias", "nested", "nested"]);
  });
});

describe("compose", () => {
  it("reproduces the source exactly at its own size", () => {
    const image = striped(8);
    const out = compose(image, rectOf(image), INSETS, image.width, image.height);
    expect([...out.data]).toEqual([...image.data]);
  });

  it("scales the whole frame below its minimum size, rather than overlapping corners", () => {
    const image = striped(8);
    const out = compose(image, rectOf(image), INSETS, 3, 3);
    expect(out.width).toBe(3);
    expect(out.data.some((byte) => byte !== 0)).toBe(true);
  });

  it("keeps a well-formed frame in phase at any width", () => {
    const image = striped(8);
    expect(phaseBreaks(image, rectOf(image), INSETS, { w: 61, h: 37 })).toEqual({
      top: [],
      left: [],
    });
  });

  it("names the exact columns where a bad inset breaks the pattern", () => {
    // Centre 9 against period 2: the second tile starts out of phase, and the
    // first column that proves it is the one right after the first wrap.
    const breaks = phaseBreaks(striped(9), { sx: 0, sy: 0, sw: 13, sh: 13 }, INSETS, {
      w: 40,
      h: 20,
    });
    expect(breaks.top.length).toBeGreaterThan(0);
    expect(breaks.top[0]).toBe(11);
  });
});

describe("tile frames", () => {
  const grid = { x: 0, y: 0, tile: { w: 4, h: 4 } };

  /** A 12×12 outlined panel cut into nine 4×4 tiles: a 1px border round the
   *  outside, flat fill within. Every repeating cell is uniform along the
   *  direction it repeats in, so the frame is seamless by construction rather
   *  than by eye — which is what makes it a fair baseline. */
  const outlined = (): Pixels =>
    paint(
      Array.from({ length: 12 }, (_, y) =>
        Array.from({ length: 12 }, (_, x) =>
          x === 0 || y === 0 || x === 11 || y === 11 ? "#" : "o",
        ).join(""),
      ),
      PALETTE,
    );

  it("accepts nine tiles that meet and tile against themselves", () => {
    const findings = analyzeTileFrame(outlined(), grid).filter(
      (finding) => finding.level !== "info",
    );
    expect(findings).toEqual([]);
  });

  it("catches a top edge tile that cannot meet itself", () => {
    // A steep ramp along the top edge tile. Its internal steps are gentle, so
    // butting its bright end against its dark start is a jump far sharper than
    // anything inside the tile — a seam every 4px along the top of the frame.
    const ramp = outlined();
    [4, 24, 44, 250].forEach((level, index) => {
      ramp.data.set([level, level, level, 255], (4 + index) * 4);
    });
    expect(codes(analyzeTileFrame(ramp, grid))).toContain("unwrapped-band");
  });

  it("assembles the frame from the cells it is given, not the grid origin", () => {
    // The good frame at columns 0–2, a spoiled copy at columns 3–5. Pointing
    // the top edge at the spoiled sheet has to change the verdict; pointing it
    // back at the good one has to restore it.
    const wide = paint(
      Array.from({ length: 12 }, (_, y) =>
        Array.from({ length: 24 }, (_, x) => {
          const local = x % 12;
          return local === 0 || y === 0 || local === 11 || y === 11 ? "#" : "o";
        }).join(""),
      ),
      PALETTE,
    );
    [4, 24, 44, 250].forEach((level, index) => {
      wide.data.set([level, level, level, 255], (16 + index) * 4);
    });
    const from = (topEdgeColumn: number) =>
      [
        [
          [0, 0],
          [topEdgeColumn, 0],
          [2, 0],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [
          [0, 2],
          [1, 2],
          [2, 2],
        ],
      ] as const;
    expect(codes(analyzeTileFrame(wide, grid, from(4)))).toContain("unwrapped-band");
    expect(codes(analyzeTileFrame(wide, grid, from(1)))).not.toContain("unwrapped-band");
  });

  it("rejects a grid that runs off the atlas", () => {
    const findings = analyzeTileFrame(outlined(), { x: 0, y: 0, tile: { w: 64, h: 64 } });
    expect(codes(findings)).toEqual(["grid-out-of-bounds"]);
  });

  it("reads the four edge sockets of a tile", () => {
    const image = paint(["#ox", "oox", "###"], PALETTE);
    const edge = sockets(image, { sx: 0, sy: 0, sw: 3, sh: 3 });
    expect(edge.north).not.toBe(edge.south);
    expect(edge.west).not.toBe(edge.east);
  });
});

describe("autotile sets", () => {
  const grid = { x: 0, y: 0, tile: { w: 2, h: 2 } };
  // Two tiles side by side. Both claim to be open to the north, but the second
  // presents a different north edge — the defect that makes a blob set show a
  // seam only at certain neighbour combinations.
  const sheet = paint(["####", "#..o", "....", "...."], PALETTE);

  it("catches two tiles that claim the same edge state but do not present it", () => {
    const findings = analyzeAutotile(sheet, grid, [
      { mask: 1, column: 0, row: 0 },
      { mask: 1, column: 1, row: 0 },
    ]);
    expect(codes(findings)).toContain("socket-mismatch");
  });

  it("reports masks the set never answers", () => {
    const findings = analyzeAutotile(sheet, grid, [{ mask: 1, column: 0, row: 0 }]);
    expect(findings.filter((finding) => finding.code === "missing-mask")).toHaveLength(15);
  });

  it("reports two tiles answering the same mask", () => {
    const findings = analyzeAutotile(sheet, grid, [
      { mask: 3, column: 0, row: 0 },
      { mask: 3, column: 1, row: 0 },
    ]);
    expect(codes(findings)).toContain("duplicate-mask");
  });
});

describe("socket inference", () => {
  const grid = { x: 0, y: 0, tile: { w: 2, h: 2 } };

  /** Four 2×2 tiles in a row: three that present the same flat edges, and one
   *  whose east edge nothing answers. */
  const sheet = paint(["oooo##oo", "oooo##oo"], PALETTE);

  it("skips fully transparent cells rather than counting them as tiles", () => {
    const withGap = paint(["oo..oo", "oo..oo"], PALETTE);
    expect(inferAdjacency(withGap, grid, { cols: 3, rows: 1 }).nodes).toHaveLength(2);
  });

  it("derives the socket alphabet from the art with nothing declared", () => {
    const graph = inferAdjacency(sheet, grid, { cols: 4, rows: 1 });
    expect(graph.nodes).toHaveLength(4);
    // Three flat tiles share one west/east socket; the `##` tile presents its own.
    expect(graph.alphabet.west).toBe(2);
    expect(graph.alphabet.east).toBe(2);
  });

  it("allows two tiles to abut exactly when their facing edges agree", () => {
    const graph = inferAdjacency(sheet, grid, { cols: 4, rows: 1 });
    const n = graph.nodes.length;
    const right = (a: number, b: number) => graph.allowed[(1 * n + a) * n + b] === 1;
    expect(right(0, 1)).toBe(true); // flat → flat
    expect(right(0, 2)).toBe(false); // flat → the `##` tile
  });

  it("names a tile no other tile may sit beside", () => {
    // Two 2×1 tiles. The first ends on `x`, and no tile in the sheet begins on
    // one — so nothing may ever be placed to its right.
    const findings = adjacencyFindings(
      inferAdjacency(
        paint(["oxoo"], PALETTE),
        { x: 0, y: 0, tile: { w: 2, h: 1 } },
        { cols: 2, rows: 1 },
      ),
    );
    const dead = findings.find((finding) => finding.code === "dead-side");
    expect(dead?.message).toContain("0,0");
  });

  it("says so when the sheet is too detailed for exact socket matching", () => {
    // Twenty tiles, every edge a colour no other tile uses. Nothing matches
    // anything, which is a statement about the method, not about the art.
    const tiles = 20;
    const width = tiles * 2;
    const noisy: Pixels = { width, height: 2, data: new Uint8Array(width * 2 * 4) };
    for (let index = 0; index < tiles; index++) {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          const level = index * 10 + y * 5 + x * 2 + 1;
          noisy.data.set([level, level, level, 255], (y * width + index * 2 + x) * 4);
        }
      }
    }
    const findings = adjacencyFindings(inferAdjacency(noisy, grid, { cols: tiles, rows: 1 }));
    expect(codes(findings)).toContain("sparse-adjacency");
    // The dead-side reports it emits alongside must not claim to be defects.
    expect(findings.every((finding) => finding.level === "info")).toBe(true);
  });

  it("hands the inferred relation over in TileModel shape", () => {
    const graph = inferAdjacency(sheet, grid, { cols: 4, rows: 1 });
    const model = toTileModel(graph);
    expect(model.tiles).toHaveLength(4);
    expect(new Set(model.tiles).size).toBe(4);
    expect(model.allowed).toBe(graph.allowed);
  });
});

describe("centre-too-wide evidence bar", () => {
  it("does not call a symmetric band corner detail on a two-slice midpoint run", () => {
    // A 32×32 frame whose centre band is a symmetric ramp. Its only repeat is
    // the pair of identical slices at the exact middle; that is not grounds to
    // accuse the other fourteen, and the "fix" would leave no centre band.
    const ramp = (index: number) => 20 + Math.min(index, 31 - index) * 12;
    const image: Pixels = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const level = Math.min(ramp(x), ramp(y));
        image.data.set([level, level, level, 255], (y * 32 + x) * 4);
      }
    }
    const report = analyzeRegion(image, {
      name: "symmetric",
      rect: rectOf(image),
      insets: { left: 8, top: 8, right: 8, bottom: 8 },
    });
    expect(codes(report.findings)).not.toContain("centre-too-wide");
  });

  it("still reports surplus the repeating unit is big enough to judge", () => {
    // The shape of the real Kenney button defect: a centre band of eight rows
    // made of a four-row flat run plus four rows of border colour dragged in by
    // too small an inset. Run and surplus are the same size, so the call stands.
    const image = paint(
      ["#", "#", "o", "o", "o", "x", "x", "x", "x", "o", "#", "#"].map((glyph) => glyph.repeat(12)),
      PALETTE,
    );
    const report = analyzeRegion(image, {
      name: "surplus",
      rect: { sx: 0, sy: 0, sw: 12, sh: 12 },
      insets: { left: 2, top: 2, right: 2, bottom: 2 },
    });
    const finding = report.findings.find((entry) => entry.code === "centre-too-wide");
    expect(finding?.fix).toBe("top: 2 → 5, bottom: 2 → 3");
  });
});

describe("suggested fixes", () => {
  it("never proposes insets that would tile the centre out of phase", () => {
    // A frame whose repeating unit is 22 slices of a 9px pattern. Snapping the
    // centre to the unit's bounds would leave 22px against a 9px period — a
    // phase break. The suggestion has to land on a multiple.
    const unit = "AAAAAAEAAAAAAAAEAAAAAA";
    const rows = [
      `xxx${unit}xxx`,
      ...Array.from({ length: 6 }, () => `#${"o".repeat(26)}#`),
      `xxx${unit}xxx`,
    ];
    const image = paint(rows, { ...PALETTE, A: PALETTE.o, E: PALETTE["#"] });
    const insets = { left: 1, top: 1, right: 1, bottom: 1 };
    const before = analyzeRegion(image, { name: "bar", rect: rectOf(image), insets });
    const suggestion = before.findings.find((finding) => finding.code === "centre-too-wide");
    expect(suggestion).toBeDefined();

    // Apply exactly what it proposed, then re-check: no errors may appear.
    const applied = { ...insets };
    for (const part of suggestion!.fix!.split(", ")) {
      const [side, change] = part.split(": ");
      applied[side.trim() as keyof Insets] = Number(change.split("→")[1].trim());
    }
    const after = analyzeRegion(image, { name: "bar", rect: rectOf(image), insets: applied });
    expect(after.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});
