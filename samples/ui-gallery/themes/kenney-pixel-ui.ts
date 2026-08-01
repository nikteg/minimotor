import { createTilesetSkinFromManifest } from "minimotor/ui";
import type { AssetStore } from "minimotor/assets";
import type { Theme, TilesetSkinManifest } from "minimotor/ui";

export function createKenneyPixelUiTheme(
  atlas: CanvasImageSource,
  config: TilesetSkinManifest,
): Partial<Theme> {
  return {
    skin: createTilesetSkinFromManifest(atlas, config),
    font: '"Press Start 2P", monospace',
    fontSize: 10,
    panelTitleH: 20,
    buttonH: 24,
    inputH: 32,
    barH: 16,
    sliderH: 16,
    accent: "#ffe06b",
    accentSoft: "#ad7e2b",
    text: "#fff4d2",
    textDim: "#d7bc82",
    panelBg: "rgba(27,42,62,0.96)",
    border: "#fff06a",
    bg: "#765638",
    bgHover: "#956f48",
    bgActive: "#4d3927",
    primary: "#c7954f",
    pad: { x: 8, y: 8 },
    textPad: 0,
  };
}

export async function loadKenneyPixelUiTheme(Assets: AssetStore): Promise<Partial<Theme>> {
  const { atlas, config } = await Assets.load({
    atlas: new URL("../assets/themes/kenney-pixel-ui/atlas.png", import.meta.url).href,
    config: new URL("../assets/themes/kenney-pixel-ui/theme.json", import.meta.url).href,
  });
  return createKenneyPixelUiTheme(atlas, config as unknown as TilesetSkinManifest);
}
