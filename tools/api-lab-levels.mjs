/**
 * API Lab's Sunny Land-specific design and art adapter.
 *
 * `mm level build` invokes `buildProject`; `mm level check` owns reusable
 * structural and playability verification.
 */

export const TILE = 16;
export const PROJECT_URL = new URL("../samples/api-lab/assets/api-lab.ldtk", import.meta.url);

const solid = (x, y, w, h = 1) => ({ type: "Solid", x, y, w, h });
const oneWay = (x, y, w) => ({ type: "OneWay", x, y, w, h: 1 });
const ladder = (x, y, h) => ({ type: "Ladder", x, y, w: 1, h });
const slope = (type, x, y) => ({
  type,
  x,
  y,
  w: type.startsWith("Shallow") ? 2 : 1,
  h: 1,
});
const point = (type, x, y) => ({ type, x, y, w: 1, h: 1 });
const portal = (side, x, y, to, transition) => ({
  type: "Portal",
  side,
  x,
  y,
  w: 1,
  h: 2,
  to,
  transition,
});
const scenery = (asset, x, y, w, h) => ({ type: "Scenery", asset, x, y, w, h });

/**
 * Coordinates are tile-space except Scenery, which uses authored pixel-space.
 * Every challenge has safe ground beneath it; the upper routes are expressive
 * shortcuts and gem trails, never mandatory precision gates.
 */
export const LEVELS = [
  {
    id: "SunnyCommons",
    name: "SUNNY COMMONS",
    theme: "surface",
    width: 56,
    height: 24,
    caveRow: null,
    entities: [
      // Commons: four-player spawn lawn and a low, safe first jump.
      solid(0, 18, 56, 6),
      point("Player", 4, 17),
      point("Entry", 5, 17),
      oneWay(9, 15, 5),
      point("Gem", 11, 14),

      // Orchard: teach → develop → combine, always above continuous ground.
      oneWay(16, 14, 5),
      point("Gem", 18, 13),
      oneWay(23, 12, 6),
      point("Gem", 25, 11),
      point("Gem", 27, 11),
      ladder(21, 14, 4),
      oneWay(20, 13, 3),

      // Hill homes: one readable rise, a broad rest terrace, then descent.
      slope("ShallowUp", 32, 17),
      solid(34, 16, 10, 2),
      point("Gem", 36, 15),
      point("Gem", 41, 15),
      slope("ShallowDown", 44, 17),
      oneWay(46, 14, 4),
      point("Gem", 48, 13),

      portal("left", 1, 16, "CrystalCaves:right", "WipeUp"),
      portal("right", 54, 16, "CanopyCrossing:left", "WipeRight"),

      scenery("sign", 80, 268, 18, 20),
      scenery("bush", 232, 260, 46, 28),
      scenery("woodenHouse", 560, 158, 112, 98),
      scenery("strawHouse", 688, 160, 128, 96),
      scenery("palm", 816, 112, 79, 176),
    ],
  },
  {
    id: "CanopyCrossing",
    name: "CANOPY CROSSING",
    theme: "surface",
    width: 52,
    height: 22,
    caveRow: null,
    entities: [
      // A forgiving ground route keeps multiplayer traffic moving.
      solid(0, 18, 52, 4),
      point("Player", 3, 17),
      point("Entry", 4, 17),

      // Canopy route: wide landings, 1–2 tile rises, paired gem arcs.
      oneWay(6, 15, 6),
      point("Gem", 8, 14),
      point("Gem", 10, 14),
      oneWay(14, 13, 6),
      ladder(16, 14, 4),
      point("Gem", 16, 12),
      point("Gem", 18, 12),
      oneWay(22, 11, 7),
      point("Gem", 24, 10),
      point("Gem", 27, 10),

      // A safe wall-jump pocket. Failure returns to the ground route.
      solid(31, 13, 1, 5),
      solid(35, 10, 1, 8),
      oneWay(32, 9, 4),
      point("Gem", 33, 8),
      point("Gem", 35, 8),

      // Cooldown descent and regroup before the cave.
      oneWay(38, 12, 6),
      ladder(40, 13, 5),
      point("Gem", 40, 11),
      point("Gem", 43, 11),
      oneWay(45, 15, 4),
      point("Gem", 47, 14),

      portal("left", 1, 16, "SunnyCommons:right", "WipeLeft"),
      portal("right", 50, 16, "CrystalCaves:left", "WipeDown"),

      scenery("tree", 32, 177, 119, 111),
      scenery("pine", 240, 158, 82, 130),
      scenery("strawHouse", 384, 192, 128, 96),
      scenery("tree", 592, 177, 119, 111),
      scenery("palm", 736, 112, 79, 176),
    ],
  },
  {
    id: "CrystalCaves",
    name: "CRYSTAL CAVES",
    theme: "cave",
    width: 52,
    height: 24,
    caveRow: 0,
    entities: [
      solid(0, 0, 52, 3),
      solid(0, 21, 52, 3),
      point("Player", 3, 20),
      point("Entry", 4, 20),

      // Ladder chamber: short safe climb and a visible sideways exit.
      oneWay(7, 16, 8),
      ladder(10, 17, 4),
      point("Gem", 9, 15),
      point("Gem", 12, 15),

      // Gallery: alternating broad shelves form two routes that reconnect.
      oneWay(17, 13, 8),
      ladder(20, 14, 7),
      point("Gem", 18, 12),
      point("Gem", 21, 12),
      point("Gem", 24, 12),
      oneWay(27, 10, 8),
      ladder(30, 11, 10),
      point("Gem", 28, 9),
      point("Gem", 31, 9),
      point("Gem", 34, 9),

      // Return chamber mirrors the descent without copying its rhythm.
      oneWay(37, 14, 7),
      ladder(39, 15, 6),
      point("Gem", 38, 13),
      point("Gem", 42, 13),
      oneWay(44, 17, 5),
      point("Gem", 46, 16),

      portal("left", 1, 19, "CanopyCrossing:right", "WipeUp"),
      portal("right", 50, 19, "SunnyCommons:left", "WipeDown"),

      scenery("shrooms", 80, 321, 16, 15),
      scenery("bigRock", 208, 283, 53, 53),
      scenery("bigCrate", 400, 304, 32, 32),
      scenery("rock", 560, 321, 28, 15),
      scenery("crate", 688, 320, 16, 16),
    ],
  },
];

export const design = { version: 1, gridSize: TILE, levels: LEVELS };

const DEFINITION = {
  Solid: { uid: 1, color: "#7F4B3A", tags: ["mm:solid"] },
  OneWay: { uid: 2, color: "#D8A657", tags: ["mm:one-way"] },
  Ladder: { uid: 3, color: "#E6C15A", tags: ["mm:ladder"] },
  ShallowUp: { uid: 4, color: "#59C36A", tags: ["mm:slope:up-right", "mm:span:2x1"] },
  ShallowDown: { uid: 5, color: "#4EBB9D", tags: ["mm:slope:up-left", "mm:span:2x1"] },
  SteepUp: { uid: 6, color: "#5AA9E6", tags: ["mm:slope:up-right"] },
  SteepDown: { uid: 7, color: "#8577D1", tags: ["mm:slope:up-left"] },
  Player: { uid: 8, color: "#FF57B9", tags: ["mm:marker"] },
  Gem: { uid: 9, color: "#42D9E8", tags: ["mm:marker"] },
  Entry: { uid: 204, color: "#63E6BE", tags: ["mm:marker"] },
  Exit: { uid: 205, color: "#74C0FC", tags: ["mm:marker"] },
  Portal: { uid: 206, color: "#C77DFF", tags: ["mm:portal"] },
  Scenery: { uid: 209, color: "#9AA5B1", tags: ["mm:sprite"] },
};

const TILE_ART = {
  platform: [34, 35, 36],
  ladder: 257,
  shallowUp: [44, 45, 69, 70],
  shallowDown: [47, 48, 72, 73],
  steepUp: [120, 145],
  steepDown: [122, 147],
  surface: {
    top: [26, 28, 30],
    body: [76, 78, 80],
  },
  cave: {
    // The atlas's purple cave fragments are decorative chunks, not a complete
    // edge-matching terrain set. Use the complete earth 3×2 set against the
    // cave palette instead of repeating stalactites as fake solid fill.
    top: [26, 28, 30],
    body: [76, 78, 80],
  },
};

const tileSource = (id) => [(id % 25) * TILE, Math.floor(id / 25) * TILE];
const instanceId = (level, index) => `api-${level.id.toLowerCase()}-${index}`;
const portalKey = (levelId, side) => `${levelId}:${side}`;

function field(identifier, value, defUid, type) {
  const kind = type === "Int" ? "V_Int" : type.startsWith("Enum") ? "V_Enum" : "V_String";
  return {
    __identifier: identifier,
    __type: type,
    __value: value,
    __tile: null,
    defUid,
    realEditorValues: value === null ? [] : [{ id: kind, params: [value] }],
  };
}

function entityInstance(level, entity, index, portalIds, levelIids) {
  const definition = DEFINITION[entity.type];
  const isScenery = entity.type === "Scenery";
  const x = isScenery ? entity.x : entity.x * TILE;
  const y = isScenery ? entity.y : entity.y * TILE;
  const width = isScenery ? entity.w : entity.w * TILE;
  const height = isScenery ? entity.h : entity.h * TILE;
  const iid =
    entity.type === "Portal"
      ? portalIds.get(portalKey(level.id, entity.side))
      : instanceId(level, index);
  const fields = [];
  if (entity.type === "Portal") {
    const target = portalIds.get(entity.to);
    const targetLevel = entity.to.split(":")[0];
    fields.push({
      __identifier: "To",
      __type: "EntityRef",
      __value: {
        entityIid: target,
        layerIid: `api-world-${targetLevel.toLowerCase()}`,
        levelIid: levelIids.get(targetLevel),
        worldIid: "api-lab-project",
      },
      __tile: null,
      defUid: 207,
      realEditorValues: [{ id: "V_EntityRef", params: [target] }],
    });
    fields.push(field("Transition", entity.transition, 210, "LocalEnum.PortalTransition"));
    fields.push(field("TransitionMs", 260, 211, "Int"));
  } else if (entity.type === "Scenery") {
    fields.push(field("Asset", entity.asset, 208, "LocalEnum.SceneryAsset"));
  }
  return {
    __identifier: entity.type,
    __grid: [Math.floor(x / TILE), Math.floor(y / TILE)],
    px: [x, y],
    width,
    height,
    iid,
    defUid: definition.uid,
    __pivot: [0.5, 0.5],
    __smartColor: definition.color,
    __tags: definition.tags,
    __tile: null,
    fieldInstances: fields,
  };
}

function solidCells(level) {
  const cells = new Set();
  for (const entity of level.entities.filter((entry) => entry.type === "Solid")) {
    for (let y = entity.y; y < entity.y + entity.h; y++) {
      for (let x = entity.x; x < entity.x + entity.w; x++) cells.add(`${x},${y}`);
    }
  }
  return cells;
}

function artTiles(level) {
  const out = [];
  const occupied = solidCells(level);
  let autoId = 1;
  const add = (x, y, id) => {
    if (x < 0 || y < 0 || x >= level.width || y >= level.height) return;
    out.push({
      px: [x * TILE, y * TILE],
      src: tileSource(id),
      f: 0,
      t: id,
      d: [autoId++],
      a: 1,
    });
  };
  const connected = (x, y) => occupied.has(`${x},${y}`);
  for (const key of occupied) {
    const [x, y] = key.split(",").map(Number);
    const row = connected(x, y - 1) ? "body" : "top";
    const edge = !connected(x - 1, y) ? 0 : !connected(x + 1, y) ? 2 : 1;
    add(x, y, TILE_ART[level.theme][row][edge]);
  }
  for (const entity of level.entities) {
    if (entity.type === "OneWay") {
      for (let x = 0; x < entity.w; x++) {
        add(entity.x + x, entity.y, TILE_ART.platform[x === 0 ? 0 : x === entity.w - 1 ? 2 : 1]);
      }
    } else if (entity.type === "Ladder") {
      for (let y = 0; y < entity.h; y++) add(entity.x, entity.y + y, TILE_ART.ladder);
    } else if (entity.type === "ShallowUp" || entity.type === "ShallowDown") {
      const ids = entity.type === "ShallowUp" ? TILE_ART.shallowUp : TILE_ART.shallowDown;
      add(entity.x, entity.y, ids[0]);
      add(entity.x + 1, entity.y, ids[1]);
      add(entity.x, entity.y + 1, ids[2]);
      add(entity.x + 1, entity.y + 1, ids[3]);
    } else if (entity.type === "SteepUp" || entity.type === "SteepDown") {
      const ids = entity.type === "SteepUp" ? TILE_ART.steepUp : TILE_ART.steepDown;
      add(entity.x, entity.y, ids[0]);
      add(entity.x, entity.y + 1, ids[1]);
    }
  }
  return out.sort((a, b) => a.px[1] - b.px[1] || a.px[0] - b.px[0]);
}

export function buildProject(template, source = design) {
  const levelsSource = source.levels;
  const levelIids = new Map(
    levelsSource.map((level) => [level.id, `api-level-${level.id.toLowerCase()}`]),
  );
  const portalIds = new Map();
  for (const level of levelsSource) {
    for (const entity of level.entities.filter((entry) => entry.type === "Portal")) {
      portalIds.set(
        portalKey(level.id, entity.side),
        `api-portal-${level.id.toLowerCase()}-${entity.side}`,
      );
    }
  }
  const levels = levelsSource.map((level, levelIndex) => {
    const worldIid = `api-world-${level.id.toLowerCase()}`;
    const entities = level.entities.map((entity, index) =>
      entityInstance(level, entity, index + 1, portalIds, levelIids),
    );
    const tiles = artTiles(level);
    const layerBase = {
      __cWid: level.width,
      __cHei: level.height,
      __gridSize: TILE,
      __opacity: 1,
      __pxTotalOffsetX: 0,
      __pxTotalOffsetY: 0,
      pxOffsetX: 0,
      pxOffsetY: 0,
      visible: true,
      optionalRules: [],
      intGridCsv: [],
      autoLayerTiles: [],
      seed: levelIndex + 1,
    };
    return {
      identifier: level.id,
      iid: levelIids.get(level.id),
      uid: 101 + levelIndex,
      worldX: levelIndex * 900,
      worldY: 0,
      worldDepth: 0,
      pxWid: level.width * TILE,
      pxHei: level.height * TILE,
      __bgColor: level.theme === "cave" ? "#29263E" : "#6DCDEB",
      bgColor: null,
      useAutoIdentifier: false,
      bgRelPath: null,
      bgPos: null,
      bgPivotX: 0.5,
      bgPivotY: 0.5,
      __smartColor: "#8D6C9F",
      __neighbours: [],
      customFields: {},
      fieldInstances: [
        field("DisplayName", level.name, 212, "String"),
        field("CaveRow", level.caveRow, 213, "Int"),
      ],
      layerInstances: [
        {
          ...layerBase,
          __identifier: "World",
          __type: "Entities",
          __tilesetDefUid: null,
          __tilesetRelPath: null,
          iid: worldIid,
          layerDefUid: 100,
          levelId: 101 + levelIndex,
          entityInstances: entities,
          gridTiles: [],
        },
        {
          ...layerBase,
          __identifier: "Art",
          __type: "Tiles",
          __tilesetDefUid: 200,
          __tilesetRelPath: "sunnyland-tileset.png",
          iid: `api-art-${level.id.toLowerCase()}`,
          layerDefUid: 201,
          levelId: 101 + levelIndex,
          entityInstances: [],
          gridTiles: tiles,
        },
      ],
    };
  });
  return {
    ...template,
    iid: "api-lab-project",
    worldGridWidth: TILE,
    worldGridHeight: TILE,
    levels,
  };
}

export function serializeProject(project) {
  return `${JSON.stringify(project, null, 2)}\n`;
}
