import { Tiles } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { createTilesetSkin, frameFromCell } from "minimotor/ui";
import type { ThemeOverrides } from "minimotor";

export function createHexanyTheme(atlas: CanvasImageSource): ThemeOverrides {
  const tiles = Tiles.set(atlas, { size: 16, names: { frame: [0, 0, 6, 6] } });
  const frame = frameFromCell(tiles.frame, { left: 16, top: 16, right: 16, bottom: 16 });
  return {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 16, h: 16 },
      frames: { panel: frame },
    }),
    font: '"DotGothic16", monospace',
    fontSize: 13,
    panel: {
      title: { height: 16 },
      background: "rgba(8,8,8,0.98)",
      padding: { x: 16, y: 16 },
    },
    accent: "#ffffff",
    accentSoft: "#a9a9a9",
    text: "#ffffff",
    textDim: "#bdbdbd",
    border: "#ffffff",
    bg: "#262626",
    bgHover: "#444444",
    bgActive: "#111111",
    primary: "#ffffff",
    textPad: 0,
  };
}

export async function loadHexanyTheme(Assets: AssetStore): Promise<ThemeOverrides> {
  const { atlas } = await Assets.load({
    atlas: new URL("../assets/themes/hexany-1bit/atlas.png", import.meta.url).href,
  });
  return createHexanyTheme(atlas);
}
