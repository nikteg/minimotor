/** A source rectangle in a tileset or sprite image. */
export interface TileRegion {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}
/** Source-layout family shown by atlas tooling. */
export type TilesetMapping = "sprite" | "region" | "nine-slice" | "auto4" | "auto9" | "auto16" | "orient";
/** Fixed source-pixel corners around a repeatable nine-slice center. */
export interface NineSliceRegion extends TileRegion {
    insets: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
    /** Optional source image for this frame. Defaults to `TilesetSkin.image`. */
    image?: CanvasImageSource;
    /** Optional explicit source mapping; otherwise atlas inspection infers it. */
    mapping?: TilesetMapping;
    /** Orientation of the source frame. Horizontal is the default. */
    orientation?: "x" | "y";
}
export type TilesetFrameRole = "panel" | "panelTitle"
/** Backdrop for a group header inside a select menu. A pack that ships two
 *  title strips can spend the alternate one here so a section header reads
 *  as a header without being mistaken for the panel's own title. */
 | "menuGroup" | "button" | "buttonHover" | "buttonActive" | "input" | "inputHover" | "inputActive" | "inputDisabled" | "disabled" | "barTrack" | "barFill" | "sliderTrack" | "sliderFill" | "scrollTrack" | "scrollThumb" | "scrollThumbHover" | "scrollThumbActive" | "tab" | "tabHover" | "tabActive";
export type TilesetButtonVariant = "primary" | "danger" | "ghost";
export type TilesetButtonState = "default" | "hover" | "active" | "disabled";
/** How keyboard/gamepad focus is painted by interactive widgets. */
export type ThemeFocusStyle = "ring" | "hover";
export type TilesetButtonVariants = Partial<Record<TilesetButtonVariant, Partial<Record<TilesetButtonState, NineSliceRegion>>>>;
export interface TilesetSprite {
    image: CanvasImageSource;
    region: TileRegion;
    mapping?: TilesetMapping;
    /** The point INSIDE `region` (source px, from its top-left) that lands on
     *  whatever the sprite marks — a slider knob's value, a cursor's hotspot.
     *  Defaults to the region's center. Asymmetric art needs it: a comet-shaped
     *  knob is grabbed by its head, not by the middle of its tail. */
    anchor?: {
        x: number;
        y: number;
    };
}
/** The source shape shared by `Tiles.Cell` and UI frame definitions. Keeping
 *  this structural lets a `Tiles.set(...).region(...)` or named cell feed a UI
 *  skin without making the UI package depend on a particular tileset factory. */
export interface TilesetCellSource extends TileRegion {
    image: CanvasImageSource;
}
/** Turn a named `Tiles.Cell`/region into a repeatable UI frame definition. */
export declare function frameFromCell(cell: TilesetCellSource, insets: NineSliceRegion["insets"]): NineSliceRegion;
/** Typed, validated art roles consumed by the immediate-mode widgets. */
export interface TilesetSkin {
    readonly image: CanvasImageSource;
    readonly tileSize: {
        readonly w: number;
        readonly h: number;
    };
    readonly frames: Partial<Record<TilesetFrameRole, NineSliceRegion>>;
    /** Optional frames for semantic variants. Without one, that variant uses
     *  the normal color painter instead of borrowing the default button art. */
    readonly buttonVariants: TilesetButtonVariants;
    readonly sprites: {
        readonly cursor?: TilesetSprite;
        readonly divider?: TilesetSprite;
        readonly sliderKnob?: TilesetSprite;
        readonly icons?: Readonly<Record<string, TilesetSprite>>;
    };
}
export interface TilesetSkinOptions {
    tileSize: {
        w: number;
        h: number;
    };
    frames?: Partial<Record<TilesetFrameRole, NineSliceRegion>>;
    buttonVariants?: TilesetButtonVariants;
    sprites?: {
        cursor?: TilesetSprite;
        divider?: TilesetSprite;
        sliderKnob?: TilesetSprite;
        icons?: Readonly<Record<string, TilesetSprite>>;
    };
}
/** JSON-friendly atlas region used by `createTilesetSkinFromManifest`. */
export interface TilesetManifestRegion {
    x: number;
    y: number;
    w: number;
    h: number;
    insets?: NineSliceRegion["insets"];
    mapping?: TilesetMapping;
    orientation?: "x" | "y";
}
export interface TilesetSkinManifest {
    tileSize: {
        w: number;
        h: number;
    };
    frames?: Partial<Record<TilesetFrameRole, TilesetManifestRegion>>;
    buttonVariants?: TilesetButtonVariantsManifest;
    sprites?: {
        cursor?: TilesetManifestSprite;
        divider?: TilesetManifestSprite;
        sliderKnob?: TilesetManifestSprite;
        icons?: Record<string, TilesetManifestSprite>;
    };
}
export interface TilesetManifestSprite {
    x: number;
    y: number;
    w: number;
    h: number;
    mapping?: TilesetMapping;
}
export type TilesetButtonVariantsManifest = Partial<Record<TilesetButtonVariant, Partial<Record<TilesetButtonState, TilesetManifestRegion>>>>;
/** One automatically discoverable source region in a skin. */
export interface TilesetDebugEntry {
    label: string;
    region: TileRegion;
    image: CanvasImageSource;
    /** Present when the region is an integer grid of skin tiles. */
    split?: {
        cols: number;
        rows: number;
    };
    mapping: TilesetMapping;
    insets?: NineSliceRegion["insets"];
}
/** Introspection data for atlas/theme tooling. This is derived from the skin;
 *  theme authors never have to maintain a second debug-only list. */
export interface TilesetDebugInfo {
    image: CanvasImageSource;
    tileSize: {
        w: number;
        h: number;
    };
    entries: readonly TilesetDebugEntry[];
}
/** Extract every frame, button variant state, and named sprite from a skin.
 *  It is intentionally pure and cheap enough for an inspector opened on
 *  demand; the returned entries are source-space facts, not draw commands. */
export declare function inspectTilesetSkin(skin: TilesetSkin): TilesetDebugInfo;
/** Shared spacing scale used by widgets for internal insets and default gaps. */
export interface ThemeSpacing {
    /** Hairline/detail spacing. Default 2. */
    xs: number;
    /** Compact control spacing. Default 4. */
    sm: number;
    /** Standard widget spacing. Default 8. */
    md: number;
    /** Large content spacing. Default 12. */
    lg: number;
    /** Frame/tooltip-scale spacing. Default 16. */
    xl: number;
}
/** Content padding. `x`/`y` are shorthands for the two horizontal/vertical
 *  edges; an explicit edge wins over its shorthand. */
export interface ThemePadding {
    x?: number;
    y?: number;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}
/** Fully resolved padding. `x`/`y` retain the legacy meaning of the near
 *  edges (left/top); use the named edges when asymmetry matters. */
export interface ResolvedThemePadding {
    x: number;
    y: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}
/** A text inset may stay as a scalar for compatibility, or use axis/edge
 *  values for pixel UI. */
export type ThemeTextPadding = number | ThemePadding;
/** Resolve a scalar, axis shorthand, or explicit-edge padding value. */
export declare function resolveThemePadding(value: number | ThemePadding | undefined, fallback?: number | ThemePadding): ResolvedThemePadding;
/** Resolve a scalar or edge-aware text inset without making widgets duplicate
 *  the compatibility logic. */
export declare function resolveThemeTextPadding(value: ThemeTextPadding | undefined, fallback?: ThemeTextPadding): ResolvedThemePadding;
/** Semantic label colors for button variants. Per-button `color` still wins. */
export interface ThemeButtonText {
    default: string;
    primary: string;
    danger: string;
    ghost: string;
    disabled: string;
}
/** Colors of a `select` drop-menu's rows. The menu used to borrow the button
 *  variants (`primary` for the current value, `ghost` for the rest), which tied
 *  a list to a call-to-action's palette: restyling the primary button moved the
 *  dropdown highlight with it, and a pixel skin's button frame leaked into rows
 *  that are not buttons. These tokens are the menu's own.
 *
 *  Every one of them DEFAULTS to the token it used to borrow, so a theme that
 *  sets none looks exactly as it did — and a theme that only sets `primary` or
 *  `accent` still tints the menu, because the defaults resolve after the merge. */
export interface ThemeSelect {
    /** Row label. */
    text: string;
    /** Label of the row holding the current value. */
    textSelected: string;
    /** Label of an unselectable row. */
    textDisabled: string;
    /** Row fill when idle. `"transparent"` lets the menu frame show through. */
    bg: string;
    /** Row fill when hovered. */
    bgHover: string;
    /** Row fill while held. */
    bgActive: string;
    /** Fill of an unselectable row. */
    bgDisabled: string;
    /** Fill behind the current value's row. */
    bgSelected: string;
    /** Fill behind the current value's row when hovered. */
    bgSelectedHover: string;
    /** Fill behind the current value's row while held. */
    bgSelectedActive: string;
    /** Heading above a group of rows in a grouped menu. */
    groupLabel: string;
}
export declare function shade(color: string, dark: boolean): string;
/** Optional canvas text outline used by pixel fonts with a dark keyline. */
export interface ThemeTextOutline {
    color: string;
    width: number;
}
/** Shared button appearance and sizing tokens. Button padding uses the same
 *  edge-aware shape as layout padding; `x` is the per-side shorthand. */
export interface ThemeButton {
    text: ThemeButtonText;
    padding: ThemePadding;
    width: number;
    minWidth: number;
    height: number;
}
/** The title strip is nested because its metrics describe one coherent part
 *  of a panel rather than independent global tokens. */
export interface ThemePanelTitle {
    height: number;
    color?: string;
    /** Fill behind the title strip. Unset paints the default 6%-white wash over
     *  whatever the panel's own background is — a hint of a band rather than a
     *  band. Set it for a header bar that reads as its own surface; it is clipped
     *  to the panel's inner outline, so a solid colour keeps the panel's rounded
     *  corners and does not paint over its border. */
    background?: string;
    padding: ThemePadding;
    overhang: ThemePadding;
}
/** Shared panel/group/modal surface tokens. `frameInset` is art clearance;
 *  `padding` is the content inset and can be tuned independently. */
export interface ThemePanel {
    background: string;
    padding: ThemePadding;
    frameInset: ThemePadding;
    title: ThemePanelTitle;
}
/** Build a reusable skin from an image and source-pixel role manifest. */
export declare function createTilesetSkin(image: CanvasImageSource, options: TilesetSkinOptions): TilesetSkin;
/** Build a validated skin from a serializable atlas/theme manifest. A JSON
 *  file only needs `x/y/w/h`; runtime image references are supplied once by
 *  the caller. The resulting `TilesetSkin` is the same primitive used by all
 *  widgets and by `inspectTilesetSkin`. */
export declare function createTilesetSkinFromManifest(image: CanvasImageSource, manifest: TilesetSkinManifest): TilesetSkin;
/** Every color, font and metric the widgets use. Override any subset with
 *  `setTheme`; per-widget style options still win over the theme. */
export interface Theme {
    /** Shared spacing scale used by widget defaults. */
    spacing: ThemeSpacing;
    /** Font family for all widget text. */
    font: string;
    /** Base label size in px; widget fonts scale from it. */
    fontSize: number;
    /** Highlight color: active tab underline, hover borders, fills, knobs. */
    accent: string;
    /** Dimmer accent for resting knobs/thumbs. */
    accentSoft: string;
    /** Primary text. */
    text: string;
    /** Secondary text: captions, inactive tabs, disabled hints. */
    textDim: string;
    /** Disabled label text. */
    textDisabled: string;
    /** Semantic button appearance and sizing. Individual button options win. */
    button: ThemeButton;
    /** Shared panel/group/modal surface appearance and content geometry. */
    panel: ThemePanel;
    /** Colors of a `select` drop-menu's rows — see `ThemeSelect`. */
    select: ThemeSelect;
    /** Widget fill when idle. */
    bg: string;
    /** Widget fill when hovered. */
    bgHover: string;
    /** Widget fill when held/pressed — also the recessed tone for insets
     *  (checkbox well) and disabled/inactive fills. */
    bgActive: string;
    /** Widget border when not hovered. */
    border: string;
    /** Track behind sliders/scrollbars/bars. */
    track: string;
    /** The modal backdrop. */
    dim: string;
    /** Fill of a `variant: "primary"` button. */
    primary: string;
    /** Fill of a `variant: "danger"` button. */
    danger: string;
    /** Border thickness in px for buttons/panels/toggles/tabs. Default 2. */
    borderWidth: number;
    /** Corner radius in px (0 = square). Default 0. */
    radius: number;
    /** Default single-line text-input height in px. Default 32. */
    inputH: number;
    /** Default bar height in px. Default 12. Pixel skins can match their native
     *  track/fill sheet height. */
    barH: number;
    /** Default interactive slider track height in px. Default 4. */
    sliderH: number;
    /** Thickness of a scrollbar — the width of a vertical one, the height of a
     *  horizontal one. Default 10. A pixel skin whose `scrollTrack` art is a
     *  fixed-width rail sets this to that width so the rail is not stretched. */
    scrollbarW: number;
    /** Space between a scrollable body and the scrollbar beside it. Reserved on
     *  top of `scrollbarW`, so the gutter a scrolling container takes out of its
     *  own width is `scrollbarW + scrollbarGap`. Default 4. */
    scrollbarGap: number;
    /** Default tab-strip height in px. Default 30. */
    tabH: number;
    /** Default inset (px) applied by `UI.text` when no `pad`/`padX`/`padY` is
     *  given. 0 keeps a label flush with its slot (so it lines up with sibling
     *  widgets and HUD columns); raise it for a global label inset. Default 0. */
    textPad: ThemeTextPadding;
    /** Optional outline painted behind UI text. */
    textOutline?: ThemeTextOutline;
    /** Keyboard/gamepad focus treatment. `ring` is the default; `hover` makes
     *  focused controls reuse their ordinary hover appearance. */
    focusStyle: ThemeFocusStyle;
    /** Optional pixel-art skin. When absent, widgets use the color painter. */
    skin?: TilesetSkin;
}
/** Partial theme update with independently overridable spacing tokens. */
export type ThemeOverrides = Omit<Partial<Theme>, "spacing" | "button" | "panel" | "select"> & {
    spacing?: Partial<ThemeSpacing>;
    button?: Omit<Partial<ThemeButton>, "text" | "padding"> & {
        text?: Partial<ThemeButtonText>;
        padding?: Partial<ThemePadding>;
    };
    panel?: Omit<Partial<ThemePanel>, "padding" | "frameInset" | "title"> & {
        padding?: Partial<ThemePadding>;
        frameInset?: Partial<ThemePadding>;
        title?: Omit<Partial<ThemePanelTitle>, "padding" | "overhang"> & {
            padding?: Partial<ThemePadding>;
            overhang?: Partial<ThemePadding>;
        };
    };
    select?: Partial<ThemeSelect>;
};
export declare const defaultTheme: Theme;
export declare let theme: Theme;
/** Changes whenever theme-dependent auto-layout measurements must be rebuilt. */
export declare let themeRevision: number;
/** Stable cache identity for the active global or locally-scoped theme. */
export declare let themeKey: string;
/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export declare function setTheme(overrides: ThemeOverrides): void;
/** Run a subtree with a theme merged over the currently active theme.
 *
 * The override is lexical: every widget and nested layout container called by
 * `children` sees it, and the previous theme is restored even when `children`
 * throws. The global `setTheme` remains the right choice for restyling the
 * whole canvas; this is the per-element propagation primitive. */
export declare function withTheme<R>(overrides: ThemeOverrides | undefined, children: () => R): R;
/** The active theme (live object — read, don't mutate). */
export declare function getTheme(): Theme;
