import type { GeneratedLevel } from "../features/level.feature.js";
import {
  createPlatformerSimulation,
  type PlatformerSimulation,
  type SimulationAction,
  type SimulationSnapshot,
  type SimulationStats,
} from "./simulation.js";

export type BotPersona = "expert" | "intermediate" | "beginner" | "completionist";

export interface BotCommand {
  horizontal: -1 | 0 | 1;
  vertical: -1 | 0 | 1;
  jump: boolean;
  dash: boolean;
  steps: number;
}

export interface BotPlan {
  completed: boolean;
  commands: BotCommand[];
  expanded: number;
  progress: number;
  stats: SimulationStats;
}

export interface BotEpisode {
  persona: BotPersona;
  attempt: number;
  completed: boolean;
  completionSteps: number | null;
  deaths: number;
  progress: number;
  gems: number;
  jumps: number;
  dashes: number;
  doubleJumps: number;
  wallJumps: number;
  inputComplexity: number;
  pathSignature: string;
}

export interface BotEvaluation {
  passed: boolean;
  score: number;
  planner: BotPlan;
  episodes: BotEpisode[];
  metrics: {
    successRate: number;
    expertSuccessRate: number;
    intermediateSuccessRate: number;
    beginnerSuccessRate: number;
    completionistSuccessRate: number;
    medianCompletionSteps: number | null;
    medianDeaths: number;
    meanProgress: number;
    stuckRate: number;
    gemCoverage: number;
    pathDiversity: number;
    meanInputComplexity: number;
    observedDashRate: number;
    observedDoubleJumpRate: number;
    observedWallJumpRate: number;
  };
}

interface SearchNode {
  snapshot: SimulationSnapshot;
  commands: BotCommand[];
  fitness: number;
}

const command = (
  horizontal: -1 | 0 | 1,
  jump = false,
  dash = false,
  vertical: -1 | 0 | 1 = 0,
  steps = 8,
): BotCommand => ({ horizontal, vertical, jump, dash, steps });

function availableCommands(level: GeneratedLevel): BotCommand[] {
  const result = [
    command(1),
    command(1, true),
    command(0, true),
    command(-1),
    command(-1, true),
    command(0, false, false, -1),
    command(1, false, false, -1),
    command(0, false, false, 0, 4),
  ];
  if (level.abilities.dash) {
    result.push(command(1, false, true), command(1, true, true), command(-1, false, true));
  }
  return result;
}

function applyCommand(
  simulation: PlatformerSimulation,
  input: BotCommand,
  path?: { x: number; y: number }[],
): number {
  let changes = 0;
  for (let step = 0; step < input.steps && !simulation.stats.completed; step++) {
    const action: SimulationAction = {
      left: input.horizontal < 0,
      right: input.horizontal > 0,
      up: input.vertical < 0,
      down: input.vertical > 0,
      jumpPressed: input.jump && step === 0,
      jumpReleased: input.jump && step === input.steps - 1,
      dashPressed: input.dash && step === 0,
    };
    if (step === 0) {
      changes += Number(input.horizontal !== 0) + Number(input.jump) + Number(input.dash);
    }
    simulation.step(action);
    if (path && simulation.stats.steps % 30 === 0) {
      path.push({ x: simulation.player.x, y: simulation.player.y });
    }
  }
  return changes;
}

function searchFitness(
  level: GeneratedLevel,
  state: SimulationSnapshot,
  collectGems: boolean,
): number {
  if (collectGems && state.stats.completed && state.stats.gems < level.metrics.gems) {
    return -100_000;
  }
  if (state.stats.completed) return 1_000_000 - state.stats.completionSteps;
  const progress = state.stats.maxX / Math.max(1, level.width - 1);
  const current = state.player.x / Math.max(1, level.width * 16);
  return (
    progress * 10_000 +
    current * 1_000 +
    state.stats.gems * (collectGems ? 1_500 : 20) -
    state.stats.deaths * 400 -
    Math.max(0, state.stats.steps - 1_200) * 0.1
  );
}

function stateKey(state: SimulationSnapshot): string {
  return [
    Math.round(state.player.x / 6),
    Math.round(state.player.y / 6),
    Math.round(state.player.velX * 2),
    Math.round(state.player.velY * 2),
    Number(state.player.grounded),
    Number(state.climbing),
    Number(state.dashReady),
    state.airJumps,
    state.gems.map(Number).join(""),
  ].join(":");
}

/** Beam-search the exact gameplay simulation and retain a replayable input proof. */
export function planLevel(
  level: GeneratedLevel,
  options: { beamWidth?: number; maxSteps?: number; collectGems?: boolean } = {},
): BotPlan {
  const simulation = createPlatformerSimulation(level);
  const initial = simulation.snapshot();
  const beamWidth = options.beamWidth ?? 36;
  const maxSteps = options.maxSteps ?? 1_500;
  const collectGems = options.collectGems === true && level.metrics.gems > 0;
  const actions = availableCommands(level);
  let expanded = 0;
  let beam: SearchNode[] = [{ snapshot: initial, commands: [], fitness: 0 }];
  let best = beam[0];

  while (beam.length && beam[0].snapshot.stats.steps < maxSteps) {
    const next = new Map<string, SearchNode>();
    for (const node of beam) {
      for (const action of actions) {
        simulation.restore(node.snapshot);
        applyCommand(simulation, action);
        expanded++;
        const snapshot = simulation.snapshot();
        const candidate = {
          snapshot,
          commands: [...node.commands, action],
          fitness: searchFitness(level, snapshot, collectGems),
        };
        if (candidate.fitness > best.fitness) best = candidate;
        if (snapshot.stats.completed) {
          if (collectGems && snapshot.stats.gems < level.metrics.gems) continue;
          return {
            completed: true,
            commands: candidate.commands,
            expanded,
            progress: 1,
            stats: snapshot.stats,
          };
        }
        const key = stateKey(snapshot);
        const previous = next.get(key);
        if (!previous || candidate.fitness > previous.fitness) next.set(key, candidate);
      }
    }
    beam = [...next.values()].sort((a, b) => b.fitness - a.fitness).slice(0, beamWidth);
  }
  return {
    completed: false,
    commands: best.commands,
    expanded,
    progress: Math.min(1, best.snapshot.stats.maxX / Math.max(1, level.width - 1)),
    stats: best.snapshot.stats,
  };
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

const personaNoise: Record<BotPersona, number> = {
  expert: 0,
  intermediate: 0.055,
  beginner: 0.14,
  completionist: 0.035,
};

function noisyCommand(input: BotCommand, persona: BotPersona, random: () => number): BotCommand {
  const noise = personaNoise[persona];
  const result = { ...input };
  if (random() < noise) result.jump = !result.jump;
  if (random() < noise * 0.65) result.dash = false;
  if (random() < noise * 0.45) result.horizontal = result.horizontal === 1 ? 0 : 1;
  result.steps = Math.max(3, input.steps + Math.floor((random() - 0.5) * noise * 40));
  return result;
}

function replayPlan(
  level: GeneratedLevel,
  plan: BotPlan,
  persona: BotPersona,
  attempt: number,
  seed: string,
): BotEpisode {
  const simulation = createPlatformerSimulation(level);
  const random = randomSource(`${seed}:${persona}:${attempt}`);
  const path: { x: number; y: number }[] = [];
  let changes = 0;
  const delay = persona === "expert" ? 0 : Math.floor(random() * (persona === "beginner" ? 15 : 7));
  for (let step = 0; step < delay; step++) simulation.step();
  for (const original of plan.commands) {
    changes += applyCommand(simulation, noisyCommand(original, persona, random), path);
    if (simulation.stats.completed) break;
  }
  // Give disturbed agents a small reactive recovery window.
  for (let recovery = 0; recovery < 30 && !simulation.stats.completed; recovery++) {
    changes += applyCommand(
      simulation,
      command(1, recovery % 3 === 0, level.abilities.dash && recovery % 5 === 0),
      path,
    );
  }
  const stats = simulation.stats;
  const signature = path
    .map(({ x, y }) => `${Math.round(x / 32)},${Math.round(y / 32)}`)
    .filter((value, index, values) => value !== values[index - 1])
    .join("|");
  return {
    persona,
    attempt,
    completed: stats.completed,
    completionSteps: stats.completed ? stats.completionSteps : null,
    deaths: stats.deaths,
    progress: Math.min(1, stats.maxX / Math.max(1, level.width - 1)),
    gems: stats.gems,
    jumps: stats.jumps,
    dashes: stats.dashes,
    doubleJumps: stats.doubleJumps,
    wallJumps: stats.wallJumps,
    inputComplexity: changes / Math.max(1, stats.steps),
    pathSignature: signature,
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Run several synthetic player personas against one generated level. */
export function evaluateLevelWithBots(
  level: GeneratedLevel,
  options: { bots?: number; attempts?: number; maxSteps?: number; seed?: string } = {},
): BotEvaluation {
  const botCount = options.bots ?? 8;
  const attempts = options.attempts ?? 3;
  const planner = planLevel(level, { maxSteps: options.maxSteps });
  const completionistPlanner =
    level.metrics.gems > 0
      ? planLevel(level, { maxSteps: options.maxSteps, collectGems: true })
      : planner;
  const personas: BotPersona[] = ["expert", "intermediate", "beginner", "completionist"];
  const episodes: BotEpisode[] = [];
  for (let bot = 0; bot < botCount; bot++) {
    const persona = personas[bot % personas.length];
    for (let attempt = 0; attempt < attempts; attempt++) {
      episodes.push(
        replayPlan(
          level,
          persona === "completionist" ? completionistPlanner : planner,
          persona,
          attempt,
          `${options.seed ?? level.seed}:${bot}`,
        ),
      );
    }
  }
  const rate = (persona: BotPersona) => {
    const relevant = episodes.filter((episode) => episode.persona === persona);
    return mean(relevant.map((episode) => Number(episode.completed)));
  };
  const successes = episodes.filter((episode) => episode.completed);
  const totalGems = level.metrics.gems;
  const successRate = mean(episodes.map((episode) => Number(episode.completed)));
  const stuckRate = mean(
    episodes.map((episode) => Number(!episode.completed && episode.progress < 0.25)),
  );
  const metrics: BotEvaluation["metrics"] = {
    successRate,
    expertSuccessRate: rate("expert"),
    intermediateSuccessRate: rate("intermediate"),
    beginnerSuccessRate: rate("beginner"),
    completionistSuccessRate: rate("completionist"),
    medianCompletionSteps: successes.length
      ? median(successes.map((episode) => episode.completionSteps!))
      : null,
    medianDeaths: median(episodes.map((episode) => episode.deaths)),
    meanProgress: mean(episodes.map((episode) => episode.progress)),
    stuckRate,
    gemCoverage: totalGems > 0 ? mean(episodes.map((episode) => episode.gems / totalGems)) : 1,
    pathDiversity:
      episodes.length > 1
        ? Math.min(
            1,
            new Set(episodes.map((episode) => episode.pathSignature)).size / episodes.length,
          )
        : 0,
    meanInputComplexity: mean(episodes.map((episode) => episode.inputComplexity)),
    observedDashRate: mean(episodes.map((episode) => Number(episode.dashes > 0))),
    observedDoubleJumpRate: mean(episodes.map((episode) => Number(episode.doubleJumps > 0))),
    observedWallJumpRate: mean(episodes.map((episode) => Number(episode.wallJumps > 0))),
  };
  const targetDifficulty = Math.max(0, 1 - Math.abs(successRate - 0.65) / 0.65);
  const score =
    Number(planner.completed) * 0.35 +
    targetDifficulty * 0.2 +
    metrics.meanProgress * 0.15 +
    (1 - stuckRate) * 0.1 +
    metrics.gemCoverage * 0.08 +
    metrics.pathDiversity * 0.07 +
    Math.min(1, metrics.meanInputComplexity * 8) * 0.05;
  return {
    passed:
      planner.completed &&
      metrics.expertSuccessRate === 1 &&
      successRate >= 0.2 &&
      metrics.meanProgress >= 0.5 &&
      stuckRate < 0.75,
    score,
    planner,
    episodes,
    metrics,
  };
}
