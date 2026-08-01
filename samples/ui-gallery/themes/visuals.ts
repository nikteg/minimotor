import { Tiles } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { createTilesetSkin, frameFromCell } from "minimotor/ui";
import type { ThemeOverrides } from "minimotor";

export function createVisualsTheme(atlas: CanvasImageSource): ThemeOverrides {
  const tiles = Tiles.set(atlas, {
    size: 16,
    names: { frame: [0, 0, 3, 3] },
  });
  const frame = frameFromCell(tiles.frame, { left: 16, top: 16, right: 16, bottom: 16 });
  return {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 16, h: 16 },
      frames: { panel: frame },
      sprites: {
        cursor: { image: atlas, region: { sx: 0, sy: 64, sw: 10, sh: 12 } },
        divider: { image: atlas, region: { sx: 64, sy: 0, sw: 112, sh: 16 } },
      },
    }),
    font: '"Silkscreen", monospace',
    fontSize: 12,
    panel: {
      title: { height: 16 },
      background: "rgba(21,10,28,0.94)",
      padding: { x: 16, y: 16 },
    },
    accent: "#ffd044",
    accentSoft: "#b88725",
    text: "#fff1c1",
    textDim: "#d7b86a",
    border: "#d6871f",
    bg: "#7a3d16",
    bgHover: "#a65b1e",
    bgActive: "#4b2415",
    primary: "#d6871f",
    borderWidth: 1,
    textPad: 0,
  };
}

export async function loadVisualsTheme(Assets: AssetStore): Promise<ThemeOverrides> {
  const { atlas } = await Assets.load({
    atlas: new URL("../assets/themes/visuals/atlas.png", import.meta.url).href,
  });
  return createVisualsTheme(atlas);
}
