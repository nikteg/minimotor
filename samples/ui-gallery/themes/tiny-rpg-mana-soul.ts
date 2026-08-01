import { Tiles } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { createTilesetSkin, frameFromCell } from "minimotor/ui";
import type { TilesetCellSource, ThemeOverrides } from "minimotor";

export interface TinyRpgThemes {
  theme: ThemeOverrides;
  panelAlt: ThemeOverrides;
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
  // Every plate in this pack is drawn with a 7px stub of flat fill hanging off
  // its left edge — the pack butts them against a neighbour. Used as a
  // standalone frame that stub renders as a block sitting OUTSIDE the plate's
  // own border, which is what a wide select box shows on its left side. Each
  // rect therefore starts past the stub and stops at the plate's real right
  // edge, so the widths are the art's bounds rather than a 16px grid.
  const plate = (sx: number, sy: number, sw: number): TilesetCellSource => ({
    image: atlas,
    sx,
    sy,
    sw,
    sh: 32,
  });
  const tabs = {
    base: plate(7, 112, 84),
    hover: plate(103, 112, 88),
    active: plate(199, 112, 87),
    disabled: plate(106, 160, 86),
  };
  // The tabs come off a different sheet entirely. The 96×32 plates are the
  // pack's VERTICAL tab design — a tall stacked list — and a horizontal band of
  // them reads as a row of boxes however they are cut or turned. These are the
  // pack's horizontal bars: a low capsule with a gold rule and a flourish at
  // each end, in one ramp (dim purple → lit mauve → blue) so the state reads
  // as brightness. Their heights differ (18/20/22) because the lit ones carry
  // an outer glow; `tabH` sits at the top of that range so the stretch is a
  // couple of pixels of flat face rather than a resized capsule.
  const bar = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): TilesetCellSource => ({
    image: atlas,
    sx,
    sy,
    sw,
    sh,
  });
  const tabBars = {
    base: bar(194, 290, 93, 18),
    hover: bar(1, 289, 95, 20),
    active: bar(97, 288, 95, 22),
  };
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
  const barRects = {
    track: [0, 352, 95, 17],
    gold: [112, 352, 95, 15],
    light: [224, 352, 95, 15],
    // The light capsule's rounded end caps are a bulb that sits outside the
    // track's own thin outline, so a fill drawn at the track's rect overhangs
    // it to the left. Its flat middle grows out of the track's left cap
    // instead of over it.
    fill: [230, 352, 83, 15],
    // A scrollbar is 10px across and the painter rotates this art into it, so
    // the source HEIGHT is what has to fit. The full 17px track squeezes its
    // 9px centre into 2px and loses both rules; these rects stop at the rules
    // and leave the flourish tips out.
    scrollTrack: [0, 352, 95, 14],
    scrollThumb: [112, 353, 95, 13],
  } as const;
  const bars = Tiles.set(atlas, { size: 1, names: barRects });
  // Hover has to READ as "lit". Swapping in the light capsule inverted the
  // thumb into a dark bar instead; this is the same gold art with its warm
  // ramp pushed toward white, so only the brightness changes.
  const barsHot = Tiles.set(
    Tiles.recolor(atlas, {
      "#f9d42f": "#fff8b0",
      "#fbe4af": "#ffffff",
      "#f4a13a": "#ffd36b",
      "#f27646": "#ffa774",
      "#ac7354": "#e2b48c",
      "#8e4e63": "#c98298",
      "#7c386b": "#b06aa0",
    }),
    { size: 1, names: barRects },
  );
  const nine = (
    cell: TilesetCellSource,
    insets: { left: number; top: number; right: number; bottom: number },
  ) => frameFromCell(cell, insets);
  // 18/14, not 16/16: the gold flourish tips on the panel's left and right
  // rails end at row 17, so a 16px top slice leaves rows 16–17 inside the
  // repeating centre band and every 64px down both edges redraws a tip — the
  // small yellow dots. 18/14 puts the tips in the corner slices and leaves a
  // band that is uniform for its whole 64px.
  const panelFrame = nine(panels.panel, {
    left: 16,
    top: 18,
    right: 16,
    bottom: 14,
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
  // The plate's only decoration is a bracket in each corner, 11px in from the
  // plate's own edge. The corner slices must CONTAIN them — cut one in half
  // and the leftover half tiles across the middle as stray marks — so 16
  // measured from the trimmed rect's edges, which clears the widest bracket by
  // 5px. The centre slices are the plain fill and the straight mid-section of
  // the bracket's side rule, which repeat cleanly.
  const tabFrame = (cell: TilesetCellSource) =>
    nine(cell, { left: 16, top: 10, right: 16, bottom: 11 });
  // 21px is the narrowest corner that leaves a FLAT centre column in all four
  // button states: the arrow caps, the plate's bevel and the pressed/disabled
  // states' deeper inset all end by x 21 / x 75. Anything narrower keeps a piece
  // of that edge inside the repeating centre, which then re-draws it every
  // centre-width as a vertical slit down a wide button. Vertically the only
  // repeatable band is the flat face (rows 6–15) — the rows outside it carry the
  // top highlight and the bottom shadow.
  const arrowButtonFrame = (cell: TilesetCellSource) =>
    nine(cell, { left: 21, top: 6, right: 21, bottom: 6 });
  // The capsule's end flourishes run to x 8 and 12–13 in from its right edge;
  // the face between them is a dithered texture with no repeat unit, so the
  // vertical insets stay generous and leave only a 2px band to tile.
  const tabBarFrame = (cell: TilesetCellSource) =>
    nine(cell, {
      left: 9,
      top: (cell.sh - 2) / 2,
      right: 13,
      bottom: (cell.sh - 2) / 2,
    });
  const inputFrame = tabFrame(tabs.base);
  const inputHoverFrame = tabFrame(tabs.hover);
  const inputActiveFrame = tabFrame(tabs.active);
  const inputDisabledFrame = tabFrame(tabs.disabled);
  const barTrack = nine(bars.track, { left: 8, top: 6, right: 8, bottom: 6 });
  // The vertical scrollbar is the same horizontal source art rotated by the
  // shared UI painter, so the source's HEIGHT lands in the scrollbar's 10px
  // width. Both rects are already trimmed to their rules; the insets keep
  // those rules whole and leave the squeeze to the flat middle.
  const scrollTrack = nine(bars.scrollTrack, {
    left: 8,
    top: 3,
    right: 8,
    bottom: 4,
  });
  const scrollThumb = nine(bars.scrollThumb, {
    left: 8,
    top: 4,
    right: 8,
    bottom: 4,
  });
  const scrollThumbHot = nine(barsHot.scrollThumb, {
    left: 8,
    top: 4,
    right: 8,
    bottom: 4,
  });
  const barFill = nine(bars.fill, { left: 2, top: 5, right: 2, bottom: 5 });

  const theme: ThemeOverrides = {
    skin: createTilesetSkin(atlas, {
      tileSize: { w: 16, h: 16 },
      frames: {
        panel: panelFrame,
        panelTitle: titleFrame,
        // The pack's second title strip earns its keep here: a select menu's
        // group header gets the alternate art, so it reads as a section rule
        // rather than as a second panel title.
        menuGroup: titleAltFrame,
        button: arrowButtonFrame(normalButtons.default),
        buttonHover: arrowButtonFrame(normalButtons.hover),
        buttonActive: arrowButtonFrame(normalButtons.active),
        disabled: arrowButtonFrame(normalButtons.disabled),
        input: inputFrame,
        inputHover: inputHoverFrame,
        inputActive: inputActiveFrame,
        inputDisabled: inputDisabledFrame,
        tab: tabBarFrame(tabBars.base),
        tabHover: tabBarFrame(tabBars.hover),
        tabActive: tabBarFrame(tabBars.active),
        barTrack,
        barFill,
        sliderTrack: barTrack,
        sliderFill: barFill,
        scrollTrack,
        scrollThumb,
        scrollThumbHover: scrollThumbHot,
        scrollThumbActive: scrollThumbHot,
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
        // The whole comet is the slider knob, but its HEAD is the handle — the
        // tail trails off to the right. Anchor on the head's center (source x 0–17,
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
    focusStyle: "hover",
    textOutline: { color: "#1a143e", width: 3 },
    button: {
      padding: { x: 18, y: 0 },
      width: 0,
      minWidth: 96,
      height: 22,
      text: {
        default: "#fff2b7",
        primary: "#fff2b7",
        danger: "#fff2b7",
        ghost: "#fff2b7",
        disabled: "#8d7952",
      },
    },
    inputH: 32,
    barH: 15,
    sliderH: 15,
    tabH: 22,
    panel: {
      title: {
        height: 32,
        padding: { x: 8, y: 0 },
        overhang: { x: 16, y: 0 },
        color: "#ffffff",
      },
      frameInset: { x: 0, y: 0 },
      background: "rgba(12,16,53,0.97)",
      padding: { x: 16, y: 16 },
    },
    accent: "#ffd34e",
    accentSoft: "#ad7628",
    text: "#fff2b7",
    textDim: "#c7ad70",
    border: "#e2a32e",
    bg: "#31376e",
    bgHover: "#4b5598",
    bgActive: "#20254e",
    primary: "#d86a39",
    textPad: { x: 2, y: 1 },
  };
  const panelAlt: ThemeOverrides = {
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
    panel: {
      title: {
        height: 24,
        padding: { x: 4, y: -2 },
        overhang: { x: 24, y: 0 },
      },
    },
  };
  return { theme, panelAlt };
}

export async function loadTinyRpgThemes(
  Assets: AssetStore,
): Promise<TinyRpgThemes> {
  const { atlas } = await Assets.load({
    atlas: new URL(
      "../assets/themes/tiny-rpg-mana-soul/atlas.png",
      import.meta.url,
    ).href,
  });
  return createTinyRpgThemes(atlas);
}
