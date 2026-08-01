import type { ThemeOverrides } from "minimotor";
import type { AssetStore } from "minimotor/assets";
import { inspectTilesetSkin } from "minimotor/ui";
import { loadTinyRpgThemes, type TinyRpgThemes } from "./themes/tiny-rpg-mana-soul.ts";
import { loadVisualsTheme } from "./themes/visuals.ts";
import { loadKenneyPixelUiTheme } from "./themes/kenney-pixel-ui.ts";
import { loadKenneyPixelAdventureTheme } from "./themes/kenney-pixel-adventure.ts";
import { loadHexanyTheme } from "./themes/hexany-1bit.ts";
import { loadPaperPixelsTheme } from "./themes/paper-pixels.ts";
import type { GalleryAtlasDebug, GalleryAtlasVariant } from "./gallery-theme-types.ts";

export interface GalleryThemeAlternative {
  /** Stable consumer-facing key, independent of the display label. */
  key: string;
  label: string;
  theme: ThemeOverrides;
}

export interface GalleryThemeSources {
  visuals: ThemeOverrides;
  kenneyUi: ThemeOverrides;
  kenneyAdventure: ThemeOverrides;
  tiny: TinyRpgThemes;
  hexany: ThemeOverrides;
  paper: ThemeOverrides;
}

export interface GalleryThemeCatalogOptions {
  /** Define alternate scopes after all theme factories have been created. The
   * returned themes are inspected automatically; no atlas debug entries are
   * required. */
  defineAlternatives?: (
    themes: GalleryThemeSources,
  ) => Readonly<Record<string, readonly GalleryThemeAlternative[]>>;
}

export interface GalleryThemeCatalog {
  presets: { label: string; value: string; preset: ThemeOverrides }[];
  alternatives: Readonly<Record<string, readonly GalleryThemeAlternative[]>>;
  atlasDebug: Readonly<Record<string, GalleryAtlasDebug>>;
}

export async function createGalleryThemeCatalog(
  Assets: AssetStore,
  options: GalleryThemeCatalogOptions = {},
): Promise<GalleryThemeCatalog> {
  const [visuals, kenneyUi, kenneyAdventure, tiny, hexany, paper] = await Promise.all([
    loadVisualsTheme(Assets),
    loadKenneyPixelUiTheme(Assets),
    loadKenneyPixelAdventureTheme(Assets),
    loadTinyRpgThemes(Assets),
    loadHexanyTheme(Assets),
    loadPaperPixelsTheme(Assets),
  ]);
  const themes: GalleryThemeSources = {
    visuals,
    kenneyUi,
    kenneyAdventure,
    tiny,
    hexany,
    paper,
  };
  const alternatives = options.defineAlternatives?.(themes) ?? {};

  const inspectPreset = (preset: ThemeOverrides): GalleryAtlasVariant | undefined => {
    if (!preset.skin) return undefined;
    return { label: "Default", ...inspectTilesetSkin(preset.skin) };
  };
  const presets = [
    { label: "Visuals", value: "visuals", preset: visuals },
    { label: "Kenney Pixel UI + Press Start", value: "kenney-pixel-ui", preset: kenneyUi },
    {
      label: "Kenney Pixel Adventure + VT323",
      value: "kenney-pixel-adventure",
      preset: kenneyAdventure,
    },
    {
      label: "Tiny RPG Mana Soul + Lo-Res 28 Narrow",
      value: "tiny-rpg-mana-soul",
      preset: tiny.theme,
    },
    { label: "Hexany 1-bit + DotGothic16", value: "hexany-1bit", preset: hexany },
    { label: "Paper Pixels + Pixelify Sans", value: "paper-pixels", preset: paper },
    { label: "Teal", value: "teal", preset: { radius: 0, borderWidth: 2, font: "monospace" } },
    {
      label: "VT323 CRT",
      value: "vt323",
      preset: {
        accent: "#7dff87",
        accentSoft: "#3d9f4a",
        primary: "#7dff87",
        text: "#c9ffd0",
        textDim: "#6eb879",
        bg: "#12351b",
        bgHover: "#1b4d25",
        bgActive: "#0b2110",
        border: "#36783f",
        panel: { background: "rgba(4,16,7,0.96)" },
        radius: 0,
        borderWidth: 2,
        font: '"VT323", monospace',
        fontSize: 18,
      },
    },
    {
      label: "Amber",
      value: "amber",
      preset: {
        accent: "#ffb454",
        accentSoft: "#a9772f",
        primary: "#ffb454",
        radius: 12,
        borderWidth: 1,
        font: "system-ui, sans-serif",
        fontSize: 14,
      },
    },
    {
      label: "Crimson",
      value: "crimson",
      preset: {
        accent: "#ff6b6b",
        accentSoft: "#a24444",
        primary: "#ff6b6b",
        radius: 0,
        borderWidth: 3,
        font: "'Courier New', monospace",
      },
    },
    {
      label: "Emerald",
      value: "emerald",
      preset: {
        accent: "#4ade80",
        accentSoft: "#2f8f57",
        primary: "#4ade80",
        radius: 8,
        borderWidth: 2,
        font: "'Trebuchet MS', system-ui, sans-serif",
        fontSize: 14,
      },
    },
    {
      label: "Violet",
      value: "violet",
      preset: {
        accent: "#a78bfa",
        accentSoft: "#6f5ab0",
        primary: "#a78bfa",
        radius: 16,
        borderWidth: 2,
        font: "Georgia, 'Times New Roman', serif",
        fontSize: 15,
      },
    },
    {
      label: "Slate Light",
      value: "slate-light",
      preset: {
        accent: "#2563eb",
        accentSoft: "#7aa2e8",
        primary: "#2563eb",
        text: "#1b2330",
        textDim: "#5a6675",
        textDisabled: "#9aa5b1",
        bg: "#e6ebf1",
        bgHover: "#dce3ec",
        bgActive: "#cdd6e2",
        border: "#b3bfce",
        panel: { background: "rgba(244,247,250,0.96)" },
        track: "rgba(0,0,0,0.12)",
        dim: "rgba(30,40,60,0.35)",
        danger: "#e5484d",
        radius: 8,
        borderWidth: 1,
        font: "system-ui, sans-serif",
        fontSize: 14,
      },
    },
  ];

  return {
    presets,
    alternatives,
    atlasDebug: Object.fromEntries(
      presets.flatMap(({ value, preset }) => {
        const inspected = inspectPreset(preset);
        if (!inspected) return [];
        const variants = (alternatives[value] ?? []).flatMap((alternative) => {
          const inspectedAlternative = inspectPreset(alternative.theme);
          return inspectedAlternative
            ? [{ ...inspectedAlternative, label: alternative.label }]
            : [];
        });
        return [[value, { ...inspected, variants } satisfies GalleryAtlasDebug] as const];
      }),
    ) as Readonly<Record<string, GalleryAtlasDebug>>,
  };
}
