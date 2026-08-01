import { Tiles } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { createTilesetSkin, frameFromCell } from "minimotor/ui";
import type { Theme } from "minimotor";

export function createPaperPixelsTheme(atlas: CanvasImageSource): Partial<Theme> {
  const tiles = Tiles.set(atlas, { size: 8, names: { frame: [0, 0, 3, 3] } });
  const frame = frameFromCell(tiles.frame, { left: 8, top: 8, right: 8, bottom: 8 });
  return {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 8, h: 8 },
      frames: { panel: frame, button: frame },
    }),
    font: '"Pixelify Sans", monospace',
    fontSize: 13,
    panelTitleH: 24,
    accent: "#8b4b2f",
    accentSoft: "#7a6a52",
    text: "#3e3428",
    textDim: "#75634d",
    panelBg: "rgba(33,29,26,0.96)",
    border: "#c9b98e",
    bg: "#d0c2a0",
    bgHover: "#ddd0b2",
    bgActive: "#9d8d6d",
    primary: "#b95d47",
    pad: { x: 8, y: 8 },
    textPad: 0,
  };
}

export async function loadPaperPixelsTheme(Assets: AssetStore): Promise<Partial<Theme>> {
  const { atlas } = await Assets.load({
    atlas: new URL("../assets/themes/paper-pixels/atlas.png", import.meta.url).href,
  });
  return createPaperPixelsTheme(atlas);
}
