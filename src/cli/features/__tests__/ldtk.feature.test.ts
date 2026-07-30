import { describe, expect, it } from "vitest";
import { checkLDtk, generateLDtkTypes, type LDtkProject } from "../ldtk.feature.js";

const project: LDtkProject = {
  levels: [
    {
      identifier: "Forest",
      layerInstances: [
        {
          entityInstances: [{ __identifier: "Player" }, { __identifier: "Door" }],
        },
      ],
    },
    {
      identifier: "Cave",
      layerInstances: [{ entityInstances: [{ __identifier: "Door" }] }],
    },
  ],
  defs: {
    levelFields: [
      { identifier: "DisplayName", type: "F_String" },
      { identifier: "CaveRow", type: "F_Int", canBeNull: true },
    ],
    enums: [{ identifier: "Transition", values: [{ id: "Fade" }, { id: "Wipe" }] }],
    entities: [
      { identifier: "Player", tags: ["mm:marker"] },
      {
        identifier: "Door",
        tags: ["mm:portal"],
        fieldDefs: [
          { identifier: "To", type: "F_EntityRef" },
          { identifier: "Effect", type: "F_Enum(Transition)" },
        ],
      },
    ],
  },
};

describe("mm ldtk types", () => {
  it("generates useful literal unions and a typed world loader", () => {
    const code = generateLDtkTypes(project, "game.ldtk");

    expect(code).toContain('export const levelIds = ["Forest", "Cave"] as const');
    expect(code).toContain("export type LevelId = (typeof levelIds)[number]");
    expect(code).toContain('export const portalTypes = ["Door"] as const');
    expect(code).toContain('export type Transition = "Fade" | "Wipe"');
    expect(code).toContain("readonly To: LDtkEntityRef");
    expect(code).toContain("readonly DisplayName: string");
    expect(code).toContain("readonly CaveRow: number | null");
    expect(code).toContain('Forest: ["Door", "Player"]');
    expect(code).toContain(
      "LDtk.world<LevelId, EntityType, EntityFields, LevelFields>(assets.level, { image })",
    );
    expect(code).toContain('import * as LDtk from "minimotor/ldtk"');
    expect(code).not.toContain("Tiles.LDtk");
  });

  it("includes levels nested in LDtk worlds", () => {
    const code = generateLDtkTypes(
      {
        levels: [],
        worlds: [{ levels: [{ identifier: "Island", layerInstances: [] }] }],
        defs: { entities: [] },
      },
      "world.ldtk",
    );

    expect(code).toContain('export const levelIds = ["Island"] as const');
  });

  it("generates an asset helper for the project and its authored tilesets", () => {
    const code = generateLDtkTypes(
      {
        levels: [{ identifier: "Forest", layerInstances: [] }],
        defs: {
          entities: [],
          layers: [{ identifier: "Art", tilesetDefUid: 7 }],
          tilesets: [
            { identifier: "Forest", uid: 7, relPath: "art/forest.png" },
            { identifier: "Cave", uid: 8, relPath: "art/cave.png" },
          ],
        },
      },
      "levels/game.ldtk",
      "./assets/game.ldtk",
    );

    expect(code).toContain('level: new URL("./assets/game.ldtk", import.meta.url).href');
    expect(code).toContain('terrain: new URL("./assets/art/forest.png", import.meta.url).href');
    expect(code).toContain('tilesetCave: new URL("./assets/art/cave.png", import.meta.url).href');
    expect(code).toContain("export const levelAssets = {");
    expect(code).toContain("export const loadWorld = (assets: Loaded<typeof levelAssets>)");
  });

  it("reports broken portal references", () => {
    const result = checkLDtk({
      levels: [
        {
          identifier: "Forest",
          layerInstances: [
            {
              __identifier: "World",
              entityInstances: [
                {
                  __identifier: "Door",
                  iid: "door-a",
                  fieldInstances: [{ __identifier: "To", __value: { entityIid: "missing" } }],
                },
              ],
            },
            { __identifier: "Art", entityInstances: [] },
          ],
        },
      ],
      defs: {
        entities: [{ identifier: "Door", tags: ["mm:portal"] }],
      },
    });

    expect(result.errors).toEqual(["Forest/Door: To references missing entity missing"]);
  });
});
