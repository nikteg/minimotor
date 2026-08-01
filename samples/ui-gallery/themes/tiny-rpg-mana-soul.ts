import { Tiles } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { createTilesetSkin, frameFromCell } from "minimotor/ui";
import type { TilesetCellSource, Theme } from "minimotor";

export interface TinyRpgThemes {
  theme: Partial<Theme>;
  panelAlt: Partial<Theme>;
}

export function createTinyRpgThemes(atlas: CanvasImageSource): TinyRpgThemes {
  const panels = Tiles.set(atlas, {
    size: 16,
    names: { panel: [0, 0, 6, 6], panelAlt: [7, 0, 6, 6] },
  });
  const titles = Tiles.set(atlas, {
    size: 16,
    names: { title: [14, 0, 6, 2] },
  });
  const tabs = Tiles.set(atlas, {
    size: 16,
    names: {
      base: [0, 7, 6, 2],
      hover: [6, 7, 6, 2],
      active: [12, 7, 6, 2],
      disabled: [6, 10, 6, 2],
    },
  });
  const buttons = (image: CanvasImageSource, y: number) =>
    Tiles.set(image, {
      size: 1,
      names: {
        default: [0, y, 96, 22],
        hover: [96, y, 96, 22],
        active: [192, y, 96, 22],
        disabled: [288, y, 96, 22],
      },
    });
  const normalButtons = buttons(atlas, 256);
  // The pack shades the button plate with a 4-step ramp — one blue for the
  // default/pressed states, one green for hover — over gold arrow caps that
  // every state shares. A semantic variant is that SAME art with just those two
  // ramps palette-swapped: the caps, outline, bevel and per-state shading stay
  // pixel-identical, and only the plate changes hue. (Blending a tint over the
  // whole frame instead would drag the gold caps along with it.)
  const plateRamp = (
    lit: string,
    body: string,
    shade: string,
    deep: string,
    hoverLit: string,
    hoverBody: string,
    hoverShade: string,
    hoverDeep: string,
  ): Record<string, string> => ({
    "#07c2ed": lit, // default plate: highlight
    "#4193d5": body, //                face (and the pressed plate's highlight)
    "#425db0": shade, //               bevel (and the pressed plate's face)
    "#332370": deep, //                deepest shadow
    "#d0e12e": hoverLit, // hover plate, same four steps
    "#8dde32": hoverBody,
    "#31ce60": hoverShade,
    "#00ab55": hoverDeep,
  });
  const primaryButtons = buttons(
    Tiles.recolor(
      atlas,
      plateRamp(
        "#ffd08a",
        "#e8894a",
        "#a9522c",
        "#5c2a1c",
        "#ffe6a8",
        "#ffab5c",
        "#d9703a",
        "#8f4324",
      ),
    ),
    256,
  );
  const dangerButtons = buttons(
    Tiles.recolor(
      atlas,
      plateRamp(
        "#ffb3c0",
        "#d75a76",
        "#9c3350",
        "#55182f",
        "#ffd2da",
        "#f37e95",
        "#c44a68",
        "#86293f",
      ),
    ),
    256,
  );
  const bars = Tiles.set(atlas, {
    size: 1,
    names: {
      track: [0, 352, 95, 17],
      gold: [112, 352, 95, 15],
      light: [224, 352, 95, 15],
    },
  });
  const nine = (
    cell: TilesetCellSource,
    insets: { left: number; top: number; right: number; bottom: number },
  ) => frameFromCell(cell, insets);
  const panelFrame = nine(panels.panel, {
    left: 16,
    top: 16,
    right: 16,
    bottom: 16,
  });
  const panelAltFrame = nine(panels.panelAlt, {
    left: 16,
    top: 16,
    right: 16,
    bottom: 16,
  });
  const titleFrame = nine(titles.title, {
    left: 16,
    top: 0,
    right: 16,
    bottom: 0,
  });
  // The alternate title strip is not a 16px-grid region: its source strip is
  // 96×24px. Keep the full height and give its wide end caps their actual 32px
  // slice widths so the center does not consume the decorative corners.
  const titleAltCell: TilesetCellSource = {
    image: atlas,
    sx: 21 * 16,
    sy: 0,
    sw: 96,
    sh: 24,
  };
  const titleAltFrame = nine(titleAltCell, {
    left: 32,
    top: 0,
    right: 32,
    bottom: 0,
  });
  // The tab/input art is a 96×32 plate whose only decoration is a corner
  // bracket in each corner: the brackets sit at x 7–17 / 75–85 and y 5–8 /
  // 23–25. The corner slices must CONTAIN them — 16px-wide corners cut each
  // bracket in half and the leftover half then tiles across the middle as
  // stray marks. The centre slices are the plain fill and the straight
  // mid-section of the bracket's side rule, which repeat cleanly.
  const tabFrame = (cell: TilesetCellSource) =>
    nine(cell, { left: 24, top: 10, right: 24, bottom: 11 });
  // 21px is the narrowest corner that leaves a FLAT centre column in all four
  // button states: the arrow caps, the plate's bevel and the pressed/disabled
  // states' deeper inset all end by x 21 / x 75. Anything narrower keeps a piece
  // of that edge inside the repeating centre, which then re-draws it every
  // centre-width as a vertical slit down a wide button. Vertically the only
  // repeatable band is the flat face (rows 6–15) — the rows outside it carry the
  // top highlight and the bottom shadow.
  const arrowButtonFrame = (cell: TilesetCellSource) =>
    nine(cell, { left: 21, top: 6, right: 21, bottom: 6 });
  const inputFrame = tabFrame(tabs.base);
  const inputHoverFrame = tabFrame(tabs.hover);
  const inputActiveFrame = tabFrame(tabs.active);
  const inputDisabledFrame = tabFrame(tabs.disabled);
  const barTrack = nine(bars.track, { left: 8, top: 6, right: 8, bottom: 6 });
  // The vertical scrollbar is the same horizontal source art rotated by the
  // shared UI painter. Its source caps must fit the scrollbar's 10px width.
  const scrollTrack = nine(bars.track, {
    left: 8,
    top: 4,
    right: 8,
    bottom: 4,
  });
  const barGold = nine(bars.gold, { left: 8, top: 5, right: 8, bottom: 5 });
  const barLight = nine(bars.light, { left: 8, top: 5, right: 8, bottom: 5 });

  const theme: Partial<Theme> = {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 16, h: 16 },
      frames: {
        panel: panelFrame,
        panelTitle: titleFrame,
        button: arrowButtonFrame(normalButtons.default),
        buttonHover: arrowButtonFrame(normalButtons.hover),
        buttonActive: arrowButtonFrame(normalButtons.active),
        disabled: arrowButtonFrame(normalButtons.disabled),
        input: inputFrame,
        inputHover: inputHoverFrame,
        inputActive: inputActiveFrame,
        inputDisabled: inputDisabledFrame,
        tab: tabFrame(tabs.base),
        tabHover: tabFrame(tabs.hover),
        tabActive: tabFrame(tabs.active),
        barTrack,
        barFill: barGold,
        sliderTrack: barTrack,
        sliderFill: barLight,
        scrollTrack,
        scrollThumb: barGold,
        scrollThumbHover: barLight,
        scrollThumbActive: barLight,
      },
      buttonVariants: {
        // The disabled state keeps the pack's own greyed-out button in every
        // variant: a disabled button reads as "off", not as a dim primary.
        primary: {
          default: arrowButtonFrame(primaryButtons.default),
          hover: arrowButtonFrame(primaryButtons.hover),
          active: arrowButtonFrame(primaryButtons.active),
          disabled: arrowButtonFrame(normalButtons.disabled),
        },
        danger: {
          default: arrowButtonFrame(dangerButtons.default),
          hover: arrowButtonFrame(dangerButtons.hover),
          active: arrowButtonFrame(dangerButtons.active),
          disabled: arrowButtonFrame(normalButtons.disabled),
        },
        ghost: {
          default: arrowButtonFrame(normalButtons.default),
          hover: arrowButtonFrame(normalButtons.hover),
          active: arrowButtonFrame(normalButtons.active),
          disabled: arrowButtonFrame(normalButtons.disabled),
        },
      },
      sprites: {
        // The first cursor frame occupies a 42×20 cell, but its opaque art is
        // 40×19. Trim the transparent trailing edge so the slider anchor and
        // endpoint line up with the visible sprite.
        cursor: { image: atlas, region: { sx: 336, sy: 352, sw: 40, sh: 19 } },
        // The whole comet is the knob, but its HEAD is the handle — the tail
        // trails off to the right. Anchor on the head's center (source x 0–17,
        // y 1–18) so the value sits under the ball rather than under the middle
        // of the tail.
        sliderKnob: {
          image: atlas,
          region: { sx: 336, sy: 352, sw: 40, sh: 19 },
          anchor: { x: 9, y: 10 },
        },
      },
    }),
    // Lo-Res 28 Narrow is the narrow bitmap variation from Adobe Fonts.
    // Micro5 is the closest bundled fallback when Adobe Fonts is unavailable.
    font: '"VT323", monospace',
    fontSize: 16,
    textOutline: { color: "#1a143e", width: 3 },
    buttonW: 0,
    buttonMinW: 96,
    buttonH: 22,
    inputH: 32,
    barH: 15,
    sliderH: 15,
    tabH: 32,
    panelTitleH: 32,
    panelTitlePad: { x: 8, y: 0 },
    panelTitleOverhang: { x: 16, y: 0 },
    buttonText: {
      default: "#fff2b7",
      primary: "#fff2b7",
      danger: "#fff2b7",
      ghost: "#fff2b7",
      disabled: "#8d7952",
    },
    panelTitleText: "#ffffff",
    accent: "#ffd34e",
    accentSoft: "#ad7628",
    text: "#fff2b7",
    textDim: "#c7ad70",
    panelBg: "rgba(12,16,53,0.97)",
    border: "#e2a32e",
    bg: "#31376e",
    bgHover: "#4b5598",
    bgActive: "#20254e",
    primary: "#d86a39",
    pad: { x: 16, y: 16 },
    textPad: { x: 2, y: 1 },
  };
  const panelAlt: Partial<Theme> = {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 16, h: 16 },
      frames: {
        ...theme.skin!.frames,
        panel: panelAltFrame,
        panelTitle: titleAltFrame,
      },
      buttonVariants: theme.skin!.buttonVariants,
      sprites: theme.skin!.sprites,
    }),
    panelTitleH: 24,
    panelTitlePad: { x: 4, y: -2 },
    panelTitleOverhang: { x: 24, y: 0 },
  };
  return { theme, panelAlt };
}

export async function loadTinyRpgThemes(Assets: AssetStore): Promise<TinyRpgThemes> {
  const { atlas } = await Assets.load({
    atlas: new URL("../assets/themes/tiny-rpg-mana-soul/atlas.png", import.meta.url).href,
  });
  return createTinyRpgThemes(atlas);
}
