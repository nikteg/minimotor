// ---------- Level CLI tests ----------
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkLevelProject,
  generateLevel,
  generatedDesign,
  optimizeLevels,
  predictPreference,
  scoreGeneratedLevel,
  trainPreferenceModel,
  validateGeneratedLevel,
} from "@src/cli/features/level.js";

describe("mm level generate", () => {
  it("is deterministic for a seed", () => {
    expect(generateLevel({ seed: "sunny" })).toEqual(generateLevel({ seed: "sunny" }));
    expect(generateLevel({ seed: "sunny" }).grid).not.toEqual(
      generateLevel({ seed: "crystal" }).grid,
    );
  });

  it("populates the grid in named passes", () => {
    const level = generateLevel({ seed: "passes", difficulty: 0.7 });
    expect(level.stages.map((stage) => stage.name)).toEqual([
      "terrain",
      "route",
      "traversal",
      "rewards",
    ]);
    expect(level.stages[0].grid.join("")).not.toContain("G");
    expect(level.grid.join("")).toContain("P");
    expect(level.grid.join("")).toContain("E");
    expect(level.grid.join("")).toContain("G");
  });

  it("emits the shared neutral design format", () => {
    const spec = generatedDesign(generateLevel({ seed: "shared-format" }));
    expect(spec).toMatchObject({ version: 1, gridSize: 16 });
    expect(spec.levels[0].entities.some((entity) => entity.type === "Player")).toBe(true);
    expect(spec.levels[0].entities.some((entity) => entity.type === "Solid")).toBe(true);
  });

  it("supports games without ladders or gems", () => {
    const level = generateLevel({
      seed: "jump-only",
      features: ["gaps", "platforms", "exit"],
    });
    expect(level.grid.join("")).not.toContain("H");
    expect(level.grid.join("")).not.toContain("G");
    expect(level.grid.join("")).toContain("=");
    expect(validateGeneratedLevel(level)).toEqual([]);
  });

  it("builds covered tunnel corridors with expanded chambers", () => {
    const level = generateLevel({
      seed: "underground",
      width: 56,
      height: 24,
      layout: "tunnel",
    });
    expect(level.layout).toBe("tunnel");
    expect(level.metrics.rooms).toBeGreaterThanOrEqual(2);
    expect(level.metrics.coveredRatio).toBeGreaterThan(0.8);
    expect(level.grid[0]).toMatch(/^#+$/);
    expect(validateGeneratedLevel(level)).toEqual([]);
  });

  it("builds mixed routes that descend underground and return outside", () => {
    const level = generateLevel({
      seed: "there-and-back",
      width: 56,
      height: 24,
      layout: "mixed",
    });
    expect(level.layout).toBe("mixed");
    expect(level.metrics.rooms).toBeGreaterThanOrEqual(2);
    expect(level.metrics.coveredRatio).toBeGreaterThan(0.25);
    expect(level.metrics.coveredRatio).toBeLessThan(0.9);
    expect(validateGeneratedLevel(level)).toEqual([]);
  });

  it("varies the spatial layout grammar across seeds", () => {
    const layouts = new Set(
      Array.from({ length: 30 }, (_, index) => generateLevel({ seed: `layout-${index}` }).layout),
    );
    expect(layouts).toEqual(new Set(["surface", "tunnel", "mixed"]));
  });

  it("uses the dash capability to permit wider but still bounded gaps", () => {
    const levels = Array.from({ length: 30 }, (_, index) =>
      generateLevel({
        seed: `dash-${index}`,
        difficulty: 1,
        abilities: { dash: true },
      }),
    );
    expect(levels.some((level) => level.metrics.maxGap > 2)).toBe(true);
    expect(levels.every((level) => level.metrics.maxGap <= 4)).toBe(true);
    expect(levels.every((level) => validateGeneratedLevel(level).length === 0)).toBe(true);
  });

  it("uses double-jump limits and preserves wall-jump metadata", () => {
    const levels = Array.from({ length: 30 }, (_, index) =>
      generateLevel({
        seed: `double-jump-${index}`,
        difficulty: 1,
        features: ["gaps", "platforms", "gems", "exit"],
        abilities: { doubleJump: true, wallJump: true },
      }),
    );
    expect(levels.some((level) => level.metrics.maxGap === 3)).toBe(true);
    expect(levels.every((level) => level.metrics.maxGap <= 3)).toBe(true);
    expect(levels.every((level) => level.abilities.wallJump)).toBe(true);
    expect(
      levels.some((level) => {
        const route = level.stages.find((stage) => stage.name === "route")!.grid.join("");
        const traversal = level.stages.find((stage) => stage.name === "traversal")!.grid.join("");
        return traversal.split("#").length > route.split("#").length;
      }),
    ).toBe(true);
    expect(levels.every((level) => validateGeneratedLevel(level).length === 0)).toBe(true);
  });

  it("supports a minimal terrain-and-player game", () => {
    const level = generateLevel({ seed: "minimal", features: [] });
    expect(level.grid.join("")).toContain("P");
    expect(level.grid.join("")).not.toMatch(/[=HGE]/);
    expect(level.metrics).toMatchObject({ gaps: 0, platforms: 0, gems: 0 });
    expect(validateGeneratedLevel(level)).toEqual([]);
  });

  it("scores candidates with interpretable normalized components", () => {
    const score = scoreGeneratedLevel(generateLevel({ seed: "score-me" }), "balanced");
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(1);
    expect(Object.values(score.components).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(score.metrics).toHaveProperty("rhythmEntropy");
  });

  it("retains diverse high-scoring candidates during search", () => {
    const result = optimizeLevels({ seed: "test-search", count: 40 });
    expect(result.evaluated).toHaveLength(40);
    expect(result.elites.length).toBeGreaterThan(1);
    expect(result.best.score.total).toBe(
      Math.max(...result.evaluated.map((candidate) => candidate.score.total)),
    );
  });

  it("learns a preference model from labeled metric vectors", () => {
    const rows = ["calm", "medium", "busy", "wild"].map((seed, index) => ({
      metrics: scoreGeneratedLevel(generateLevel({ seed, difficulty: index / 3 })).metrics,
      rating: index / 3,
    }));
    const model = trainPreferenceModel(rows);
    expect(model.samples).toBe(4);
    const prediction = predictPreference(model, rows[2].metrics);
    expect(prediction).toBeGreaterThanOrEqual(0);
    expect(prediction).toBeLessThanOrEqual(1);
  });

  it("keeps all generated geometry inside the movement envelope", () => {
    for (let index = 0; index < 100; index++) {
      const level = generateLevel({ seed: `fuzz-${index}`, difficulty: index / 99 });
      expect(validateGeneratedLevel(level)).toEqual([]);
      expect(level.metrics.maxGap).toBeLessThanOrEqual(2);
      expect(level.metrics.maxStep).toBeLessThanOrEqual(1);
    }
  });

  it("checks a generated LDtk project with the same generic CLI rules", () => {
    const project = JSON.parse(
      readFileSync(resolve("samples/api-lab/assets/api-lab.ldtk"), "utf8"),
    );
    expect(
      checkLevelProject(project, {
        portalBoundaries: true,
        reciprocalPortals: true,
      }),
    ).toMatchObject({ errors: [], warnings: [], levels: 3 });
  });
});
