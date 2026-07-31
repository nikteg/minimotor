// ---------- Level design CLI ----------
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineFeature } from "@src/cli/feature.js";
import { numberOption, takeFlag, takeOption } from "@src/cli/utils.js";

const help = `Generate, bot-test, score, or verify platformer greyboxes

Usage:
  mm level test [options]
  mm level simulate [options]
  mm level evolve [options]
  mm level generate [options]
  mm level score [options]
  mm level optimize [options]
  mm level train <ratings.jsonl> -o <model.json>
  mm level build <design.json|design.mjs> --skin <adapter.mjs>
                 --template <project.ldtk> -o <project.ldtk>
  mm level check <project.ldtk> [options]

Tester options:
  --host <host>          Listen address. Default 127.0.0.1
  --port <port>          HTTP/WebSocket port. Default 4177
  --ratings <file>       Rating dataset. Default .minimotor/level-tester-ratings.jsonl

Bot simulation options:
  --levels <n>           Generated candidates per round. Default 6
  --rounds <n>           Generate/evaluate/adapt loops. Default 1
  --bots <n>             Synthetic player instances per candidate. Default 8
  --attempts <n>         Runs per bot. Default 3
  --max-steps <n>        Step budget for the planning bot. Default 1500
  --dataset <file>       Write candidate bot metrics as JSONL.
  --report <file>        Write the ranked simulation report as JSON.
  --replay <file>        Write the best planner's input proof as JSON.
  -o, --out <file>       Write the best passing neutral level spec.

Evolution tournament options:
  --population <n>       Power-of-two competitors. Default 16.
  --generations <n>      Selection/mutation generations. Default 4.
  --mutation <0..1>      Difficulty/layout mutation amount. Default 0.18.
  --objective <name>     balanced or complex. Default balanced.
  --tree <file>          Write the ASCII ancestry and bracket tree.
  --report <file>        Write machine-readable ancestry and match results.
  --archive <dir>        Save the top distinct levels and ASCII previews.
  --keep <n>             Levels retained in the archive. Default 16.

Generate options:
  --seed <text>          Reproducible seed. Default "minimotor"
  --width <tiles>        Level width. Default 48
  --height <tiles>       Level height. Default 22
  --difficulty <0..1>   Gap and elevation intensity. Default 0.45
  --layout <name>       varied, surface, tunnel, or mixed. Default varied.
  --features <list>     Exact optional features to use, comma-separated.
  --without <feature>   Disable one optional feature. Repeatable.
  --dash                 Enable dash movement and wider generated gaps.
  --double-jump          Enable an extra airborne jump and taller routes.
  --wall-jump            Enable wall-jump traversal.
  --json                 Emit structured JSON instead of ASCII.
  --trace                Show the grid after every generation pass.
  -o, --out <file>       Write output to a file instead of stdout.

Check options:
  --spawn <entity>       Spawn marker identifier. Default "Player"
  --target <entity>      Required reachable marker. Repeatable. Default "Gem"
  --jump-x <tiles>       Conservative horizontal envelope. Default 3
  --jump-up <tiles>      Conservative upward envelope. Default 2
  --fall <tiles>         Conservative downward envelope. Default 4
  --portal-boundaries    Require portals at the left or right edge.
  --reciprocal-portals   Require every portal link to point back.
  --verbose              Explain geometry and navigation coverage per level.

Score profiles:
  balanced               Moderate challenge, rhythm, and variety.
  flow                   Lower friction and more regular pacing.
  exploration            More verticality, variety, and optional traversal.

Optimization options:
  --count <n>            Candidates to evaluate. Default 200.
  --profile <name>       balanced, flow, or exploration.
  --top <n>              Behavior elites to print. Default 8.
  -o, --out <file>       Write the best neutral level spec.
  --dataset <file>       Write every metric vector as JSONL for labeling/training.
  --model <file>         Use a trained preference model as optimization fitness.

The generator builds terrain, traversal features, and rewards in separate
passes. Every result is checked against a conservative movement envelope
before it is emitted; dash levels may contain wider gaps.
`;

export interface GeneratedLevelOptions {
  seed?: string;
  width?: number;
  height?: number;
  difficulty?: number;
  layout?: GeneratedLayout;
  features?: readonly GeneratedFeature[];
  abilities?: Partial<GeneratedAbilities>;
}

export type GeneratedFeature = "gaps" | "platforms" | "ladders" | "gems" | "tunnels" | "exit";
export const generatedFeatures = [
  "gaps",
  "platforms",
  "ladders",
  "gems",
  "tunnels",
  "exit",
] as const;

export type GeneratedLayout = "surface" | "tunnel" | "mixed";

export interface GeneratedAbilities {
  dash: boolean;
  doubleJump: boolean;
  wallJump: boolean;
}

export interface GeneratedLevel {
  seed: string;
  width: number;
  height: number;
  difficulty: number;
  layout: GeneratedLayout;
  features: GeneratedFeature[];
  abilities: GeneratedAbilities;
  grid: string[];
  stages: { name: string; grid: string[] }[];
  metrics: {
    gaps: number;
    maxGap: number;
    maxStep: number;
    platforms: number;
    gems: number;
    rooms: number;
    coveredRatio: number;
  };
}

export interface NeutralLevelDesign {
  version: 1;
  gridSize: number;
  layout?: GeneratedLayout;
  abilities?: Partial<GeneratedAbilities>;
  levels: {
    id: string;
    name: string;
    theme: string;
    width: number;
    height: number;
    caveRow: number | null;
    entities: { type: string; x: number; y: number; w: number; h: number }[];
  }[];
}

function seedNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomSource(seed: string): () => number {
  let state = seedNumber(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rows(cells: string[][]): string[] {
  return cells.map((row) => row.join(""));
}

function snapshot(stages: GeneratedLevel["stages"], name: string, cells: string[][]): void {
  stages.push({ name, grid: rows(cells) });
}

/** Seeded multi-pass greybox generation with conservative platformer metrics. */
export function generateLevel(options: GeneratedLevelOptions = {}): GeneratedLevel {
  const seed = options.seed ?? "minimotor";
  const width = options.width ?? 48;
  const height = options.height ?? 22;
  const difficulty = options.difficulty ?? 0.45;
  const features = [...new Set(options.features ?? generatedFeatures)];
  const abilities: GeneratedAbilities = {
    dash: options.abilities?.dash ?? false,
    doubleJump: options.abilities?.doubleJump ?? false,
    wallJump: options.abilities?.wallJump ?? false,
  };
  const enabled = (feature: GeneratedFeature) => features.includes(feature);
  if (!Number.isInteger(width) || width < 24 || width > 256) {
    throw new Error("width must be an integer from 24 to 256");
  }
  if (!Number.isInteger(height) || height < 14 || height > 80) {
    throw new Error("height must be an integer from 14 to 80");
  }
  if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 1) {
    throw new Error("difficulty must be between 0 and 1");
  }
  for (const feature of features) {
    if (!generatedFeatures.includes(feature)) throw new Error(`unknown level feature "${feature}"`);
  }
  if (enabled("ladders") && !enabled("platforms")) {
    throw new Error('feature "ladders" requires "platforms"');
  }
  if (enabled("gems") && !enabled("platforms")) {
    throw new Error('feature "gems" requires "platforms"');
  }
  if (options.layout && options.layout !== "surface" && !enabled("tunnels")) {
    throw new Error(`layout "${options.layout}" requires feature "tunnels"`);
  }

  const random = randomSource(seed);
  const layoutRandom = randomSource(`${seed}:layout`);
  const layoutChoices: GeneratedLayout[] =
    width < 36 ? ["surface", "tunnel"] : ["surface", "tunnel", "mixed"];
  const layout =
    options.layout ??
    (enabled("tunnels")
      ? layoutChoices[Math.floor(layoutRandom() * layoutChoices.length)]
      : "surface");
  const cells = Array.from({ length: height }, () => Array<string>(width).fill("."));
  const stages: GeneratedLevel["stages"] = [];
  const routeFloor = Array<number>(width).fill(height - 4);
  const ceiling = Array<number>(width).fill(0);
  let rooms = 0;

  // Pass 1: establish the mass from which the route grammar is carved.
  if (layout === "tunnel") {
    for (const row of cells) row.fill("#");
  } else if (layout === "mixed") {
    routeFloor.fill(height - 9);
    for (let x = 0; x < width; x++) {
      for (let y = routeFloor[x]; y < height; y++) cells[y][x] = "#";
    }
  } else {
    let elevation = height - 4;
    for (let x = 0; x < width; x++) {
      if (x > 5 && x < width - 5 && x % 6 === 0) {
        const direction = random() < 0.34 ? -1 : random() < 0.68 ? 1 : 0;
        elevation = Math.max(height - 8, Math.min(height - 4, elevation + direction));
      }
      routeFloor[x] = elevation;
      for (let y = elevation; y < height; y++) cells[y][x] = "#";
    }
  }
  snapshot(stages, "terrain", cells);

  // Pass 2: carve one of three deliberately different spatial compositions.
  if (layout === "tunnel") {
    let floor = height - 3;
    for (let x = 0; x < width; x++) {
      if (x > 5 && x < width - 5 && x % 8 === 0) {
        floor = Math.max(height - 5, Math.min(height - 2, floor + (random() < 0.5 ? -1 : 1)));
      }
      routeFloor[x] = floor;
      ceiling[x] = Math.max(2, floor - 6);
    }
    const chamberCenters =
      width < 40 ? [Math.floor(width / 2)] : [0.32, 0.68].map((n) => Math.floor(width * n));
    for (const center of chamberCenters) {
      rooms++;
      const radius = Math.max(3, Math.min(6, Math.floor(width / 10)));
      for (let x = Math.max(1, center - radius); x <= Math.min(width - 2, center + radius); x++) {
        const lift = Math.max(0, 3 - Math.floor(Math.abs(x - center) / 2));
        ceiling[x] = Math.max(1, ceiling[x] - lift);
      }
    }
    for (let x = 0; x < width; x++) {
      for (let y = ceiling[x]; y < routeFloor[x]; y++) cells[y][x] = ".";
    }
  } else if (layout === "mixed") {
    const shallowFloor = height - 9;
    const deepFloor = height - 3;
    const rampLength = deepFloor - shallowFloor;
    const descendStart = 5;
    const entry = descendStart + rampLength;
    const ascendEnd = width - 6;
    const exit = ascendEnd - rampLength;
    for (let x = descendStart; x <= entry; x++) {
      routeFloor[x] = shallowFloor + (x - descendStart);
    }
    for (let x = entry + 1; x < exit; x++) routeFloor[x] = deepFloor;
    for (let x = exit; x <= ascendEnd; x++) {
      routeFloor[x] = deepFloor - (x - exit);
    }
    const chamberCenters = [0.4, 0.62].map((n) => Math.floor(width * n));
    for (let x = descendStart; x <= ascendEnd; x++) {
      if (x > entry && x < exit) ceiling[x] = Math.max(2, height - 8);
      else ceiling[x] = Math.max(0, routeFloor[x] - 4);
    }
    for (const center of chamberCenters) {
      if (center <= entry || center >= exit) continue;
      rooms++;
      const radius = Math.max(3, Math.min(5, Math.floor(width / 12)));
      for (let x = center - radius; x <= center + radius; x++) {
        const lift = Math.max(0, 2 - Math.floor(Math.abs(x - center) / 2));
        ceiling[x] = Math.max(2, ceiling[x] - lift);
      }
    }
    for (let x = descendStart; x <= ascendEnd; x++) {
      for (let y = ceiling[x]; y < routeFloor[x]; y++) cells[y][x] = ".";
      for (let y = routeFloor[x]; y < height; y++) cells[y][x] = "#";
    }
  }

  // Short, spaced hazards interrupt the route without defining its whole shape.
  let gaps = 0;
  let maxGap = 0;
  const carveGap = (x: number, gap: number) => {
    for (let gx = x; gx < Math.min(x + gap, width - 6); gx++) {
      for (let y = routeFloor[gx]; y < height; y++) cells[y][gx] = ".";
    }
    gaps++;
    maxGap = Math.max(maxGap, gap);
  };
  if (enabled("gaps")) {
    for (let x = 8; x < width - 8; x += 7 + Math.floor(random() * 5)) {
      if (random() > 0.2 + difficulty * 0.55) continue;
      const extendedGap = abilities.dash ? (random() < 0.5 ? 3 : 4) : 3;
      const gap =
        (abilities.dash || abilities.doubleJump) && random() < 0.35
          ? extendedGap
          : random() < 0.75
            ? 1
            : 2;
      carveGap(x, gap);
      x += gap;
    }
    if (gaps === 0) carveGap(Math.floor(width / 2), difficulty > 0.75 ? 2 : 1);
  }
  snapshot(stages, "route", cells);

  // Pass 3: optional shelves and ladders add a second movement rhythm.
  let platforms = 0;
  const platformCenters: { x: number; y: number }[] = [];
  if (enabled("platforms")) {
    for (let x = 7; x < width - 7; x += 10 + Math.floor(random() * 4)) {
      const platformWidth = 4 + (random() < 0.45 ? 1 : 0);
      const ground = Math.min(...routeFloor.slice(x, x + platformWidth));
      const routeHeight = enabled("ladders")
        ? random() < difficulty
          ? 5
          : 4
        : abilities.doubleJump
          ? random() < difficulty
            ? 4
            : 3
          : abilities.wallJump
            ? random() < difficulty
              ? 4
              : 3
            : 2;
      const localCeiling = Math.max(...ceiling.slice(x, x + platformWidth));
      const y = Math.max(2, localCeiling + 1, ground - routeHeight);
      let placed = 0;
      for (let px = x; px < Math.min(width, x + platformWidth); px++) {
        if (cells[y][px] === ".") {
          cells[y][px] = "=";
          placed++;
        }
      }
      if (placed < 2) continue;
      if (enabled("ladders")) {
        const ladderX = x + 1 + Math.floor(random() * Math.max(1, platformWidth - 2));
        for (let ly = y + 1; ly < routeFloor[ladderX]; ly++) {
          if (cells[ly][ladderX] === ".") cells[ly][ladderX] = "H";
        }
      } else if (abilities.wallJump) {
        // A solid end column turns the raised shelf into a real wall-jump
        // route rather than merely tagging an ordinary jump-only layout.
        const wallX = Math.min(width - 1, x + platformWidth - 1);
        const wallTop = ceiling[wallX] > 0 ? Math.max(y, routeFloor[wallX] - 3) : y;
        for (let wy = wallTop; wy < routeFloor[wallX]; wy++) cells[wy][wallX] = "#";
      }
      platformCenters.push({ x: x + Math.floor(platformWidth / 2), y });
      platforms++;
    }
  }
  snapshot(stages, "traversal", cells);

  // Pass 4: markers and rewards explain the intended routes.
  const startY = routeFloor[2] - 1;
  const exitY = routeFloor[width - 3] - 1;
  cells[startY][2] = "P";
  if (enabled("exit")) cells[exitY][width - 3] = "E";
  let gems = 0;
  if (enabled("gems")) {
    for (const platform of platformCenters) {
      if (cells[platform.y - 1]?.[platform.x] === ".") {
        cells[platform.y - 1][platform.x] = "G";
        gems++;
      }
    }
  }
  snapshot(stages, "rewards", cells);

  const maxStep = routeFloor
    .slice(1)
    .reduce((largest, value, index) => Math.max(largest, Math.abs(value - routeFloor[index])), 0);
  const result: GeneratedLevel = {
    seed,
    width,
    height,
    difficulty,
    layout,
    features,
    abilities,
    grid: rows(cells),
    stages,
    metrics: {
      gaps,
      maxGap,
      maxStep,
      platforms,
      gems,
      rooms,
      coveredRatio: ceiling.filter((value) => value > 0).length / width,
    },
  };
  const errors = validateGeneratedLevel(result);
  if (errors.length) throw new Error(`generated invalid level: ${errors.join("; ")}`);
  return result;
}

/** Hard constraints shared by CLI output and its regression tests. */
export function validateGeneratedLevel(level: GeneratedLevel): string[] {
  const errors: string[] = [];
  if (level.grid.length !== level.height) errors.push("wrong row count");
  if (level.grid.some((row) => row.length !== level.width)) errors.push("wrong column count");
  if (level.grid.join("").split("P").length - 1 !== 1) errors.push("expected one player");
  const enabled = (feature: GeneratedFeature) => level.features.includes(feature);
  if (enabled("exit") && level.grid.join("").split("E").length - 1 !== 1) {
    errors.push("expected one exit");
  }
  const gapLimit = level.abilities.dash ? 4 : level.abilities.doubleJump ? 3 : 2;
  if (level.metrics.maxGap > gapLimit) {
    errors.push(`gap exceeds ${gapLimit}-tile movement envelope`);
  }
  if (level.metrics.maxStep > 1) errors.push("terrain step exceeds 1 tile");
  if (enabled("platforms") && level.metrics.platforms < 1) {
    errors.push("no optional traversal route");
  }
  if (level.layout !== "surface" && !enabled("tunnels")) {
    errors.push(`${level.layout} layout requires tunnels`);
  }
  if (level.layout === "tunnel" && level.metrics.coveredRatio < 0.8) {
    errors.push("tunnel route is not substantially covered");
  }
  if (level.layout === "mixed" && level.metrics.coveredRatio < 0.25) {
    errors.push("mixed route has no substantial underground section");
  }
  if (level.layout !== "surface" && level.metrics.rooms < 1) {
    errors.push("underground route has no chamber");
  }
  return errors;
}

export function generatedDesign(level: GeneratedLevel, id = "Generated"): NeutralLevelDesign {
  const entities: NeutralLevelDesign["levels"][number]["entities"] = [];
  const visited = new Set<string>();
  const at = (x: number, y: number) => level.grid[y]?.[x] ?? ".";
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const glyph = at(x, y);
      if (visited.has(`${x},${y}`)) continue;
      if (glyph === "#" || glyph === "=") {
        let width = 1;
        while (x + width < level.width && at(x + width, y) === glyph) width++;
        for (let offset = 0; offset < width; offset++) visited.add(`${x + offset},${y}`);
        entities.push({ type: glyph === "#" ? "Solid" : "OneWay", x, y, w: width, h: 1 });
      } else if (glyph === "H") {
        let height = 1;
        while (y + height < level.height && at(x, y + height) === "H") height++;
        for (let offset = 0; offset < height; offset++) visited.add(`${x},${y + offset}`);
        entities.push({ type: "Ladder", x, y, w: 1, h: height });
      } else if (glyph === "P" || glyph === "G" || glyph === "E") {
        entities.push({
          type: glyph === "P" ? "Player" : glyph === "G" ? "Gem" : "Exit",
          x,
          y,
          w: 1,
          h: 1,
        });
      }
    }
  }
  return {
    version: 1,
    gridSize: 16,
    layout: level.layout,
    abilities: level.abilities,
    levels: [
      {
        id,
        name: id.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(),
        theme: level.layout,
        width: level.width,
        height: level.height,
        caveRow: level.layout === "surface" ? null : Math.max(1, level.height - 9),
        entities,
      },
    ],
  };
}

export type LevelScoreProfile = "balanced" | "flow" | "exploration";

export interface LevelScore {
  total: number;
  profile: LevelScoreProfile;
  metrics: {
    gapRatio: number;
    eventDensity: number;
    verticalRange: number;
    columnVariety: number;
    rhythmEntropy: number;
    rewardCoverage: number;
    enclosureRatio: number;
    roomCount: number;
  };
  components: {
    validity: number;
    leniency: number;
    pacing: number;
    verticality: number;
    variety: number;
    rhythm: number;
    rewards: number;
    composition: number;
  };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const targetScore = (value: number, target: number, tolerance: number) =>
  clamp01(1 - Math.abs(value - target) / tolerance);

function normalizedEntropy(values: number[]): number {
  if (values.length < 2) return 0;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  if (counts.size < 2) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / values.length;
    entropy -= probability * Math.log(probability);
  }
  return entropy / Math.log(counts.size);
}

/** Interpretable search proxy; it deliberately does not claim to measure fun. */
export function scoreGeneratedLevel(
  level: GeneratedLevel,
  profile: LevelScoreProfile = "balanced",
): LevelScore {
  const columns = Array.from({ length: level.width }, (_, x) =>
    level.grid.findIndex((row) => row[x] === "#"),
  );
  const grounded = columns.filter((height) => height >= 0);
  const events: number[] = [];
  for (let x = 0; x < level.width; x++) {
    if (level.grid.some((row) => "=HGE".includes(row[x]))) events.push(x);
  }
  const spacings = events.slice(1).map((x, index) => Math.min(8, x - events[index]));
  const signatures = new Set(
    Array.from({ length: level.width }, (_, x) => level.grid.map((row) => row[x]).join("")),
  );
  const metrics = {
    gapRatio: 1 - grounded.length / level.width,
    eventDensity: events.length / level.width,
    verticalRange: grounded.length ? Math.max(...grounded) - Math.min(...grounded) : 0,
    columnVariety: signatures.size / level.width,
    rhythmEntropy: normalizedEntropy(spacings),
    rewardCoverage: level.features.includes("gems")
      ? level.metrics.gems / Math.max(1, level.metrics.platforms)
      : 1,
    enclosureRatio: level.metrics.coveredRatio,
    roomCount: level.metrics.rooms,
  };
  const targets = {
    balanced: { leniency: 0.72, density: 0.22, verticality: 0.5 },
    flow: { leniency: 0.9, density: 0.16, verticality: 0.3 },
    exploration: { leniency: 0.58, density: 0.28, verticality: 0.75 },
  }[profile];
  const components = {
    validity: validateGeneratedLevel(level).length === 0 ? 1 : 0,
    leniency: targetScore(clamp01(1 - metrics.gapRatio / 0.16), targets.leniency, 0.45),
    pacing: targetScore(metrics.eventDensity, targets.density, 0.22),
    verticality: targetScore(clamp01(metrics.verticalRange / 6), targets.verticality, 0.55),
    variety: clamp01(metrics.columnVariety * 3),
    rhythm: metrics.rhythmEntropy,
    rewards: clamp01(metrics.rewardCoverage),
    composition:
      targetScore(
        metrics.enclosureRatio,
        level.layout === "surface" ? 0 : level.layout === "tunnel" ? 0.92 : 0.55,
        level.layout === "surface" ? 0.2 : 0.5,
      ) * (level.layout === "surface" ? 1 : clamp01(metrics.roomCount / 2)),
  };
  const weights = {
    validity: 3,
    leniency: 1.2,
    pacing: 1.2,
    verticality: 0.9,
    variety: 1,
    rhythm: 0.8,
    rewards: 0.7,
    composition: 1,
  };
  const weighted = Object.entries(weights).reduce(
    (sum, [name, weight]) => sum + components[name as keyof typeof components] * weight,
    0,
  );
  return {
    total: weighted / Object.values(weights).reduce((sum, weight) => sum + weight, 0),
    profile,
    metrics,
    components,
  };
}

export interface OptimizedLevel {
  seed: string;
  difficulty: number;
  level: GeneratedLevel;
  score: LevelScore;
  fitness: number;
}

const preferenceFeatures = [
  "gapRatio",
  "eventDensity",
  "verticalRange",
  "columnVariety",
  "rhythmEntropy",
  "rewardCoverage",
] as const;

export interface PreferenceModel {
  version: 1;
  samples: number;
  ridge: number;
  features: readonly string[];
  means: number[];
  scales: number[];
  weights: number[];
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-12) continue;
    for (let index = column; index <= size; index++) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index++) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row, index) =>
    Number.isFinite(row[size]) ? row[size] : index === 0 ? 0.5 : 0,
  );
}

/** Fit a small ridge-regression preference model from human or agent ratings. */
export function trainPreferenceModel(
  rows: { metrics: LevelScore["metrics"]; rating: number | null }[],
  ridge = 0.1,
): PreferenceModel {
  const labeled = rows.filter(
    (row): row is { metrics: LevelScore["metrics"]; rating: number } =>
      typeof row.rating === "number" && Number.isFinite(row.rating),
  );
  if (labeled.length < 3) throw new Error("training needs at least 3 labeled rows");
  const vectors = labeled.map((row) => preferenceFeatures.map((name) => row.metrics[name]));
  const means = preferenceFeatures.map(
    (_, column) => vectors.reduce((sum, vector) => sum + vector[column], 0) / vectors.length,
  );
  const scales = preferenceFeatures.map((_, column) => {
    const variance =
      vectors.reduce((sum, vector) => sum + (vector[column] - means[column]) ** 2, 0) /
      vectors.length;
    return Math.sqrt(variance) || 1;
  });
  const inputs = vectors.map((vector) => [
    1,
    ...vector.map((value, column) => (value - means[column]) / scales[column]),
  ]);
  const size = preferenceFeatures.length + 1;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const values = Array<number>(size).fill(0);
  for (let row = 0; row < inputs.length; row++) {
    for (let x = 0; x < size; x++) {
      values[x] += inputs[row][x] * labeled[row].rating;
      for (let y = 0; y < size; y++) matrix[x][y] += inputs[row][x] * inputs[row][y];
    }
  }
  for (let index = 1; index < size; index++) matrix[index][index] += ridge;
  return {
    version: 1,
    samples: labeled.length,
    ridge,
    features: preferenceFeatures,
    means,
    scales,
    weights: solveLinearSystem(matrix, values),
  };
}

export function predictPreference(model: PreferenceModel, metrics: LevelScore["metrics"]): number {
  const standardized = preferenceFeatures.map(
    (name, index) => (metrics[name] - model.means[index]) / model.scales[index],
  );
  return clamp01(
    model.weights[0] +
      standardized.reduce((sum, value, index) => sum + value * model.weights[index + 1], 0),
  );
}

/** Search-based PCG retaining the best candidate in each behavior bin. */
export function optimizeLevels(options: {
  seed?: string;
  count?: number;
  width?: number;
  height?: number;
  layout?: GeneratedLayout;
  profile?: LevelScoreProfile;
  features?: readonly GeneratedFeature[];
  model?: PreferenceModel;
  abilities?: Partial<GeneratedAbilities>;
}): { best: OptimizedLevel; elites: OptimizedLevel[]; evaluated: OptimizedLevel[] } {
  const count = options.count ?? 200;
  if (!Number.isInteger(count) || count < 2 || count > 10_000) {
    throw new Error("count must be an integer from 2 to 10000");
  }
  const archive = new Map<string, OptimizedLevel>();
  const evaluated: OptimizedLevel[] = [];
  let best: OptimizedLevel | undefined;
  for (let index = 0; index < count; index++) {
    const difficulty = index / (count - 1);
    const seed = `${options.seed ?? "search"}:${index}`;
    const level = generateLevel({
      seed,
      width: options.width,
      height: options.height,
      layout: options.layout,
      difficulty,
      features: options.features,
      abilities: options.abilities,
    });
    const candidate = {
      seed,
      difficulty,
      level,
      score: scoreGeneratedLevel(level, options.profile),
      fitness: 0,
    };
    candidate.fitness = options.model
      ? predictPreference(options.model, candidate.score.metrics)
      : candidate.score.total;
    evaluated.push(candidate);
    if (!best || candidate.fitness > best.fitness) best = candidate;
    const verticalBin = Math.min(3, Math.floor(candidate.score.metrics.verticalRange / 2));
    const densityBin = Math.min(3, Math.floor(candidate.score.metrics.eventDensity * 12));
    const bin = `${candidate.level.layout}:${verticalBin}:${densityBin}`;
    const previous = archive.get(bin);
    if (!previous || candidate.fitness > previous.fitness) archive.set(bin, candidate);
  }
  return {
    best: best!,
    elites: [...archive.values()].sort((a, b) => b.fitness - a.fitness),
    evaluated,
  };
}

interface LDtkEntity {
  __identifier: string;
  iid?: string;
  px: [number, number];
  width: number;
  height: number;
  fieldInstances?: { __identifier: string; __value: unknown }[];
}

interface LDtkLayer {
  __identifier: string;
  __gridSize: number;
  __cWid: number;
  __cHei: number;
  __tilesetDefUid?: number | null;
  entityInstances?: LDtkEntity[];
  gridTiles?: { px: [number, number]; src: [number, number] }[];
  autoLayerTiles?: { px: [number, number]; src: [number, number] }[];
}

interface LDtkCheckProject {
  defs?: {
    entities?: { identifier: string; tags?: string[] }[];
    tilesets?: { uid: number; pxWid: number; pxHei: number; tileGridSize: number }[];
  };
  levels?: {
    identifier: string;
    pxWid: number;
    pxHei: number;
    layerInstances?: LDtkLayer[] | null;
  }[];
}

export interface LevelCheckOptions {
  spawn?: string;
  targets?: string[];
  jumpX?: number;
  jumpUp?: number;
  fall?: number;
  portalBoundaries?: boolean;
  reciprocalPortals?: boolean;
}

export interface LevelCheckResult {
  errors: string[];
  warnings: string[];
  levels: number;
  targets: number;
  report: string[];
}

function repeatedOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  for (;;) {
    const value = takeOption(args, name);
    if (value === undefined) return values;
    values.push(value);
  }
}

function takeGeneratedFeatures(args: string[]): GeneratedFeature[] {
  const featureList = takeOption(args, "--features");
  const without = repeatedOptions(args, "--without");
  if (featureList && without.length) throw new Error("--features and --without cannot be combined");
  const requested = (featureList ? featureList.split(",") : generatedFeatures).filter(
    (feature) => !without.includes(feature),
  );
  for (const feature of requested) {
    if (!(generatedFeatures as readonly string[]).includes(feature)) {
      throw new Error(
        `unknown level feature "${feature}" (choose from ${generatedFeatures.join(", ")})`,
      );
    }
  }
  return requested as GeneratedFeature[];
}

function takeGeneratedAbilities(args: string[]): GeneratedAbilities {
  return {
    dash: takeFlag(args, "--dash"),
    doubleJump: takeFlag(args, "--double-jump"),
    wallJump: takeFlag(args, "--wall-jump"),
  };
}

function takeGeneratedLayout(args: string[]): GeneratedLayout | undefined {
  const layout = takeOption(args, "--layout") ?? "varied";
  if (layout === "varied") return undefined;
  if (layout === "surface" || layout === "tunnel" || layout === "mixed") return layout;
  throw new Error('--layout must be "varied", "surface", "tunnel", or "mixed"');
}

function takeScoreProfile(args: string[]): LevelScoreProfile {
  const profile = takeOption(args, "--profile") ?? "balanced";
  if (profile !== "balanced" && profile !== "flow" && profile !== "exploration") {
    throw new Error('--profile must be "balanced", "flow", or "exploration"');
  }
  return profile;
}

/** Validate any entity-authored LDtk platformer against a movement envelope. */
export function checkLevelProject(
  project: LDtkCheckProject,
  options: LevelCheckOptions = {},
): LevelCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const report: string[] = [];
  const spawnType = options.spawn ?? "Player";
  const targetTypes = new Set(options.targets ?? ["Gem"]);
  const jumpX = options.jumpX ?? 3;
  const jumpUp = options.jumpUp ?? 2;
  const fall = options.fall ?? 4;
  const definitions = new Map(
    (project.defs?.entities ?? []).map((definition) => [
      definition.identifier,
      definition.tags ?? [],
    ]),
  );
  const tilesets = new Map((project.defs?.tilesets ?? []).map((tileset) => [tileset.uid, tileset]));
  const portalIds = new Map<string, { level: string; target?: string }>();
  let targetCount = 0;

  for (const level of project.levels ?? []) {
    const layers = level.layerInstances ?? [];
    const world = layers.find((layer) => layer.__identifier === "World");
    const art = layers.find((layer) => layer.__identifier === "Art");
    if (!world) {
      errors.push(`${level.identifier}: missing World layer`);
      continue;
    }
    const grid = world.__gridSize;
    const width = world.__cWid;
    const height = world.__cHei;
    const entities = layers.flatMap((layer) => layer.entityInstances ?? []);
    const tags = (entity: LDtkEntity) => definitions.get(entity.__identifier) ?? [];
    const has = (entity: LDtkEntity, tag: string) => tags(entity).includes(tag);
    const supports = new Set<string>();
    const ladders = new Set<string>();
    const key = (x: number, y: number) => `${x},${y}`;
    const cell = (value: number) => value / grid;
    const countTag = (tag: string) => entities.filter((entity) => has(entity, tag)).length;

    for (const entity of entities) {
      const entityTags = tags(entity);
      const gameplay =
        entityTags.some((tag) => tag.startsWith("mm:")) && !entityTags.includes("mm:sprite");
      if (
        gameplay &&
        [entity.px[0], entity.px[1], entity.width, entity.height].some(
          (value) => value % grid !== 0,
        )
      ) {
        errors.push(`${level.identifier}/${entity.__identifier}: geometry is not grid-aligned`);
      }
      const x = cell(entity.px[0]);
      const y = cell(entity.px[1]);
      const w = cell(entity.width);
      const h = cell(entity.height);
      if (gameplay && (x < 0 || y < 0 || x + w > width || y + h > height)) {
        errors.push(`${level.identifier}/${entity.__identifier}: leaves level bounds`);
      }
      if (has(entity, "mm:solid") || has(entity, "mm:one-way")) {
        for (let cy = y; cy < y + h; cy++) {
          for (let cx = x; cx < x + w; cx++) supports.add(key(cx, cy));
        }
      }
      if (has(entity, "mm:one-way") && w < 3) {
        errors.push(
          `${level.identifier}/${entity.__identifier}@${x},${y}: platform is under 3 tiles`,
        );
      }
      if (has(entity, "mm:ladder")) {
        if (h < 3) {
          errors.push(
            `${level.identifier}/${entity.__identifier}@${x},${y}: ladder is under 3 tiles`,
          );
        }
        for (let cy = y; cy < y + h; cy++) ladders.add(key(x, cy));
      }
      if (has(entity, "mm:portal") && entity.iid) {
        const reference = entity.fieldInstances?.find((field) => field.__identifier === "To")
          ?.__value as { entityIid?: unknown } | null | undefined;
        portalIds.set(entity.iid, {
          level: level.identifier,
          target:
            reference && typeof reference.entityIid === "string" ? reference.entityIid : undefined,
        });
        if (options.portalBoundaries) {
          const distance = Math.min(x, width - x - w);
          if (distance > 1) {
            errors.push(`${level.identifier}/${entity.__identifier}@${x},${y}: not at a boundary`);
          }
        }
      }
    }

    for (const entity of entities.filter((candidate) => has(candidate, "mm:ladder"))) {
      const x = cell(entity.px[0]);
      const y = cell(entity.px[1]);
      if (!supports.has(key(x, y - 1))) {
        errors.push(
          `${level.identifier}/${entity.__identifier}@${x},${y}: no readable top landing`,
        );
      }
    }

    if (art) {
      const tileset =
        art.__tilesetDefUid === null || art.__tilesetDefUid === undefined
          ? undefined
          : tilesets.get(art.__tilesetDefUid);
      if (!tileset) errors.push(`${level.identifier}/Art: missing tileset definition`);
      for (const tile of [...(art.autoLayerTiles ?? []), ...(art.gridTiles ?? [])]) {
        if (
          tile.px[0] % art.__gridSize !== 0 ||
          tile.px[1] % art.__gridSize !== 0 ||
          tile.src[0] % art.__gridSize !== 0 ||
          tile.src[1] % art.__gridSize !== 0
        ) {
          errors.push(`${level.identifier}/Art: tile is not grid-aligned`);
          break;
        }
        if (
          tileset &&
          (tile.src[0] < 0 ||
            tile.src[1] < 0 ||
            tile.src[0] + tileset.tileGridSize > tileset.pxWid ||
            tile.src[1] + tileset.tileGridSize > tileset.pxHei)
        ) {
          errors.push(`${level.identifier}/Art: tile source leaves the tileset`);
          break;
        }
      }
    } else {
      warnings.push(`${level.identifier}: missing Art layer`);
    }

    const nodes = new Map<string, { x: number; y: number }>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (
          !supports.has(key(x, y)) &&
          (ladders.has(key(x, y)) ||
            supports.has(key(x, y + 1)) ||
            supports.has(key(x - 1, y)) ||
            supports.has(key(x + 1, y)))
        ) {
          nodes.set(key(x, y), { x, y });
        }
      }
    }
    const spawns = entities.filter((entity) => entity.__identifier === spawnType);
    if (spawns.length !== 1) {
      errors.push(`${level.identifier}: expected exactly one ${spawnType} marker`);
      continue;
    }
    const start = key(cell(spawns[0].px[0]), cell(spawns[0].px[1]));
    if (!nodes.has(start)) {
      errors.push(`${level.identifier}/${spawnType}: not on a navigable surface`);
      continue;
    }
    const reached = new Set([start]);
    const pending = [start];
    while (pending.length) {
      const current = nodes.get(pending.pop()!);
      if (!current) continue;
      for (const [candidateKey, candidate] of nodes) {
        if (reached.has(candidateKey)) continue;
        const dx = Math.abs(candidate.x - current.x);
        const rise = current.y - candidate.y;
        const drop = candidate.y - current.y;
        if (dx <= jumpX && rise <= jumpUp && drop <= fall) {
          reached.add(candidateKey);
          pending.push(candidateKey);
        }
      }
    }
    const targets = entities.filter(
      (candidate) => targetTypes.has(candidate.__identifier) || has(candidate, "mm:portal"),
    );
    for (const entity of targets) {
      targetCount++;
      const x = cell(entity.px[0]);
      const y = cell(entity.px[1]) + (has(entity, "mm:portal") ? cell(entity.height) - 1 : 0);
      if (!reached.has(key(x, y))) {
        errors.push(
          `${level.identifier}/${entity.__identifier}@${x},${cell(entity.px[1])}: unreachable`,
        );
      }
    }
    const artTiles = (art?.autoLayerTiles?.length ?? 0) + (art?.gridTiles?.length ?? 0);
    report.push(
      [
        `${level.identifier}: ${width}×${height} tiles @ ${grid}px`,
        `  spawn: ${spawnType} at (${cell(spawns[0].px[0])},${cell(spawns[0].px[1])})`,
        `  geometry: ${countTag("mm:solid")} solid, ${countTag("mm:one-way")} one-way, ${countTag("mm:ladder")} ladder, ${countTag("mm:portal")} portal`,
        `  navigation: ${reached.size}/${nodes.size} nodes reachable; ${targets.length} targets checked`,
        `  art: ${artTiles} aligned tiles`,
      ].join("\n"),
    );
  }

  if (options.reciprocalPortals) {
    for (const [id, portal] of portalIds) {
      const target = portal.target && portalIds.get(portal.target);
      if (!target || target.target !== id) {
        errors.push(`${portal.level}/Portal ${id}: link is not reciprocal`);
      }
    }
  }
  return { errors, warnings, levels: project.levels?.length ?? 0, targets: targetCount, report };
}

function ascii(level: GeneratedLevel, trace: boolean): string {
  const render = (name: string, grid: string[]) => `# ${name}\n${grid.join("\n")}`;
  if (trace) {
    return `${level.stages.map((stage) => render(stage.name, stage.grid)).join("\n\n")}\n`;
  }
  return `${render(
    `${level.seed} · ${level.layout} · rooms ${level.metrics.rooms} · gaps ${level.metrics.gaps} · platforms ${level.metrics.platforms}`,
    level.grid,
  )}\n`;
}

export default defineFeature({
  name: "level",
  summary: "Generate, bot-test, score, or verify platformer greyboxes.",
  usage: [
    "mm level test [--port <port>]",
    "mm level simulate [--levels <n>] [--rounds <n>] [--bots <n>] [--attempts <n>]",
    "mm level evolve [--population <n>] [--generations <n>] [--tree <file>]",
    "mm level generate [--seed <text>] [--json] [--trace]",
    "mm level check <project.ldtk> [--portal-boundaries]",
  ],
  async run(input) {
    if (input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    const args = [...input];
    const command = args.shift();
    if (command === "test") {
      const host = takeOption(args, "--host") ?? "127.0.0.1";
      const port = numberOption(args, 4177, "--port");
      const ratingsPath = resolve(
        takeOption(args, "--ratings") ?? ".minimotor/level-tester-ratings.jsonl",
      );
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--port must be an integer from 1 to 65535");
      }
      const { startStandaloneLevelTester } = await import("@src/cli/level-tester/standalone.js");
      const tester = await startStandaloneLevelTester({ host, port, ratingsPath });
      process.stdout.write(
        `Level tester: ${tester.url}\nRatings: ${ratingsPath}\nPress Ctrl+C to stop.\n`,
      );
      await new Promise<void>((resolveStop) => {
        process.once("SIGINT", resolveStop);
        process.once("SIGTERM", resolveStop);
      });
      await tester.close();
      return;
    }
    if (command === "simulate") {
      const seed = takeOption(args, "--seed") ?? "bot-search";
      const levels = numberOption(args, 6, "--levels");
      const rounds = numberOption(args, 1, "--rounds");
      const bots = numberOption(args, 8, "--bots");
      const attempts = numberOption(args, 3, "--attempts");
      const maxSteps = numberOption(args, 1_500, "--max-steps");
      const width = numberOption(args, 48, "--width");
      const height = numberOption(args, 22, "--height");
      const difficulty = numberOption(args, 0.45, "--difficulty");
      const profile = takeScoreProfile(args);
      const abilities = takeGeneratedAbilities(args);
      const layout = takeGeneratedLayout(args);
      const features = takeGeneratedFeatures(args);
      const output = takeOption(args, "-o", "--out");
      const dataset = takeOption(args, "--dataset");
      const reportPath = takeOption(args, "--report");
      const replay = takeOption(args, "--replay");
      const json = takeFlag(args, "--json");
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      for (const [name, value, maximum] of [
        ["--levels", levels, 100],
        ["--rounds", rounds, 100],
        ["--bots", bots, 100],
        ["--attempts", attempts, 100],
        ["--max-steps", maxSteps, 20_000],
      ] as const) {
        if (!Number.isInteger(value) || value < 1 || value > maximum) {
          throw new Error(`${name} must be an integer from 1 to ${maximum}`);
        }
      }
      if (levels * rounds > 1_000) {
        throw new Error("--levels × --rounds cannot exceed 1000 candidates");
      }
      if (levels * rounds * bots * attempts > 200_000) {
        throw new Error("candidate × bot × attempt count cannot exceed 200000 episodes");
      }
      if (!features.includes("exit")) throw new Error("bot simulation requires the exit feature");
      const { evaluateLevelWithBots } = await import("@src/cli/level-tester/bots.js");
      const evaluated: {
        seed: string;
        round: number;
        difficulty: number;
        level: GeneratedLevel;
        heuristic: LevelScore;
        bot: ReturnType<typeof evaluateLevelWithBots>;
        fitness: number;
      }[] = [];
      const roundReports: { round: number; difficulty: number; successRate: number }[] = [];
      let adaptiveDifficulty = difficulty;
      for (let round = 0; round < rounds; round++) {
        const roundCandidates = Array.from({ length: levels }, (_, index) => {
          const candidateSeed = `${seed}:r${round}:${index}`;
          const level = generateLevel({
            seed: candidateSeed,
            width,
            height,
            difficulty: adaptiveDifficulty,
            layout,
            features,
            abilities,
          });
          const heuristic = scoreGeneratedLevel(level, profile);
          const bot = evaluateLevelWithBots(level, {
            bots,
            attempts,
            maxSteps,
            seed: candidateSeed,
          });
          return {
            seed: candidateSeed,
            round,
            difficulty: adaptiveDifficulty,
            level,
            heuristic,
            bot,
            fitness: heuristic.total * 0.35 + bot.score * 0.65,
          };
        });
        evaluated.push(...roundCandidates);
        const successRate =
          roundCandidates.reduce((sum, candidate) => sum + candidate.bot.metrics.successRate, 0) /
          roundCandidates.length;
        roundReports.push({ round, difficulty: adaptiveDifficulty, successRate });
        if (successRate > 0.75) adaptiveDifficulty = Math.min(1, adaptiveDifficulty + 0.1);
        else if (successRate < 0.35) {
          adaptiveDifficulty = Math.max(0, adaptiveDifficulty - 0.1);
        }
      }
      evaluated.sort(
        (a, b) => Number(b.bot.passed) - Number(a.bot.passed) || b.fitness - a.fitness,
      );
      const best = evaluated.find((candidate) => candidate.bot.passed);
      const report = {
        seed,
        candidates: levels * rounds,
        levelsPerRound: levels,
        rounds: roundReports,
        bots,
        attempts,
        passed: evaluated.filter((candidate) => candidate.bot.passed).length,
        best: best
          ? {
              seed: best.seed,
              layout: best.level.layout,
              difficulty: best.difficulty,
              fitness: best.fitness,
              heuristicScore: best.heuristic.total,
              botScore: best.bot.score,
              metrics: best.bot.metrics,
              planner: {
                completed: best.bot.planner.completed,
                expanded: best.bot.planner.expanded,
                commands: best.bot.planner.commands.length,
              },
            }
          : null,
        results: evaluated.map((candidate) => ({
          seed: candidate.seed,
          layout: candidate.level.layout,
          difficulty: candidate.difficulty,
          passed: candidate.bot.passed,
          fitness: candidate.fitness,
          heuristicScore: candidate.heuristic.total,
          botScore: candidate.bot.score,
          metrics: candidate.bot.metrics,
          planner: {
            completed: candidate.bot.planner.completed,
            progress: candidate.bot.planner.progress,
            expanded: candidate.bot.planner.expanded,
          },
        })),
      };
      if (json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `Bot-tested ${levels * rounds} candidates across ${rounds} round${rounds === 1 ? "" : "s"} with ${bots} bots × ${attempts} attempts.`,
            ...roundReports.map(
              (round) =>
                `Round ${round.round + 1}: difficulty=${round.difficulty.toFixed(2)} mean-success=${round.successRate.toFixed(2)}`,
            ),
            `Passed: ${report.passed}/${levels * rounds}`,
            ...report.results.map(
              (candidate, index) =>
                `${index + 1}. ${candidate.seed} [${candidate.layout}] ${candidate.passed ? "PASS" : "FAIL"} fitness=${candidate.fitness.toFixed(4)} bots=${candidate.botScore.toFixed(4)} success=${candidate.metrics.successRate.toFixed(2)} expert=${candidate.metrics.expertSuccessRate.toFixed(2)} mid=${candidate.metrics.intermediateSuccessRate.toFixed(2)} beginner=${candidate.metrics.beginnerSuccessRate.toFixed(2)} progress=${candidate.metrics.meanProgress.toFixed(2)} stuck=${candidate.metrics.stuckRate.toFixed(2)}`,
            ),
          ].join("\n") + "\n",
        );
      }
      if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      if (dataset) {
        writeFileSync(
          dataset,
          `${evaluated
            .map((candidate) =>
              JSON.stringify({
                seed: candidate.seed,
                round: candidate.round,
                difficulty: candidate.difficulty,
                layout: candidate.level.layout,
                features: candidate.level.features,
                abilities: candidate.level.abilities,
                passed: candidate.bot.passed,
                fitness: candidate.fitness,
                heuristicScore: candidate.heuristic.total,
                heuristicMetrics: candidate.heuristic.metrics,
                botScore: candidate.bot.score,
                botMetrics: candidate.bot.metrics,
              }),
            )
            .join("\n")}\n`,
        );
      }
      if (output) {
        if (!best) throw new Error("no generated candidate passed bot evaluation");
        writeFileSync(output, `${JSON.stringify(generatedDesign(best.level), null, 2)}\n`);
      }
      if (replay) {
        if (!best) throw new Error("no generated candidate passed bot evaluation");
        writeFileSync(
          replay,
          `${JSON.stringify(
            {
              version: 1,
              seed: best.seed,
              abilities: best.level.abilities,
              commands: best.bot.planner.commands,
              stats: best.bot.planner.stats,
            },
            null,
            2,
          )}\n`,
        );
      }
      return;
    }
    if (command === "evolve") {
      const seed = takeOption(args, "--seed") ?? "evolution";
      const population = numberOption(args, 16, "--population");
      const generations = numberOption(args, 4, "--generations");
      const mutation = numberOption(args, 0.18, "--mutation");
      const objective = takeOption(args, "--objective") ?? "balanced";
      const bots = numberOption(args, 8, "--bots");
      const attempts = numberOption(args, 2, "--attempts");
      const maxSteps = numberOption(args, 1_800, "--max-steps");
      const width = numberOption(args, 48, "--width");
      const height = numberOption(args, 22, "--height");
      const difficulty = numberOption(args, 0.45, "--difficulty");
      const profile = takeScoreProfile(args);
      const abilities = takeGeneratedAbilities(args);
      const layout = takeGeneratedLayout(args);
      const features = takeGeneratedFeatures(args);
      const output = takeOption(args, "-o", "--out");
      const treePath = takeOption(args, "--tree");
      const reportPath = takeOption(args, "--report");
      const archivePath = takeOption(args, "--archive");
      const keep = numberOption(args, 16, "--keep");
      const json = takeFlag(args, "--json");
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      if (objective !== "balanced" && objective !== "complex") {
        throw new Error('--objective must be "balanced" or "complex"');
      }
      if (!Number.isInteger(keep) || keep < 1 || keep > 256) {
        throw new Error("--keep must be an integer from 1 to 256");
      }
      if (!features.includes("exit")) throw new Error("evolution requires the exit feature");
      const { evolveLevels } = await import("@src/cli/level-tester/tournament.js");
      const result = evolveLevels({
        seed,
        population,
        generations,
        mutation,
        bots,
        attempts,
        maxSteps,
        width,
        height,
        difficulty,
        profile,
        abilities,
        layout,
        features,
        objective,
      });
      const report = {
        ...result.options,
        champion: {
          id: result.champion.id,
          seed: result.champion.seed,
          generation: result.champion.generation,
          layout: result.champion.level.layout,
          difficulty: result.champion.difficulty,
          fitness: result.champion.fitness,
          complexity: result.champion.complexity,
          passed: result.champion.bot.passed,
          heuristic: result.champion.heuristic,
          botMetrics: result.champion.bot.metrics,
        },
        generationChampions: result.generationChampions.map((candidate) => ({
          id: candidate.id,
          seed: candidate.seed,
          generation: candidate.generation,
          parentId: candidate.parentId,
          layout: candidate.level.layout,
          difficulty: candidate.difficulty,
          fitness: candidate.fitness,
          complexity: candidate.complexity,
          passed: candidate.bot.passed,
        })),
        candidates: result.candidates.map((candidate) => ({
          id: candidate.id,
          parentId: candidate.parentId,
          seed: candidate.seed,
          generation: candidate.generation,
          layout: candidate.level.layout,
          difficulty: candidate.difficulty,
          fitness: candidate.fitness,
          complexity: candidate.complexity,
          heuristicScore: candidate.heuristic.total,
          botScore: candidate.bot.score,
          passed: candidate.bot.passed,
          rooms: candidate.level.metrics.rooms,
          gaps: candidate.level.metrics.gaps,
        })),
        matches: result.matches,
      };
      process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : result.tree);
      if (treePath) writeFileSync(treePath, result.tree);
      if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      if (archivePath) {
        mkdirSync(archivePath, { recursive: true });
        const seen = new Set<string>();
        const distinct = [...result.candidates]
          .sort(
            (left, right) =>
              Number(right.bot.passed) - Number(left.bot.passed) || right.fitness - left.fitness,
          )
          .filter((candidate) => {
            if (seen.has(candidate.seed)) return false;
            seen.add(candidate.seed);
            return true;
          });
        const layoutQuota = Math.floor(keep / 3);
        const retained = (["surface", "tunnel", "mixed"] as const).flatMap((layout) =>
          distinct.filter((candidate) => candidate.level.layout === layout).slice(0, layoutQuota),
        );
        const retainedSeeds = new Set(retained.map((candidate) => candidate.seed));
        retained.push(
          ...distinct
            .filter((candidate) => !retainedSeeds.has(candidate.seed))
            .slice(0, keep - retained.length),
        );
        retained.sort(
          (left, right) =>
            Number(right.bot.passed) - Number(left.bot.passed) || right.fitness - left.fitness,
        );
        retained.forEach((candidate, index) => {
          const name = `${String(index + 1).padStart(3, "0")}-${candidate.id}`;
          writeFileSync(
            resolve(archivePath, `${name}.json`),
            `${JSON.stringify(generatedDesign(candidate.level, candidate.id), null, 2)}\n`,
          );
          writeFileSync(resolve(archivePath, `${name}.txt`), ascii(candidate.level, false));
        });
        writeFileSync(
          resolve(archivePath, "manifest.json"),
          `${JSON.stringify(
            retained.map((candidate, index) => ({
              rank: index + 1,
              id: candidate.id,
              parentId: candidate.parentId,
              seed: candidate.seed,
              layout: candidate.level.layout,
              difficulty: candidate.difficulty,
              fitness: candidate.fitness,
              complexity: candidate.complexity,
              passed: candidate.bot.passed,
              botMetrics: candidate.bot.metrics,
            })),
            null,
            2,
          )}\n`,
        );
      }
      if (output) {
        if (!result.champion.bot.passed) {
          throw new Error("no evolved candidate passed bot evaluation");
        }
        writeFileSync(output, `${JSON.stringify(result.design, null, 2)}\n`);
      }
      return;
    }
    if (command === "train") {
      const datasetPath = args.shift();
      if (!datasetPath || datasetPath.startsWith("-")) {
        throw new Error("mm level train needs a ratings JSONL file");
      }
      const output = takeOption(args, "-o", "--out");
      const ridge = numberOption(args, 0.1, "--ridge");
      if (!output) throw new Error("mm level train needs --out");
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      const rows = readFileSync(datasetPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map(
          (line) => JSON.parse(line) as { metrics: LevelScore["metrics"]; rating: number | null },
        );
      const model = trainPreferenceModel(rows, ridge);
      writeFileSync(output, `${JSON.stringify(model, null, 2)}\n`);
      process.stdout.write(`trained: ${output} (${model.samples} labeled levels)\n`);
      return;
    }
    if (command === "score") {
      const seed = takeOption(args, "--seed") ?? "score";
      const width = numberOption(args, 48, "--width");
      const height = numberOption(args, 22, "--height");
      const difficulty = numberOption(args, 0.45, "--difficulty");
      const profile = takeScoreProfile(args);
      const abilities = takeGeneratedAbilities(args);
      const layout = takeGeneratedLayout(args);
      const modelPath = takeOption(args, "--model");
      const features = takeGeneratedFeatures(args);
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      const level = generateLevel({
        seed,
        width,
        height,
        difficulty,
        layout,
        features,
        abilities,
      });
      const score = scoreGeneratedLevel(level, profile);
      process.stdout.write(
        `${JSON.stringify(
          {
            seed,
            difficulty,
            ...score,
            ...(modelPath
              ? {
                  predictedRating: predictPreference(
                    JSON.parse(readFileSync(modelPath, "utf8")) as PreferenceModel,
                    score.metrics,
                  ),
                }
              : {}),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    if (command === "optimize") {
      const seed = takeOption(args, "--seed") ?? "search";
      const count = numberOption(args, 200, "--count");
      const width = numberOption(args, 48, "--width");
      const height = numberOption(args, 22, "--height");
      const top = numberOption(args, 8, "--top");
      const output = takeOption(args, "-o", "--out");
      const dataset = takeOption(args, "--dataset");
      const modelPath = takeOption(args, "--model");
      const profile = takeScoreProfile(args);
      const abilities = takeGeneratedAbilities(args);
      const layout = takeGeneratedLayout(args);
      const features = takeGeneratedFeatures(args);
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      const model = modelPath
        ? (JSON.parse(readFileSync(modelPath, "utf8")) as PreferenceModel)
        : undefined;
      const result = optimizeLevels({
        seed,
        count,
        width,
        height,
        layout,
        profile,
        features,
        model,
        abilities,
      });
      const shown = result.elites.slice(0, Math.max(1, top));
      process.stdout.write(
        [
          `Evaluated ${result.evaluated.length} candidates; retained ${result.elites.length} behavior elites.`,
          ...shown.map(
            (candidate, index) =>
              `${index + 1}. ${candidate.seed} [${candidate.level.layout}] fitness=${candidate.fitness.toFixed(4)} heuristic=${candidate.score.total.toFixed(4)} difficulty=${candidate.difficulty.toFixed(3)} vertical=${candidate.score.metrics.verticalRange} density=${candidate.score.metrics.eventDensity.toFixed(3)}`,
          ),
        ].join("\n") + "\n",
      );
      if (output) {
        writeFileSync(output, `${JSON.stringify(generatedDesign(result.best.level), null, 2)}\n`);
      }
      if (dataset) {
        const rows = result.evaluated.map((candidate) =>
          JSON.stringify({
            seed: candidate.seed,
            difficulty: candidate.difficulty,
            layout: candidate.level.layout,
            features: candidate.level.features,
            abilities: candidate.level.abilities,
            profile,
            heuristicScore: candidate.score.total,
            fitness: candidate.fitness,
            metrics: candidate.score.metrics,
            components: candidate.score.components,
            rating: null,
          }),
        );
        writeFileSync(dataset, `${rows.join("\n")}\n`);
      }
      return;
    }
    if (command === "build") {
      const designPath = args.shift();
      if (!designPath || designPath.startsWith("-")) {
        throw new Error("mm level build needs a design JSON or module");
      }
      const skinPath = takeOption(args, "--skin");
      const templatePath = takeOption(args, "--template");
      const output = takeOption(args, "-o", "--out");
      const check = takeFlag(args, "--check");
      if (!skinPath || !templatePath || !output) {
        throw new Error("mm level build needs --skin, --template, and --out");
      }
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      const load = async (path: string) =>
        (await import(pathToFileURL(resolve(path)).href)) as {
          default?: unknown;
          design?: unknown;
          buildProject?: (template: unknown, design: unknown) => unknown;
        };
      const design = designPath.endsWith(".json")
        ? (JSON.parse(readFileSync(designPath, "utf8")) as unknown)
        : await load(designPath).then((module) => module.design ?? module.default);
      if (!design) throw new Error(`${designPath} must export design or a default design`);
      const skin = await load(skinPath);
      if (typeof skin.buildProject !== "function") {
        throw new Error(`${skinPath} must export buildProject(template, design)`);
      }
      const template = JSON.parse(readFileSync(templatePath, "utf8")) as LDtkCheckProject;
      const content = `${JSON.stringify(skin.buildProject(template, design), null, 2)}\n`;
      if (check) {
        if (readFileSync(output, "utf8") !== content) {
          throw new Error(`${output} is stale; run mm level build without --check`);
        }
        process.stdout.write(`up to date: ${output}\n`);
      } else {
        writeFileSync(output, content);
        process.stdout.write(`generated: ${output}\n`);
      }
      return;
    }
    if (command === "check") {
      const path = args.shift();
      if (!path || path.startsWith("-")) throw new Error("mm level check needs an LDtk project");
      const spawn = takeOption(args, "--spawn") ?? "Player";
      const targets = repeatedOptions(args, "--target");
      const jumpX = numberOption(args, 3, "--jump-x");
      const jumpUp = numberOption(args, 2, "--jump-up");
      const fall = numberOption(args, 4, "--fall");
      const portalBoundaries = takeFlag(args, "--portal-boundaries");
      const reciprocalPortals = takeFlag(args, "--reciprocal-portals");
      const verbose = takeFlag(args, "--verbose");
      if (args.length) throw new Error(`unknown option "${args[0]}"`);
      const project = JSON.parse(readFileSync(path, "utf8")) as LDtkCheckProject;
      const result = checkLevelProject(project, {
        spawn,
        targets: targets.length ? targets : ["Gem"],
        jumpX,
        jumpUp,
        fall,
        portalBoundaries,
        reciprocalPortals,
      });
      for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
      if (result.errors.length) throw new Error(result.errors.join("\n"));
      if (verbose) {
        process.stdout.write(
          `Movement envelope: ${jumpX} across, ${jumpUp} up, ${fall} down (tiles)\n${result.report.join("\n")}\n`,
        );
      }
      process.stdout.write(
        `valid: ${path} (${result.levels} levels, ${result.targets} reachable targets)\n`,
      );
      return;
    }
    if (command !== "generate") {
      throw new Error(
        "usage: mm level <test|simulate|evolve|generate|score|optimize|train|build|check> [options]",
      );
    }
    const seed = takeOption(args, "--seed") ?? "minimotor";
    const width = numberOption(args, 48, "--width");
    const height = numberOption(args, 22, "--height");
    const difficulty = numberOption(args, 0.45, "--difficulty");
    const abilities = takeGeneratedAbilities(args);
    const layout = takeGeneratedLayout(args);
    const requested = takeGeneratedFeatures(args);
    const json = takeFlag(args, "--json");
    const trace = takeFlag(args, "--trace");
    const output = takeOption(args, "-o", "--out");
    if (args.length) throw new Error(`unknown option "${args[0]}"`);
    const level = generateLevel({
      seed,
      width,
      height,
      difficulty,
      layout,
      features: requested,
      abilities,
    });
    const content = json
      ? `${JSON.stringify(generatedDesign(level), null, 2)}\n`
      : ascii(level, trace);
    if (output) writeFileSync(output, content);
    else process.stdout.write(content);
  },
});
