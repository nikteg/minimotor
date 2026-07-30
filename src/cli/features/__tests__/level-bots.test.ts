import { describe, expect, it, vi } from "vitest";
import levelFeature, { generateLevel, type GeneratedLevel } from "../level.feature.js";
import { evaluateLevelWithBots, planLevel } from "../../level-tester/bots.js";
import { createPlatformerSimulation } from "../../level-tester/simulation.js";
import { evolveLevels } from "../../level-tester/tournament.js";

function flatLevel(): GeneratedLevel {
  const width = 24;
  const height = 14;
  const grid = Array.from({ length: height }, () => ".".repeat(width));
  grid[height - 4] = "..P..................E..";
  for (let y = height - 3; y < height; y++) grid[y] = "#".repeat(width);
  return {
    seed: "flat-bot-test",
    width,
    height,
    difficulty: 0,
    layout: "surface",
    features: ["exit"],
    abilities: { dash: false, doubleJump: false, wallJump: false },
    grid,
    stages: [{ name: "rewards", grid }],
    metrics: {
      gaps: 0,
      maxGap: 0,
      maxStep: 0,
      platforms: 0,
      gems: 0,
      rooms: 0,
      coveredRatio: 0,
    },
  };
}

function blockedLevel(): GeneratedLevel {
  const level = flatLevel();
  level.seed = "blocked-bot-test";
  level.grid = level.grid.map((row) => `${row.slice(0, 12)}#${row.slice(13)}`);
  return level;
}

describe("headless level bots", () => {
  it("can snapshot and exactly restore the shared gameplay simulation", () => {
    const simulation = createPlatformerSimulation(flatLevel());
    const start = simulation.snapshot();
    for (let step = 0; step < 20; step++) simulation.step({ right: true });
    expect(simulation.player.x).toBeGreaterThan(start.player.x);
    simulation.restore(start);
    expect(simulation.snapshot()).toEqual(start);
  });

  it("finds and replays a completion proof", () => {
    const level = flatLevel();
    const plan = planLevel(level, { beamWidth: 12, maxSteps: 600 });
    expect(plan.completed).toBe(true);
    expect(plan.commands.length).toBeGreaterThan(0);
    const result = evaluateLevelWithBots(level, {
      bots: 4,
      attempts: 2,
      maxSteps: 600,
    });
    expect(result.planner.completed).toBe(true);
    expect(result.episodes).toHaveLength(8);
    expect(result.metrics.expertSuccessRate).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("rejects geometry for which the planner cannot produce a completion proof", () => {
    const level = blockedLevel();
    const plan = planLevel(level, { beamWidth: 12, maxSteps: 300 });
    expect(plan.completed).toBe(false);
    expect(plan.progress).toBeLessThan(0.75);
    expect(evaluateLevelWithBots(level, { bots: 4, attempts: 1, maxSteps: 300 }).passed).toBe(
      false,
    );
  });

  it("produces behavioral metrics for generated geometry", () => {
    const level = generateLevel({
      seed: "generated-bot-test",
      difficulty: 0.4,
      features: ["gaps", "platforms", "exit"],
    });
    const result = evaluateLevelWithBots(level, {
      bots: 4,
      attempts: 1,
      maxSteps: 1_200,
    });
    expect(result.planner.completed).toBe(true);
    expect(result.metrics.meanProgress).toBeGreaterThan(0.5);
    expect(result.metrics.successRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.successRate).toBeLessThanOrEqual(1);
  });

  it.each(["tunnel", "mixed"] as const)("proves a generated %s route", (layout) => {
    const level = generateLevel({
      seed: `bot-${layout}-route`,
      width: 56,
      height: 24,
      difficulty: 0.35,
      layout,
      features: ["gaps", "platforms", "tunnels", "exit"],
    });
    const plan = planLevel(level, { maxSteps: 1_800 });
    expect(plan.completed).toBe(true);
  });

  it("evolves tournament winners and renders their ancestry", () => {
    const result = evolveLevels({
      seed: "test-tournament",
      population: 4,
      generations: 3,
      bots: 4,
      attempts: 1,
      maxSteps: 1_200,
      width: 40,
      height: 20,
      objective: "complex",
      features: ["gaps", "platforms", "tunnels", "exit"],
    });
    expect(result.candidates).toHaveLength(12);
    expect(result.matches).toHaveLength(9);
    expect(result.generationChampions).toHaveLength(3);
    expect(result.generationChampions[1].fitness).toBeGreaterThanOrEqual(
      result.generationChampions[0].fitness,
    );
    expect(result.generationChampions[2].fitness).toBeGreaterThanOrEqual(
      result.generationChampions[1].fitness,
    );
    expect(result.tree).toContain("EVOLUTION ANCESTRY");
    expect(result.tree).toContain("TOURNAMENT BRACKETS");
    expect(result.tree).toContain("delta=");
    expect(result.options.objective).toBe("complex");
    expect(result.candidates.every((candidate) => candidate.complexity >= 0)).toBe(true);
  });

  it("runs multi-candidate bot evaluation through the CLI feature", async () => {
    let output = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    try {
      await levelFeature.run([
        "simulate",
        "--seed",
        "cli-bots",
        "--levels",
        "2",
        "--rounds",
        "2",
        "--bots",
        "4",
        "--attempts",
        "1",
        "--max-steps",
        "800",
        "--without",
        "ladders",
        "--without",
        "gems",
        "--json",
      ]);
    } finally {
      write.mockRestore();
    }
    const report = JSON.parse(output) as {
      candidates: number;
      results: { metrics: { successRate: number } }[];
    };
    expect(report.candidates).toBe(4);
    expect(report.results).toHaveLength(4);
    expect(report.results[0].metrics.successRate).toBeGreaterThanOrEqual(0);
  });
});
