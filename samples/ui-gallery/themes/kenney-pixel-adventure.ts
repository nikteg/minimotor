import { Tiles } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { createTilesetSkin, frameFromCell } from "minimotor/ui";
import type { ThemeOverrides } from "minimotor";

export function createKenneyPixelAdventureTheme(atlas: CanvasImageSource): ThemeOverrides {
  const tiles = Tiles.set(atlas, { size: 8, names: { frame: [0, 0, 4, 4] } });
  const frame = frameFromCell(tiles.frame, { left: 8, top: 8, right: 8, bottom: 8 });
  return {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 32, h: 32 },
      frames: { panel: frame, button: frame },
    }),
    font: '"VT323", monospace',
    fontSize: 18,
    panel: {
      title: { height: 24 },
      background: "rgba(30,39,50,0.96)",
      padding: { x: 8, y: 8 },
    },
    accent: "#f4d77a",
    accentSoft: "#a67f42",
    text: "#fff1c0",
    textDim: "#cfb87c",
    border: "#c99b58",
    bg: "#725331",
    bgHover: "#936d42",
    bgActive: "#4b3622",
    primary: "#c88f45",
    textPad: 0,
  };
}

export async function loadKenneyPixelAdventureTheme(Assets: AssetStore): Promise<ThemeOverrides> {
  const { atlas } = await Assets.load({
    atlas: new URL("../assets/themes/kenney-pixel-adventure/atlas.png", import.meta.url).href,
  });
  return createKenneyPixelAdventureTheme(atlas);
}
