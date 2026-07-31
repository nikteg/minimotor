import {
  generateLevel,
  generatedDesign,
  scoreGeneratedLevel,
  type GeneratedAbilities,
  type GeneratedFeature,
  type GeneratedLayout,
  type GeneratedLevel,
  type LevelScore,
  type LevelScoreProfile,
  type NeutralLevelDesign,
} from "@src/cli/features/level.js";
import { evaluateLevelWithBots, type BotEvaluation } from "./bots.js";

export interface EvolutionOptions {
  seed?: string;
  population?: number;
  generations?: number;
  mutation?: number;
  width?: number;
  height?: number;
  difficulty?: number;
  layout?: GeneratedLayout;
  profile?: LevelScoreProfile;
  features?: readonly GeneratedFeature[];
  abilities?: Partial<GeneratedAbilities>;
  bots?: number;
  attempts?: number;
  maxSteps?: number;
  objective?: "balanced" | "complex";
}

export interface EvolutionCandidate {
  id: string;
  generation: number;
  parentId: string | null;
  seed: string;
  difficulty: number;
  level: GeneratedLevel;
  heuristic: LevelScore;
  bot: BotEvaluation;
  fitness: number;
  complexity: number;
}

export interface EvolutionMatch {
  generation: number;
  round: number;
  left: string;
  right: string;
  winner: string;
}

export interface EvolutionResult {
  options: {
    seed: string;
    population: number;
    generations: number;
    mutation: number;
    bots: number;
    attempts: number;
    maxSteps: number;
    objective: "balanced" | "complex";
  };
  candidates: EvolutionCandidate[];
  matches: EvolutionMatch[];
  generationChampions: EvolutionCandidate[];
  champion: EvolutionCandidate;
  tree: string;
  design: NeutralLevelDesign;
}

function randomSource(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function better(left: EvolutionCandidate, right: EvolutionCandidate): EvolutionCandidate {
  if (left.bot.passed !== right.bot.passed) return left.bot.passed ? left : right;
  if (left.fitness !== right.fitness) return left.fitness > right.fitness ? left : right;
  return left.id < right.id ? left : right;
}

function renderTree(
  candidates: EvolutionCandidate[],
  matches: EvolutionMatch[],
  champions: EvolutionCandidate[],
  champion: EvolutionCandidate,
): string {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const children = new Map<string, EvolutionCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.parentId) continue;
    const entries = children.get(candidate.parentId) ?? [];
    entries.push(candidate);
    children.set(candidate.parentId, entries);
  }
  const championIds = new Set(champions.map((candidate) => candidate.id));
  const label = (candidate: EvolutionCandidate) => {
    const parent = candidate.parentId ? byId.get(candidate.parentId) : undefined;
    const difference = parent ? candidate.fitness - parent.fitness : null;
    const delta =
      difference === null ? "" : ` delta=${difference >= 0 ? "+" : ""}${difference.toFixed(3)}`;
    const marker =
      candidate.id === champion.id
        ? " <CHAMPION>"
        : championIds.has(candidate.id)
          ? " <generation winner>"
          : "";
    return `${candidate.id} [${candidate.level.layout}] d=${candidate.difficulty.toFixed(2)} fit=${candidate.fitness.toFixed(3)} bot=${candidate.bot.score.toFixed(3)} complexity=${candidate.complexity.toFixed(2)} ${candidate.bot.passed ? "PASS" : "FAIL"} rooms=${candidate.level.metrics.rooms} gaps=${candidate.level.metrics.gaps}${delta}${marker}`;
  };

  const lines = ["EVOLUTION ANCESTRY"];
  const draw = (candidate: EvolutionCandidate, prefix: string, last: boolean) => {
    lines.push(`${prefix}${last ? "`-- " : "|-- "}${label(candidate)}`);
    const descendants = children.get(candidate.id) ?? [];
    descendants.forEach((child, index) =>
      draw(child, `${prefix}${last ? "    " : "|   "}`, index === descendants.length - 1),
    );
  };
  const roots = candidates.filter((candidate) => candidate.parentId === null);
  roots.forEach((root, index) => draw(root, "", index === roots.length - 1));

  lines.push("", "GENERATION IMPROVEMENT");
  champions.forEach((winner, index) => {
    const previous = champions[index - 1];
    const delta = previous ? winner.fitness - previous.fitness : 0;
    lines.push(
      `G${index}: ${winner.id} [${winner.level.layout}] fit=${winner.fitness.toFixed(3)} ${index ? `change=${delta >= 0 ? "+" : ""}${delta.toFixed(3)}` : "baseline"}`,
    );
  });

  lines.push("", "TOURNAMENT BRACKETS");
  for (let generation = 0; generation < champions.length; generation++) {
    lines.push(`Generation ${generation}`);
    const entries = matches.filter((match) => match.generation === generation);
    const rounds = Math.max(0, ...entries.map((match) => match.round));
    for (let round = 1; round <= rounds; round++) {
      lines.push(`  Round ${round}`);
      for (const match of entries.filter((entry) => entry.round === round)) {
        const left = byId.get(match.left)!;
        const right = byId.get(match.right)!;
        lines.push(
          `    ${left.id} (${left.fitness.toFixed(3)}) vs ${right.id} (${right.fitness.toFixed(3)}) -> ${match.winner}`,
        );
      }
    }
    lines.push(`  Winner -> ${champions[generation].id}`);
  }
  lines.push(
    "",
    `BEST EVOLVED LEVEL -> ${champion.id} [${champion.level.layout}] fitness=${champion.fitness.toFixed(3)}`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * Run single-elimination selection, then create reseeded offspring whose
 * layout and difficulty are inherited or mutated from first-round winners.
 */
export function evolveLevels(options: EvolutionOptions = {}): EvolutionResult {
  const seed = options.seed ?? "evolution";
  const population = options.population ?? 16;
  const generations = options.generations ?? 4;
  const mutation = options.mutation ?? 0.18;
  const bots = options.bots ?? 8;
  const attempts = options.attempts ?? 2;
  const maxSteps = options.maxSteps ?? 1_800;
  const objective = options.objective ?? "balanced";
  if (
    !Number.isInteger(population) ||
    population < 4 ||
    population > 128 ||
    (population & (population - 1)) !== 0
  ) {
    throw new Error("population must be a power of two from 4 to 128");
  }
  if (!Number.isInteger(generations) || generations < 1 || generations > 20) {
    throw new Error("generations must be an integer from 1 to 20");
  }
  if (!Number.isFinite(mutation) || mutation < 0 || mutation > 1) {
    throw new Error("mutation must be between 0 and 1");
  }
  if (population * generations * bots * attempts > 250_000) {
    throw new Error("population × generations × bots × attempts cannot exceed 250000 episodes");
  }

  const features = options.features;
  const layouts: GeneratedLayout[] =
    features && !features.includes("tunnels") ? ["surface"] : ["surface", "tunnel", "mixed"];
  const random = randomSource(`${seed}:mutation`);
  const candidates: EvolutionCandidate[] = [];
  const matches: EvolutionMatch[] = [];
  const generationChampions: EvolutionCandidate[] = [];

  const evaluate = (
    generation: number,
    index: number,
    parent?: EvolutionCandidate,
    elite = false,
  ): EvolutionCandidate => {
    const difficulty = parent
      ? elite
        ? parent.difficulty
        : clamp01(parent.difficulty + (random() * 2 - 1) * mutation)
      : clamp01((options.difficulty ?? 0.45) + (random() * 2 - 1) * 0.35);
    const layout =
      options.layout ??
      (parent && (elite || random() >= mutation)
        ? parent.level.layout
        : layouts[Math.floor(random() * layouts.length)]);
    const candidateSeed =
      parent && elite
        ? parent.seed
        : `${seed}:g${generation}:${index}:${Math.floor(random() * 1e9)}`;
    const level = generateLevel({
      seed: candidateSeed,
      width: options.width,
      height: options.height,
      difficulty,
      layout,
      features,
      abilities: options.abilities,
    });
    const heuristic = scoreGeneratedLevel(level, options.profile);
    const bot = evaluateLevelWithBots(level, { bots, attempts, maxSteps, seed: candidateSeed });
    const complexity = clamp01(
      (level.layout === "surface" ? 0 : 0.15) +
        Math.min(0.2, level.metrics.gaps * 0.04) +
        Math.min(0.15, level.metrics.platforms * 0.025) +
        Math.min(0.1, level.metrics.rooms * 0.05) +
        bot.metrics.observedDashRate * 0.12 +
        bot.metrics.observedDoubleJumpRate * 0.14 +
        bot.metrics.observedWallJumpRate * 0.14,
    );
    return {
      id: `G${generation}-${String(index).padStart(2, "0")}`,
      generation,
      parentId: parent?.id ?? null,
      seed: candidateSeed,
      difficulty,
      level,
      heuristic,
      bot,
      complexity,
      fitness:
        objective === "complex"
          ? heuristic.total * 0.2 + bot.score * 0.6 + complexity * 0.2
          : heuristic.total * 0.3 + bot.score * 0.7,
    };
  };

  let generation = Array.from({ length: population }, (_, index) => evaluate(0, index));
  candidates.push(...generation);
  let bestSeen: EvolutionCandidate | undefined;

  for (let generationIndex = 0; generationIndex < generations; generationIndex++) {
    let round = [...generation];
    let firstRoundWinners: EvolutionCandidate[] = [];
    let roundIndex = 1;
    while (round.length > 1) {
      const winners: EvolutionCandidate[] = [];
      for (let index = 0; index < round.length; index += 2) {
        const winner = better(round[index], round[index + 1]);
        winners.push(winner);
        matches.push({
          generation: generationIndex,
          round: roundIndex,
          left: round[index].id,
          right: round[index + 1].id,
          winner: winner.id,
        });
      }
      if (roundIndex === 1) firstRoundWinners = winners;
      round = winners;
      roundIndex++;
    }
    const winner = round[0];
    generationChampions.push(winner);
    bestSeen = bestSeen ? better(bestSeen, winner) : winner;
    if (generationIndex === generations - 1) break;

    const parents = [winner, ...firstRoundWinners.filter((candidate) => candidate !== winner)];
    generation = Array.from({ length: population }, (_, index) =>
      evaluate(
        generationIndex + 1,
        index,
        index === 0 ? bestSeen : parents[(index - 1) % parents.length],
        index === 0,
      ),
    );
    candidates.push(...generation);
  }

  const champion = bestSeen!;
  return {
    options: { seed, population, generations, mutation, bots, attempts, maxSteps, objective },
    candidates,
    matches,
    generationChampions,
    champion,
    tree: renderTree(candidates, matches, generationChampions, champion),
    design: generatedDesign(champion.level, "EvolvedChampion"),
  };
}
