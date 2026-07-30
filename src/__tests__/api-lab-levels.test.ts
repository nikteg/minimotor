// The sample-specific generator is plain ESM so it can also run as a standalone CLI.
// @ts-expect-error JavaScript tooling intentionally has no public type declaration.
import { LEVELS, buildProject, serializeProject } from "../../tools/api-lab-levels.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("API Lab level design", () => {
  const projectPath = resolve("samples/api-lab/assets/api-lab.ldtk");
  it("keeps every portal deliberate, reciprocal, and on a boundary", () => {
    const portals = LEVELS.flatMap(
      (level: { id: string; width: number; entities: Record<string, unknown>[] }) =>
        level.entities
          .filter((entity) => entity.type === "Portal")
          .map((entity) => ({ ...entity, level: level.id, levelWidth: level.width })),
    );
    expect(portals).toHaveLength(LEVELS.length * 2);
    for (const portal of portals) {
      expect(Math.min(portal.x, portal.levelWidth - portal.x - portal.w)).toBeLessThanOrEqual(1);
      const target = portals.find(
        (candidate) => `${candidate.level}:${candidate.side}` === portal.to,
      );
      expect(target?.to).toBe(`${portal.level}:${portal.side}`);
    }
  });

  it("keeps painted tiles generated from the same grid as collision", () => {
    const current = JSON.parse(readFileSync(projectPath, "utf8"));
    const generated = buildProject(current);
    for (const level of generated.levels) {
      const [world, art] = level.layerInstances;
      expect(world.__gridSize).toBe(art.__gridSize);
      expect(world.__cWid).toBe(art.__cWid);
      expect(world.__cHei).toBe(art.__cHei);
      for (const tile of art.gridTiles) {
        expect(tile.px[0] % art.__gridSize).toBe(0);
        expect(tile.px[1] % art.__gridSize).toBe(0);
        expect(tile.src[0] % art.__gridSize).toBe(0);
        expect(tile.src[1] % art.__gridSize).toBe(0);
        expect(tile.src[0]).toBeGreaterThanOrEqual(0);
        expect(tile.src[0]).toBeLessThan(400);
        expect(tile.src[1]).toBeGreaterThanOrEqual(0);
        expect(tile.src[1]).toBeLessThan(368);
      }
    }
  });

  it("keeps the checked-in LDtk project reproducible", () => {
    const current = readFileSync(projectPath, "utf8");
    expect(serializeProject(buildProject(JSON.parse(current)))).toBe(current);
  });
});
