import { type NineSliceRegion, type TilesetButtonVariant, type ThemeTextOutline } from "../../ui/theme.js";
export { defaultTheme, getTheme, resolveThemePadding, resolveThemeTextPadding, setTheme, theme, withTheme, } from "../../ui/theme.js";
export { createTilesetSkin, createTilesetSkinFromManifest, frameFromCell, inspectTilesetSkin, type NineSliceRegion, type TileRegion, type TilesetFrameRole, type TilesetButtonState, type TilesetButtonVariant, type TilesetButtonVariants, type TilesetSkin, type TilesetSkinOptions, type TilesetSprite, type TilesetCellSource, type TilesetManifestRegion, type TilesetManifestSprite, type TilesetSkinManifest, type TilesetMapping, type TilesetButtonVariantsManifest, type TilesetDebugEntry, type TilesetDebugInfo, type ThemeOverrides, type ThemeButton, type ThemePanel, type ThemePanelTitle, type ThemePadding, type ResolvedThemePadding, type ThemeSpacing, type ThemeTextPadding, type ThemeTextOutline, type ThemeButtonText, type ThemeSelect, type ThemeFocusStyle, shade, } from "../../ui/theme.js";
export type { Theme } from "../../ui/theme.js";
export declare const uiFont: (size?: number, bold?: boolean) => string;
/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
export declare function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void;
export type ThemeBoxRole = "panel" | "panelTitle" | "menuGroup" | "button" | "input" | "tab" | "barTrack" | "barFill" | "sliderTrack" | "sliderFill" | "scrollTrack" | "scrollThumb";
export type ThemeBoxState = "default" | "hover" | "active" | "disabled";
/** Paint one named sprite from the active skin. Widgets use semantic names
 *  (`selectArrow`, `checkboxOn`, `radioOff`, …), while a theme decides which
 *  atlas region supplies that name. Returns false when the skin has no such
 *  sprite so the caller can use its procedural fallback. */
export declare function drawThemeSprite(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w?: number, h?: number): boolean;
/** Paint a pixel-native nine-slice region, clipping partial repeats. */
export declare function drawNineSlice(ctx: CanvasRenderingContext2D, image: CanvasImageSource, region: NineSliceRegion, x: number, y: number, w: number, h: number): void;
/** Fill (and optionally stroke) a themed box: rounded per `theme.radius`,
 *  stroked at `theme.borderWidth` inset so the outline stays inside the rect.
 *  `radius`/`border` override the theme for one call. */
export declare function drawBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: {
    fill?: string;
    stroke?: string;
    radius?: number;
    border?: number;
    role?: ThemeBoxRole;
    state?: ThemeBoxState;
    variant?: "default" | TilesetButtonVariant;
    axis?: "x" | "y";
}): void;
/** Trim `text` with a trailing ellipsis until it fits `maxW` (binary search).
 *  Returns the string unchanged when it already fits. Every probe goes through
 *  the memo, so a label that keeps its text and width costs map hits after the
 *  first frame instead of ~log₂(n) real measurements. */
export declare function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string;
/** Vertically centered text using stable font line metrics — the canvas
 *  "middle" baseline sits visibly high for most fonts. Honors the current textAlign.
 *  `maxW` clips with an ellipsis (via `ellipsize`) so a label can never spill
 *  out of its widget. */
export declare function centeredText(ctx: CanvasRenderingContext2D, text: string, x: number, cy: number, maxW?: number, outlineOverride?: ThemeTextOutline): void;
/** One run of a line that is drawn in a single colour. `color` is already
 *  RESOLVED to a CSS colour (theme roles are mapped by the caller, which is
 *  what keeps this module below `text.ts`); `undefined` keeps whatever
 *  `fillStyle` the caller set, which is how a run with no colour of its own
 *  inherits the label's. */
export interface TextRun {
    text: string;
    color?: string;
}
/** `centeredText` for a line made of several differently coloured runs.
 *
 *  Canvas has one `fillStyle` per `fillText`, so a multi-colour line has to be
 *  drawn run by run — but it must still be ELLIPSIZED, ALIGNED and BASELINED as
 *  the one string it is, or a coloured word would change where the line sits.
 *  So the combined string does all of that, and only the painting is split: the
 *  ellipsis is applied to the whole line and then sliced back over the runs by
 *  character offset, the left origin is derived from the combined width under
 *  the caller's `textAlign`, and each run is then placed at the combined
 *  string's own offset for it (see the loop) rather than at the running sum of
 *  the runs' widths — the two differ wherever the font kerns across the split.
 *
 *  A single run is handed straight to `centeredText`, so the overwhelmingly
 *  common case draws through exactly the code it always did. */
export declare function centeredSpans(ctx: CanvasRenderingContext2D, runs: readonly TextRun[], x: number, cy: number, maxW?: number, outlineOverride?: ThemeTextOutline): void;
