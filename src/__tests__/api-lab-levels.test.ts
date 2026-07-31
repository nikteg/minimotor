// The sample-specific generator is plain ESM so it can also run as a standalone CLI.
// @ts-expect-error JavaScript tooling intentionally has no public type declaration.
import { LEVELS, buildProject, serializeProject } from "../../tools/api-lab-levels.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rectsOverlap } from "../collision.js";
import { world as createLDtkWorld } from "../ldtk/index.js";
import { createPortalRouter } from "../portals/index.js";

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

  it("places portal arrivals clear of the destination ground", () => {
    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    const world = createLDtkWorld(project, { image: {} as CanvasImageSource });

    for (const area of world.areas) {
      for (const portal of world.portals(area)) {
        const body = {
          x: portal.x,
          y: portal.y,
          w: 12,
          h: 24,
          grounded: true,
          area,
        };
        const router = createPortalRouter({
          body,
          scenes: { go() {}, active: "game" },
          world,
          scene: "game",
          auto: false,
        });

        router.travel(portal.to);

        const nearby: { x: number; y: number; w: number; h: number }[] = [];
        world
          .level(body.area)
          .solidsNear({ x: body.x, y: body.y, w: body.w, h: body.h + 2 }, nearby);
        expect(nearby.some((solid) => rectsOverlap(body, solid))).toBe(false);
        expect(body.grounded).toBe(false);
        expect(nearby.some((solid) => solid.y === body.y + body.h + 1)).toBe(true);
      }
    }
  });
});
