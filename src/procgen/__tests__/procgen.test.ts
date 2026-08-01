// Module-local procgen tests. Every generator is seeded and pure, so the
// assertions here are exact rather than statistical wherever possible.
import { describe, expect, it } from "vitest";
import {
  analyze,
  branchesBefore,
  glyphWeights,
  corridorRatio,
  deadEnds,
  frequencies,
  illuminate,
  longestPath,
  measure,
  openness,
  pathLength,
  ramp,
  reachableFraction,
  steer,
  symmetry,
  asGrid,
  caves,
  chunks,
  cloneGrid,
  cols,
  defineModel,
  dungeon,
  fromText,
  isConnected,
  makeGrid,
  OUTSIDE,
  overlapping,
  regions,
  repair,
  resynthesize,
  rooms,
  rows,
  synthesize,
  toText,
  topology,
} from "@src/procgen/index.js";
import { grid as tileGrid } from "@src/tiles/index.js";

const SAMPLE = `
#####
#...#
#.#.#
#...#
#####
`;

describe("Procgen char grids", () => {
  it("round-trips text and pads short rows", () => {
    const grid = fromText("##\n#\n##");
    expect(grid).toEqual([
      ["#", "#"],
      ["#", "."],
      ["#", "#"],
    ]);
    expect(toText(grid)).toBe("##\n#.\n##");
  });

  it("makeGrid rejects a non-positive size and cloneGrid detaches", () => {
    expect(() => makeGrid(0, 4)).toThrow(/positive integers/);
    const original = makeGrid(2, 2, "#");
    const copy = cloneGrid(original);
    copy[0][0] = ".";
    expect(original[0][0]).toBe("#");
  });

  it("asGrid copies rather than aliasing its input", () => {
    const source = makeGrid(2, 2, "#");
    const taken = asGrid(source);
    taken[0][0] = ".";
    expect(source[0][0]).toBe("#");
  });
});

describe("Procgen.analyze", () => {
  it("counts glyphs and learns adjacency in both directions", () => {
    const model = analyze(SAMPLE);
    expect(model.tiles).toEqual(["#", "."]);
    expect(model.weights).toEqual([17, 8]);
    expect(model.edge).toBeUndefined();

    const T = model.tiles.length;
    const allowed = (dir: number, a: number, b: number) => model.allowed[(dir * T + a) * T + b];
    // "." sits right of "#" in the sample, so "#" also sits left of ".".
    expect(allowed(1, 0, 1)).toBe(1);
    expect(allowed(3, 1, 0)).toBe(1);
  });

  it("learns which glyphs may touch the outside, so levels wall themselves in", () => {
    const model = analyze(SAMPLE, { edge: true });
    expect(model.edge).toBe(true);
    // The sample is ringed with "#", so only "#" may touch the border — and the
    // OUTSIDE sentinel is never placed inside the grid.
    const out = synthesize(model, { cols: 9, rows: 7, seed: 3 });
    expect(out.flat()).not.toContain(OUTSIDE);
    for (let x = 0; x < 9; x++) {
      expect(out[0][x]).toBe("#");
      expect(out[6][x]).toBe("#");
    }
    for (let y = 0; y < 7; y++) {
      expect(out[y][0]).toBe("#");
      expect(out[y][8]).toBe("#");
    }
  });

  it("rejects an empty sample", () => {
    expect(() => analyze("")).toThrow(/empty/);
  });
});

describe("Procgen.synthesize", () => {
  it("is deterministic for a seed and varies across seeds", () => {
    const model = analyze(SAMPLE, { edge: true });
    const a = synthesize(model, { cols: 12, rows: 9, seed: 1 });
    const b = synthesize(model, { cols: 12, rows: 9, seed: 1 });
    const c = synthesize(model, { cols: 12, rows: 9, seed: 2 });
    expect(toText(a)).toBe(toText(b));
    expect(toText(a)).not.toBe(toText(c));
  });

  it("never emits an adjacency the sample did not contain", () => {
    // In this sample a "." is never directly above another "." ... except it
    // is, so assert the rule that DOES hold: no glyph outside the alphabet,
    // and every horizontal/vertical pair is one the model allows.
    const model = analyze(SAMPLE, { edge: true });
    const T = model.tiles.length;
    const index = new Map(model.tiles.map((glyph, i) => [glyph, i]));
    const out = synthesize(model, { cols: 16, rows: 12, seed: 9 });
    for (let y = 0; y < rows(out); y++) {
      for (let x = 0; x < cols(out); x++) {
        const a = index.get(out[y][x]);
        expect(a).toBeDefined();
        if (x + 1 < cols(out)) {
          const b = index.get(out[y][x + 1]) as number;
          expect(model.allowed[(1 * T + (a as number)) * T + b]).toBe(1);
        }
        if (y + 1 < rows(out)) {
          const b = index.get(out[y + 1][x]) as number;
          expect(model.allowed[(2 * T + (a as number)) * T + b]).toBe(1);
        }
      }
    }
  });

  it("honours fixed cells", () => {
    const model = analyze(SAMPLE, { edge: true });
    const out = synthesize(model, {
      cols: 11,
      rows: 9,
      seed: 4,
      fixed: [
        [5, 4, "."],
        [5, 5, "."],
      ],
    });
    expect(out[4][5]).toBe(".");
    expect(out[5][5]).toBe(".");
  });

  it("treats a zero per-cell weight as a ban", () => {
    const model = analyze(SAMPLE, { edge: true });
    const T = model.tiles.length;
    const floor = model.tiles.indexOf(".");
    const weights = new Float32Array(11 * 9 * T).fill(1);
    // Forbid floor everywhere except one row, so that row is the only opening.
    for (let y = 0; y < 9; y++) {
      if (y === 4) continue;
      for (let x = 0; x < 11; x++) weights[(y * 11 + x) * T + floor] = 0;
    }
    const out = synthesize(model, { cols: 11, rows: 9, seed: 6, weights });
    for (let y = 0; y < 9; y++) {
      if (y === 4) continue;
      expect(out[y].every((glyph) => glyph === "#")).toBe(true);
    }
  });

  it("validates its inputs", () => {
    const model = analyze(SAMPLE, { edge: true });
    expect(() => synthesize(model, { cols: 0, rows: 4 })).toThrow(/positive integers/);
    expect(() => synthesize(model, { cols: 4, rows: 4, weights: new Float32Array(3) })).toThrow(
      /weights must hold/,
    );
    expect(() => synthesize(model, { cols: 4, rows: 4, fixed: [[9, 9, "."]] })).toThrow(
      /outside the grid/,
    );
    expect(() => synthesize(model, { cols: 4, rows: 4, fixed: [[1, 1, "?"]] })).toThrow(
      /not in the model/,
    );
  });

  it("throws a useful message when a model cannot tile the space", () => {
    // "a" may only sit left of "b" and nothing may follow "b" — a 4-wide row is
    // impossible.
    const model = defineModel({
      tiles: ["a", "b"],
      adjacent: [["a", "right", "b"]],
    });
    expect(() => synthesize(model, { cols: 4, rows: 1, attempts: 2 })).toThrow(/too sparse/);
  });

  it("resynthesize rewrites a patch and keeps everything around it", () => {
    const model = analyze(SAMPLE, { edge: true });
    const base = synthesize(model, { cols: 15, rows: 11, seed: 2 });
    const patched = resynthesize(base, model, { x: 5, y: 4, w: 4, h: 3, seed: 8 });
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 15; x++) {
        const inside = x >= 5 && x < 9 && y >= 4 && y < 7;
        if (!inside) expect(patched[y][x]).toBe(base[y][x]);
      }
    }
  });
});

describe("Procgen.defineModel", () => {
  it("builds a model from written-out rules", () => {
    const model = defineModel({
      tiles: ["#", "."],
      weights: { "#": 1, ".": 3 },
      adjacent: [
        ["#", "right", "#"],
        ["#", "right", "."],
        [".", "right", "."],
        [".", "right", "#"],
        ["#", "down", "#"],
        ["#", "down", "."],
        [".", "down", "."],
        [".", "down", "#"],
      ],
      edge: ["#"],
    });
    expect(model.weights).toEqual([1, 3, 0]);
    const out = synthesize(model, { cols: 8, rows: 6, seed: 5 });
    expect(out[0].every((glyph) => glyph === "#")).toBe(true);
  });

  it("rejects a rule naming an unknown glyph", () => {
    expect(() => defineModel({ tiles: ["a"], adjacent: [["a", "right", "z"]] })).toThrow(
      /unknown glyph/,
    );
  });
});

describe("Procgen.caves", () => {
  it("is seeded, bordered, and produces both rock and open space", () => {
    const cave = caves({ cols: 40, rows: 24, seed: 11 });
    expect(toText(cave)).toBe(toText(caves({ cols: 40, rows: 24, seed: 11 })));
    expect(cave[0].every((glyph) => glyph === "#")).toBe(true);
    expect(cave[23].every((glyph) => glyph === "#")).toBe(true);
    const open = cave.flat().filter((glyph) => glyph === ".").length;
    expect(open).toBeGreaterThan(50);
    expect(open).toBeLessThan(40 * 24);
  });

  it("closes up as the fill fraction rises", () => {
    const openAt = (fill: number) =>
      caves({ cols: 40, rows: 24, seed: 3, fill })
        .flat()
        .filter((glyph) => glyph === ".").length;
    expect(openAt(0.4)).toBeGreaterThan(openAt(0.6));
  });
});

describe("Procgen.repair", () => {
  it("finds regions largest first", () => {
    const found = regions(fromText("..#..\n..#..\n..#.."));
    expect(found).toHaveLength(2);
    expect(found[0].cells).toHaveLength(6);
    expect(found[0].bounds).toEqual({ x: 0, y: 0, w: 2, h: 3 });
  });

  it("connects isolated pockets and leaves connected maps alone", () => {
    const split = fromText("#######\n#..#..#\n#..#..#\n#######");
    expect(isConnected(split)).toBe(false);
    const fixed = repair(split);
    expect(isConnected(fixed)).toBe(true);
    // It digs the shortest tunnel: one cell of the dividing wall.
    expect(fixed.flat().filter((glyph) => glyph === ".").length).toBe(9);

    const already = fromText("#####\n#...#\n#####");
    expect(toText(repair(already))).toBe(toText(already));
  });

  it("walls off pockets below minRegion instead of connecting them", () => {
    // Left pocket 6 cells, right pocket 4 — only the left one survives.
    const split = fromText("########\n#...#..#\n#...#..#\n########");
    const trimmed = repair(split, { minRegion: 5 });
    expect(isConnected(trimmed)).toBe(true);
    expect(trimmed.flat().filter((glyph) => glyph === ".").length).toBe(6);
  });

  it("guarantees a connected cave whatever the seed", () => {
    for (let seed = 0; seed < 12; seed++) {
      const cave = repair(caves({ cols: 40, rows: 26, seed }));
      expect(isConnected(cave)).toBe(true);
    }
  });
});

describe("Procgen.rooms", () => {
  it("places connected rooms inside the grid", () => {
    const layout = rooms({ cols: 48, rows: 32, seed: 5 });
    expect(layout.rooms.length).toBeGreaterThan(1);
    expect(isConnected(layout.grid)).toBe(true);
    for (const room of layout.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
      expect(room.x + room.w).toBeLessThanOrEqual(48);
      expect(room.y + room.h).toBeLessThanOrEqual(32);
    }
  });

  it("is deterministic per seed", () => {
    const a = rooms({ cols: 40, rows: 30, seed: 12 });
    const b = rooms({ cols: 40, rows: 30, seed: 12 });
    expect(toText(a.grid)).toBe(toText(b.grid));
    expect(a.rooms).toEqual(b.rooms);
  });
});

describe("Procgen.chunks", () => {
  const TEMPLATE_A = "#####\n#...#\n#...#\n#...#\n#####";
  const TEMPLATE_B = "#####\n#.#.#\n#...#\n#.#.#\n#####";

  it("stitches templates and carves a path from top to bottom", () => {
    const result = chunks({
      templates: [TEMPLATE_A, TEMPLATE_B],
      cols: 4,
      rows: 3,
      seed: 2,
      offPath: "#",
    });
    expect(cols(result.grid)).toBe(20);
    expect(rows(result.grid)).toBe(15);
    expect(result.path[0].y).toBe(0);
    expect(result.path[result.path.length - 1].y).toBe(2);
    expect(result.grid[result.entrance.y][result.entrance.x]).toBe("S");
    expect(result.grid[result.exit.y][result.exit.x]).toBe("E");
    // The whole path is one connected region, markers included.
    expect(isConnected(result.grid, { alsoWalkable: ["S", "E"] })).toBe(true);
  });

  it("rejects mismatched or undersized templates", () => {
    expect(() => chunks({ templates: [], cols: 2, rows: 2 })).toThrow(/at least one template/);
    expect(() => chunks({ templates: [TEMPLATE_A, "##\n##"], cols: 2, rows: 2 })).toThrow(
      /same size/,
    );
    expect(() => chunks({ templates: ["##\n##"], cols: 2, rows: 2 })).toThrow(/at least 3/);
  });
});

describe("Procgen.dungeon", () => {
  it("produces a connected dungeon with an entrance, exit and critical path", () => {
    const result = dungeon({ cols: 64, rows: 44, seed: 7, locks: 0 });
    expect(result.rooms.length).toBeGreaterThan(2);
    expect(result.critical[0]).toBe(result.entrance.id);
    expect(result.critical[result.critical.length - 1]).toBe(result.exit.id);
    expect(result.grid[result.entrance.cy][result.entrance.cx]).toBe("S");
    expect(result.grid[result.exit.cy][result.exit.cx]).toBe("E");
    expect(isConnected(result.grid, { alsoWalkable: ["S", "E"] })).toBe(true);
  });

  it("hides every key in a room reachable before its door", () => {
    for (let seed = 0; seed < 10; seed++) {
      const result = dungeon({ cols: 72, rows: 52, seed, locks: 2 });
      for (const lock of result.locks) {
        const step = result.critical.indexOf(lock.between[1]);
        expect(step).toBeGreaterThan(0);
        // The key room hangs off the critical path strictly before the door.
        const before = result.critical.slice(0, step);
        const touches = result.links.some(
          ([a, b]) =>
            (a === lock.keyRoom && before.includes(b)) ||
            (b === lock.keyRoom && before.includes(a)),
        );
        expect(touches).toBe(true);
        expect(before).not.toContain(lock.keyRoom);
      }
    }
  });

  it("is deterministic and drops locks it cannot place fairly", () => {
    const a = dungeon({ cols: 60, rows: 40, seed: 21, locks: 3 });
    const b = dungeon({ cols: 60, rows: 40, seed: 21, locks: 3 });
    expect(toText(a.grid)).toBe(toText(b.grid));
    expect(a.locks.length).toBeLessThanOrEqual(3);
  });
});

describe("Procgen output feeds Tiles.grid directly", () => {
  it("builds a playable level from a generated dungeon", () => {
    const result = dungeon({ cols: 48, rows: 32, seed: 4, locks: 1 });
    const level = tileGrid(result.grid, {
      size: 16,
      legend: { "#": { solid: true } },
    });
    expect(level.cols).toBe(48);
    expect(level.rows).toBe(32);
    expect(level.spawnOne("S")).toEqual({
      x: (result.entrance.cx + 0.5) * 16,
      y: (result.entrance.cy + 0.5) * 16,
    });
    // The merged collision rects cover the rock and nothing else.
    expect(level.solidAt((result.entrance.cx + 0.5) * 16, (result.entrance.cy + 0.5) * 16)).toBe(
      false,
    );
  });
});

describe("Procgen metrics", () => {
  const ROOM = fromText("#####\n#...#\n#...#\n#####");

  it("measures openness and glyph frequencies", () => {
    expect(openness(ROOM)).toBeCloseTo(6 / 20, 6);
    expect(frequencies(ROOM)["#"]).toBeCloseTo(14 / 20, 6);
  });

  it("reports the reachable fraction and the longest walk", () => {
    expect(reachableFraction(ROOM)).toBe(1);
    // A 3×2 room: the far corners are 3 steps apart.
    expect(longestPath(ROOM)).toBe(3);

    const split = fromText("#######\n#..#..#\n#######");
    expect(reachableFraction(split)).toBeCloseTo(2 / 4, 6);
  });

  it("measures path length and reports Infinity when there is no route", () => {
    const split = fromText("#######\n#..#..#\n#######");
    expect(pathLength(split, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(1);
    expect(pathLength(split, { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(Infinity);
  });

  it("separates corridors from halls and counts dead ends", () => {
    const corridor = fromText("#######\n#.....#\n#######");
    const hall = fromText("#####\n#...#\n#...#\n#...#\n#####");
    expect(corridorRatio(corridor)).toBeGreaterThan(corridorRatio(hall));
    expect(deadEnds(corridor)).toBe(2); // both ends of the passage
    expect(deadEnds(hall)).toBe(0);
  });

  it("scores mirror symmetry", () => {
    expect(symmetry(fromText("#.#\n#.#"))).toBe(1);
    expect(symmetry(fromText("#..\n#.."))).toBe(0);
  });

  it("measure() bundles the set", () => {
    const all = measure(ROOM);
    expect(all.openness).toBeCloseTo(openness(ROOM), 6);
    expect(all.longestPath).toBe(longestPath(ROOM));
    expect(all.frequencies["."]).toBeCloseTo(6 / 20, 6);
  });

  it("treats extra glyphs as walkable when asked", () => {
    const withDoor = fromText("#####\n#.D.#\n#####");
    expect(reachableFraction(withDoor)).toBeCloseTo(0.5, 6);
    expect(reachableFraction(withDoor, { alsoWalkable: ["D"] })).toBe(1);
  });
});

describe("Procgen.illuminate", () => {
  /** A tiny stand-in candidate space: a number in [0, 1). */
  const numeric = {
    create: (rng: { random(): number }) => rng.random(),
    fitness: (value: number) => 1 - Math.abs(value - 0.5),
    measures: [(value: number) => value],
  };

  it("fills an archive of best-per-behaviour candidates", () => {
    const archive = illuminate({ ...numeric, resolution: 5, iterations: 200, seed: 1 });
    expect(archive.resolution).toEqual([5]);
    expect(archive.coverage).toBeGreaterThan(0.5);
    expect(archive.best?.fitness).toBeGreaterThan(0.9);
    for (const elite of archive.elites) {
      // Every elite really does sit in the cell it claims.
      expect(elite.cell[0]).toBe(Math.min(4, Math.floor(elite.measures[0] * 5)));
    }
    // Elites are sorted best first.
    for (let i = 1; i < archive.elites.length; i++) {
      expect(archive.elites[i - 1].fitness).toBeGreaterThanOrEqual(archive.elites[i].fitness);
    }
  });

  it("is deterministic and reports empty cells as null", () => {
    const a = illuminate({ ...numeric, resolution: 4, iterations: 60, seed: 3 });
    const b = illuminate({ ...numeric, resolution: 4, iterations: 60, seed: 3 });
    expect(a.elites.map((e) => e.candidate)).toEqual(b.elites.map((e) => e.candidate));
    expect(a.at(99)).toBeNull();
    expect(a.evaluated).toBe(60);
  });

  it("uses mutate to refine elites once the initial pass is done", () => {
    let mutations = 0;
    const archive = illuminate({
      ...numeric,
      mutate: (parent: number, rng: { random(): number }) => {
        mutations++;
        return Math.min(0.999, Math.max(0, parent + (rng.random() - 0.5) * 0.1));
      },
      resolution: 6,
      iterations: 100,
      initial: 20,
      seed: 4,
    });
    expect(mutations).toBeGreaterThan(50);
    expect(archive.best?.fitness).toBeGreaterThan(0.95);
  });

  it("rejects candidates with non-finite fitness and validates its options", () => {
    const archive = illuminate({
      create: () => 1,
      fitness: () => -Infinity,
      measures: [() => 0.5],
      iterations: 10,
      seed: 0,
    });
    expect(archive.elites).toHaveLength(0);
    expect(archive.best).toBeNull();
    expect(archive.coverage).toBe(0);

    expect(() => illuminate({ create: () => 1, fitness: () => 1, measures: [] })).toThrow(
      /at least one measure/,
    );
    expect(() =>
      illuminate({ create: () => 1, fitness: () => 1, measures: [() => 0], resolution: 0 }),
    ).toThrow(/positive integers/);
  });

  it("illuminates real levels across openness and twistiness", () => {
    const archive = illuminate({
      create: (rng) => repair(caves({ cols: 32, rows: 22, seed: rng.integer(0, 1e6) })),
      fitness: (grid) => longestPath(grid),
      measures: [(grid) => openness(grid), (grid) => corridorRatio(grid)],
      resolution: 4,
      iterations: 40,
      seed: 8,
    });
    expect(archive.elites.length).toBeGreaterThan(1);
    for (const elite of archive.elites) {
      expect(isConnected(elite.candidate)).toBe(true);
      expect(elite.fitness).toBeGreaterThan(0);
    }
  });
});

describe("Procgen.steer", () => {
  const BIOME = `
#####
#...#
#.~.#
#...#
#####
`;

  it("decreases its loss and returns a normalised field", () => {
    const model = analyze(BIOME, { edge: true });
    const result = steer(model, {
      cols: 12,
      rows: 10,
      targets: [{ glyph: "~", share: 0.2 }],
      steps: 60,
    });
    expect(result.history).toHaveLength(60);
    expect(result.history[59]).toBeLessThan(result.history[0]);

    const T = model.tiles.length;
    for (let cell = 0; cell < 12 * 10; cell++) {
      let total = 0;
      for (let t = 0; t < T; t++) total += result.field[cell * T + t];
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it("hits a share target within tolerance", () => {
    const model = analyze(BIOME, { edge: true });
    const T = model.tiles.length;
    const water = model.tiles.indexOf("~");
    const result = steer(model, {
      cols: 14,
      rows: 12,
      targets: [{ glyph: "~", share: 0.25 }],
      steps: 200,
      sharpen: 0,
    });
    let mean = 0;
    for (let cell = 0; cell < 14 * 12; cell++) mean += result.field[cell * T + water];
    mean /= 14 * 12;
    expect(mean).toBeCloseTo(0.25, 1);
  });

  it("follows a per-cell ramp so density varies across the grid", () => {
    const model = analyze(BIOME, { edge: true });
    const T = model.tiles.length;
    const rock = model.tiles.indexOf("#");
    const result = steer(model, {
      cols: 20,
      rows: 8,
      targets: [{ glyph: "#", share: ramp("x", 0.1, 0.7, 20) }],
      steps: 200,
      sharpen: 0,
      adjacency: 0,
    });
    const columnMean = (x: number) => {
      let total = 0;
      for (let y = 0; y < 8; y++) total += result.field[(y * 20 + x) * T + rock];
      return total / 8;
    };
    expect(columnMean(19)).toBeGreaterThan(columnMean(0) + 0.3);
  });

  it("never emits a zero weight for a placeable glyph", () => {
    const model = analyze(BIOME, { edge: true });
    const T = model.tiles.length;
    const outsideIndex = model.tiles.indexOf(OUTSIDE);
    const result = steer(model, {
      cols: 8,
      rows: 8,
      targets: [{ glyph: "~", share: 0, weight: 50 }],
      steps: 150,
    });
    for (let cell = 0; cell < 64; cell++) {
      for (let t = 0; t < T; t++) {
        if (t === outsideIndex) continue;
        expect(result.weights[cell * T + t]).toBeGreaterThan(0);
      }
    }
  });

  it("restricts a target to its region", () => {
    const model = analyze(BIOME, { edge: true });
    const T = model.tiles.length;
    const water = model.tiles.indexOf("~");
    const result = steer(model, {
      cols: 16,
      rows: 8,
      targets: [{ glyph: "~", share: 0.6, region: { x: 0, y: 0, w: 8, h: 8 } }],
      steps: 200,
      sharpen: 0,
      adjacency: 0,
    });
    const meanOver = (x0: number, x1: number) => {
      let total = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = x0; x < x1; x++) total += result.field[(y * 16 + x) * T + water];
      }
      return total / (8 * (x1 - x0));
    };
    expect(meanOver(0, 8)).toBeGreaterThan(meanOver(8, 16) + 0.2);
  });

  it("feeds synthesize, which still enforces the hard rules", () => {
    const model = analyze(BIOME, { edge: true });
    const T = model.tiles.length;
    const index = new Map(model.tiles.map((glyph, i) => [glyph, i]));
    const { weights } = steer(model, {
      cols: 16,
      rows: 12,
      targets: [{ glyph: "~", share: 0.3 }],
      steps: 80,
    });
    const out = synthesize(model, { cols: 16, rows: 12, seed: 5, weights });
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        const a = index.get(out[y][x]) as number;
        if (x + 1 < 16) {
          const b = index.get(out[y][x + 1]) as number;
          expect(model.allowed[(1 * T + a) * T + b]).toBe(1);
        }
      }
    }
  });

  it("validates its inputs", () => {
    const model = analyze(BIOME, { edge: true });
    expect(() => steer(model, { cols: 0, rows: 4 })).toThrow(/positive integers/);
    expect(() => steer(model, { cols: 4, rows: 4, targets: [{ glyph: "?", share: 0.5 }] })).toThrow(
      /not in the model/,
    );
  });

  it("ramp clamps outside its span", () => {
    const across = ramp("x", 0, 1, 11);
    expect(across(0, 0)).toBe(0);
    expect(across(5, 0)).toBeCloseTo(0.5, 6);
    expect(across(10, 0)).toBe(1);
    expect(across(99, 0)).toBe(1);
  });
});

describe("Procgen steering reaches synthesize", () => {
  /** A permissive model: every glyph may sit beside every other, so the only
   *  thing deciding the mix is the weights. Rock is 9x more common than floor. */
  const PERMISSIVE = defineModel({
    tiles: ["#", "."],
    weights: { "#": 90, ".": 10 },
    adjacent: [
      ["#", "right", "#"],
      ["#", "right", "."],
      [".", "right", "."],
      [".", "right", "#"],
      ["#", "down", "#"],
      ["#", "down", "."],
      [".", "down", "."],
      [".", "down", "#"],
    ],
  });

  const shareOf = (grid: ReturnType<typeof synthesize>, glyph: string) =>
    grid.flat().filter((cell) => cell === glyph).length / (grid.length * grid[0].length);

  it("overrides the model's own frequencies rather than merely nudging them", () => {
    const plain = synthesize(PERMISSIVE, { cols: 30, rows: 30, seed: 5 });
    expect(shareOf(plain, ".")).toBeLessThan(0.2); // the model's 10%

    const { weights } = steer(PERMISSIVE, {
      cols: 30,
      rows: 30,
      targets: [{ glyph: ".", share: 0.5 }],
      steps: 250,
    });
    const aimed = synthesize(PERMISSIVE, { cols: 30, rows: 30, seed: 5, weights });
    expect(shareOf(aimed, ".")).toBeGreaterThan(0.35);
    expect(shareOf(aimed, ".")).toBeLessThan(0.65);
  });

  it("applies a ramp to the synthesized grid, not just the field", () => {
    const { weights } = steer(PERMISSIVE, {
      cols: 40,
      rows: 20,
      targets: [{ glyph: ".", share: ramp("x", 0.05, 0.9, 40) }],
      steps: 250,
    });
    const out = synthesize(PERMISSIVE, { cols: 40, rows: 20, seed: 2, weights });
    const halfShare = (x0: number, x1: number) => {
      let open = 0;
      for (let y = 0; y < 20; y++) {
        for (let x = x0; x < x1; x++) if (out[y][x] === ".") open++;
      }
      return open / (20 * (x1 - x0));
    };
    expect(halfShare(20, 40)).toBeGreaterThan(halfShare(0, 20) + 0.25);
  });
});

describe("Procgen.topology (the reusable half of a dungeon)", () => {
  // 0 — 1 — 2 — 3 — 4      a straight chain with a branch at 2
  //         |
  //         5 — 6
  const LINKS = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [2, 5],
    [5, 6],
  ] as Array<readonly [number, number]>;

  it("finds the two most distant nodes and the route between them", () => {
    const shape = topology(7, LINKS);
    expect([shape.start, shape.end].sort()).toEqual([0, 4]);
    expect(shape.main).toHaveLength(5);
    expect(shape.main[0]).toBe(shape.start);
    expect(shape.main.at(-1)).toBe(shape.end);
  });

  it("reports side branches off the route, and only those already reachable", () => {
    const shape = topology(7, LINKS);
    const stepOf = (node: number) => shape.main.indexOf(node);
    // Everything hanging off the route up to and including node 2.
    const after2 = branchesBefore(shape, stepOf(2) + 1);
    expect(after2).toContain(5);
    // Before reaching node 2, its branch is not yet available.
    expect(branchesBefore(shape, stepOf(2))).not.toContain(5);
  });

  it("honours the exclude set and handles an empty graph", () => {
    const shape = topology(7, LINKS);
    expect(branchesBefore(shape, 7, new Set([5]))).not.toContain(5);
    expect(topology(0, [])).toEqual({ adjacency: [], start: -1, end: -1, main: [] });
  });

  it("names no glyph — it is pure graph shape", () => {
    // The whole point of the split: this never sees a grid.
    const shape = topology(3, [
      [0, 1],
      [1, 2],
    ]);
    expect(shape.adjacency).toEqual([[1], [0, 2], [1]]);
  });
});

describe("Procgen.overlapping (N x N patterns)", () => {
  // A 2x2 pool ringed by stone. Every glyph pair in here is individually
  // legal in lots of arrangements — the MOTIF is what the tiled model loses.
  const POOL = `
########
#......#
#.####.#
#.#~~#.#
#.#~~#.#
#.####.#
#......#
########`;

  // POOL at n=3 is deliberately RIGID: its only tilings are translations of
  // itself, which is the right thing for the motif test and useless for the
  // weighting one. MEADOW has the same vocabulary with room to rearrange it.
  const MEADOW = `
..........
..~~...##.
..~~...##.
..........
.##.......
.##...~~..
......~~..
..........
...##.....
...##.....`;

  it("extracts every distinct window and counts how often each occurs", () => {
    const built = overlapping("aa\naa", { n: 2, periodic: true });
    // Every 2x2 window of an all-"a" torus is the same pattern, seen 4 times.
    expect(built.model.tiles).toHaveLength(1);
    expect(built.model.weights).toEqual([4]);
    expect(built.patterns[0]).toEqual([
      ["a", "a"],
      ["a", "a"],
    ]);
  });

  it("only allows patterns that agree on their overlap", () => {
    const built = overlapping(POOL, { n: 3 });
    const T = built.model.tiles.length;
    const RIGHT = 1;
    for (let a = 0; a < T; a++) {
      for (let b = 0; b < T; b++) {
        if (!built.model.allowed[(RIGHT * T + a) * T + b]) continue;
        // b sits one cell right of a, so a's columns 1..2 are b's columns 0..1.
        for (let y = 0; y < 3; y++) {
          for (let x = 1; x < 3; x++) {
            expect(built.patterns[a][y][x]).toBe(built.patterns[b][y][x - 1]);
          }
        }
      }
    }
  });

  it("is deterministic per seed and varies across seeds", () => {
    const built = overlapping(POOL, { n: 3 });
    const run = (seed: number) =>
      toText(built.render(synthesize(built.model, { cols: 20, rows: 14, seed })));
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });

  it("reproduces a motif the tiled model breaks apart", () => {
    // The sample's water only ever appears as a 2x2 block. Count how often a
    // water cell has a water neighbour in each model's output: the overlapping
    // model should keep pools whole, the tiled one should not.
    const clumping = (grid: ReturnType<typeof synthesize>) => {
      let water = 0;
      let paired = 0;
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
          if (grid[y][x] !== "~") continue;
          water++;
          const right = grid[y][x + 1] === "~";
          const down = grid[y + 1]?.[x] === "~";
          if (right || down) paired++;
        }
      }
      return water === 0 ? 0 : paired / water;
    };

    const built = overlapping(POOL, { n: 3 });
    const over = built.render(synthesize(built.model, { cols: 24, rows: 24, seed: 1 }));
    const tiled = synthesize(analyze(POOL), { cols: 24, rows: 24, seed: 1 });

    // Both must actually produce water, or the comparison is vacuous.
    expect(frequencies(over)["~"] ?? 0).toBeGreaterThan(0);
    expect(frequencies(tiled)["~"] ?? 0).toBeGreaterThan(0);
    expect(clumping(over)).toBeGreaterThan(clumping(tiled));
  });

  it("renders each pattern to its top-left glyph, passing other cells through", () => {
    const built = overlapping("ab\ncd", { n: 2, periodic: true });
    const collapsed = [[built.model.tiles[0], "MARKER"]];
    const out = built.render(collapsed);
    expect(out[0][0]).toBe(built.patterns[0][0][0]);
    expect(out[0][1]).toBe("MARKER");
  });

  it("symmetry adds transformed patterns", () => {
    const plain = overlapping(POOL, { n: 3 }).model.tiles.length;
    const mirrored = overlapping(POOL, { n: 3, symmetry: 2 }).model.tiles.length;
    const full = overlapping(POOL, { n: 3, symmetry: 8 }).model.tiles.length;
    expect(mirrored).toBeGreaterThanOrEqual(plain);
    expect(full).toBeGreaterThanOrEqual(mirrored);
  });

  it("glyphWeights biases the collapse toward a glyph", () => {
    const built = overlapping(MEADOW, { n: 3 });
    const share = (grid: ReturnType<typeof synthesize>) => frequencies(grid)["~"] ?? 0;
    const plain = built.render(synthesize(built.model, { cols: 24, rows: 24, seed: 2 }));
    const wet = built.render(
      synthesize(built.model, {
        cols: 24,
        rows: 24,
        seed: 2,
        weights: glyphWeights(built, { "~": 6 }, { cols: 24, rows: 24 }),
      }),
    );
    expect(share(wet)).toBeGreaterThan(share(plain));
  });

  it("validates its inputs", () => {
    expect(() => overlapping("", { n: 3 })).toThrow(/empty/);
    expect(() => overlapping("abc\ndef", { n: 1 })).toThrow(/at least 2/);
    expect(() => overlapping("ab\ncd", { n: 3, periodic: false })).toThrow(
      /smaller than the 3x3 window/,
    );
    expect(() => overlapping("ab\ncd", { n: 2, symmetry: 3 as never })).toThrow(/symmetry/);
    expect(() => overlapping(POOL, { n: 3, maxPatterns: 2 })).toThrow(/exceeds maxPatterns/);
  });

  it("rejects a non-periodic sample whose patterns cannot tile the plane", () => {
    // The whole reason `periodic` defaults true. Read non-periodically, POOL's
    // patterns describe the interior of that one box, and NOT ONE of them
    // survives the reachability prune — so there is no arrangement to find and
    // retrying is pointless. Fail at build time, saying which knob to turn,
    // rather than after N attempts with "the model may be too sparse".
    expect(() => overlapping(POOL, { n: 3, periodic: false })).toThrow(/try periodic: true/);
    expect(() => overlapping(POOL, { n: 3, periodic: false })).toThrow(/no pattern can tile/);
  });

  it("keeps every pattern of a model that can tile", () => {
    // The prune must be a no-op on a healthy model, or it would be silently
    // narrowing output variety.
    const built = overlapping(POOL, { n: 3 });
    expect(built.model.tiles).toHaveLength(46);
    expect(built.patterns).toHaveLength(46);
    // Compaction has to keep `patterns[i]` aligned with `tiles[i]`, which is
    // exactly what `render` relies on. Checked through the public surface
    // rather than against the key format, which is nobody's business.
    for (let i = 0; i < built.patterns.length; i++) {
      expect(built.render([[built.model.tiles[i]]])[0][0]).toBe(built.patterns[i][0][0]);
    }
  });
});
