import { describe, expect, it } from "vitest";
import { generate } from "@src/cli/features/procgen.js";
import { DUNGEON_MARKERS, isConnected, toText } from "@src/procgen/index.js";

const BASE = {
  cols: 32,
  rows: 20,
  seed: 1,
  locks: 1,
  fill: 0.45,
  share: 0.15,
  repair: true,
} as const;

const SAMPLE = `##########
#........#
#..####..#
#..#~~#..#
#..####..#
#........#
##########`;

describe("mm procgen gen", () => {
  it("produces a connected level for every generator kind", () => {
    for (const kind of ["dungeon", "cave", "rooms", "wfc"] as const) {
      const grid = generate({ ...BASE, kind, ...(kind === "wfc" ? { sample: SAMPLE } : {}) });
      expect(grid).toHaveLength(20);
      expect(grid[0]).toHaveLength(32);
      expect(isConnected(grid, DUNGEON_MARKERS)).toBe(true);
    }
  });

  it("is reproducible from a seed — the guarantee --check relies on", () => {
    const once = generate({ ...BASE, kind: "dungeon" });
    const twice = generate({ ...BASE, kind: "dungeon" });
    expect(toText(once)).toBe(toText(twice));
    expect(toText(generate({ ...BASE, kind: "dungeon", seed: 2 }))).not.toBe(toText(once));
  });

  it("can skip the connectivity guarantee", () => {
    // Caves are only sometimes born connected, so find a seed that is not and
    // show the flag is what makes the difference.
    let broken = -1;
    for (let seed = 0; seed < 30 && broken < 0; seed++) {
      if (!isConnected(generate({ ...BASE, kind: "cave", fill: 0.5, seed, repair: false }))) {
        broken = seed;
      }
    }
    expect(broken).toBeGreaterThanOrEqual(0);
    const raw = generate({ ...BASE, kind: "cave", fill: 0.5, seed: broken, repair: false });
    const guarded = generate({ ...BASE, kind: "cave", fill: 0.5, seed: broken });
    expect(isConnected(raw)).toBe(false);
    expect(isConnected(guarded)).toBe(true);
    expect(toText(raw)).not.toBe(toText(guarded));
  });

  it("steers the wfc generator toward a glyph share", () => {
    const plain = generate({ ...BASE, kind: "wfc", sample: SAMPLE, repair: false });
    const wet = generate({
      ...BASE,
      kind: "wfc",
      sample: SAMPLE,
      steerGlyph: "~",
      share: 0.3,
      repair: false,
    });
    const water = (grid: string[][]) => grid.flat().filter((cell) => cell === "~").length;
    // The sample's rules keep water in walled pools, so this cannot reach 30% —
    // steering is advisory and the hard adjacency rules still win. It should
    // still move it decisively.
    expect(water(wet)).toBeGreaterThan(water(plain));
  });

  it("rejects wfc without a sample", () => {
    expect(() => generate({ ...BASE, kind: "wfc" })).toThrow(/--sample/);
  });
});
