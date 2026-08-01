// ---------- Procgen CLI ----------
// The author-time face of `minimotor/procgen`: bake a level to disk, or measure
// one you already have. Everything is seeded, so `--check` can assert that a
// committed level still matches what the generator produces — the same drift
// guard `mm level build --check` gives authored levels.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { numberOption, takeFlag, takeOption } from "@src/cli/utils.js";
import { defineFeature } from "@src/cli/feature.js";
import {
  analyze,
  caves,
  dungeon,
  fromText,
  isConnected,
  DUNGEON_MARKERS,
  measure,
  repair,
  rooms,
  steer,
  synthesize,
  toText,
  type CharGrid,
} from "@src/procgen/index.js";

const help = `Generate and measure levels

Usage:
  mm procgen gen <dungeon|cave|rooms|wfc> [options]
  mm procgen measure <level.txt>

Generator options:
  --cols <n>        Width in cells. Default 64
  --rows <n>        Height in cells. Default 40
  --seed <n>        Deterministic seed. Default 0
  --locks <n>       Locked doors (dungeon only). Default 1
  --fill <f>        Initial wall fraction (cave only). Default 0.45
  --sample <file>   Hand-drawn sample to learn from (wfc only, required)
  --water <glyph>   Glyph to steer toward a target share (wfc only)
  --share <f>       Target share for --water. Default 0.15
  --no-repair       Skip the connectivity guarantee.

Output options:
  -o, --out <file>  Write the grid to a file instead of stdout.
  --check           Exit non-zero if --out differs from what was generated.
  --json            Print metrics as JSON alongside the grid.
`;

type Kind = "dungeon" | "cave" | "rooms" | "wfc";

const KINDS: readonly Kind[] = ["dungeon", "cave", "rooms", "wfc"];

export interface GenerateOptions {
  kind: Kind;
  cols: number;
  rows: number;
  seed: number;
  locks: number;
  fill: number;
  /** Sample text, required for `wfc`. */
  sample?: string;
  /** Glyph to steer toward `share`, for `wfc`. */
  steerGlyph?: string;
  share: number;
  repair: boolean;
}

/** Run one generator and return its grid. Exported so tests drive the same
 *  code path the CLI does, without spawning a process. */
export function generate(options: GenerateOptions): CharGrid {
  const { cols, rows: height, seed } = options;
  let grid: CharGrid;
  switch (options.kind) {
    case "dungeon":
      grid = dungeon({ cols, rows: height, seed, locks: options.locks }).grid;
      break;
    case "cave":
      grid = caves({ cols, rows: height, seed, fill: options.fill });
      break;
    case "rooms":
      grid = rooms({ cols, rows: height, seed }).grid;
      break;
    case "wfc": {
      if (!options.sample) throw new Error("wfc needs --sample <file>");
      const model = analyze(fromText(options.sample), { edge: true });
      const weights = options.steerGlyph
        ? steer(model, {
            cols,
            rows: height,
            targets: [{ glyph: options.steerGlyph, share: options.share }],
          }).weights
        : undefined;
      grid = synthesize(model, { cols, rows: height, seed, weights });
      break;
    }
  }
  // Markers must stay walkable or the guarantee would wall the exit in.
  return options.repair ? repair(grid, DUNGEON_MARKERS) : grid;
}

function report(grid: CharGrid): Record<string, unknown> {
  const stats = measure(grid, DUNGEON_MARKERS);
  return {
    cols: grid[0]?.length ?? 0,
    rows: grid.length,
    connected: isConnected(grid, DUNGEON_MARKERS),
    openness: Number(stats.openness.toFixed(3)),
    corridorRatio: Number(stats.corridorRatio.toFixed(3)),
    longestPath: stats.longestPath,
    deadEnds: stats.deadEnds,
    frequencies: Object.fromEntries(
      Object.entries(stats.frequencies).map(([glyph, share]) => [glyph, Number(share.toFixed(3))]),
    ),
  };
}

export default defineFeature({
  name: "procgen",
  summary: "Generate levels from seeds or samples, and measure them.",
  usage: ["mm procgen gen <dungeon|cave|rooms|wfc> [options]", "mm procgen measure <level.txt>"],
  run(input) {
    if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    const args = [...input];
    const command = args.shift();

    if (command === "measure") {
      const path = args.shift();
      if (!path) throw new Error("measure needs a level file");
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      const grid = fromText(readFileSync(resolve(path), "utf8"));
      process.stdout.write(`${JSON.stringify(report(grid), null, 2)}\n`);
      return;
    }

    if (command !== "gen") throw new Error(`unknown procgen command "${command}"\n\n${help}`);

    const kind = args.shift() as Kind | undefined;
    if (!kind || !KINDS.includes(kind)) {
      throw new Error(`gen needs one of ${KINDS.join(", ")}\n\n${help}`);
    }
    const samplePath = takeOption(args, "--sample");
    const steerGlyph = takeOption(args, "--water");
    const out = takeOption(args, "-o", "--out");
    const check = takeFlag(args, "--check");
    const json = takeFlag(args, "--json");
    const noRepair = takeFlag(args, "--no-repair");
    const options: GenerateOptions = {
      kind,
      cols: numberOption(args, 64, "--cols"),
      rows: numberOption(args, 40, "--rows"),
      seed: numberOption(args, 0, "--seed"),
      locks: numberOption(args, 1, "--locks"),
      fill: numberOption(args, 0.45, "--fill"),
      share: numberOption(args, 0.15, "--share"),
      repair: !noRepair,
      ...(samplePath ? { sample: readFileSync(resolve(samplePath), "utf8") } : {}),
      ...(steerGlyph ? { steerGlyph } : {}),
    };
    if (args.length) throw new Error(`unknown option "${args[0]}"`);
    for (const [name, value] of [
      ["--cols", options.cols],
      ["--rows", options.rows],
    ] as const) {
      if (!Number.isInteger(value) || value < 1)
        throw new Error(`${name} must be a positive integer`);
    }

    const text = `${toText(generate(options))}\n`;
    if (check) {
      if (!out) throw new Error("--check needs --out <file> to compare against");
      const existing = readFileSync(resolve(out), "utf8");
      if (existing !== text) {
        throw new Error(`${out} is out of date — rerun without --check to regenerate`);
      }
      process.stdout.write(`${out} is up to date\n`);
      return;
    }
    if (out) {
      writeFileSync(resolve(out), text);
      process.stdout.write(`Wrote ${out}\n`);
    } else {
      process.stdout.write(text);
    }
    if (json) process.stdout.write(`${JSON.stringify(report(fromText(text)), null, 2)}\n`);
  },
});
