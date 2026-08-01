// ---------- Theme tokens ----------
// The shared palette/metrics every on-canvas surface styles from — `ui`
// widgets and the on-screen gamepad both read it, so it lives in core rather
// than inside either one. The helpers that PAINT with these tokens (and so
// need text measurement) stay in `ui/core/theme.ts`.

/** A source rectangle in a tileset or sprite image. */
export interface TileRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Source-layout family shown by atlas tooling. */
export type TilesetMapping =
  | "sprite"
  | "region"
  | "nine-slice"
  | "auto4"
  | "auto9"
  | "auto16"
  | "orient";

/** Fixed source-pixel corners around a repeatable nine-slice center. */
export interface NineSliceRegion extends TileRegion {
  insets: { left: number; top: number; right: number; bottom: number };
  /** Optional source image for this frame. Defaults to `TilesetSkin.image`. */
  image?: CanvasImageSource;
  /** Optional explicit source mapping; otherwise atlas inspection infers it. */
  mapping?: TilesetMapping;
  /** Orientation of the source frame. Horizontal is the default. */
  orientation?: "x" | "y";
}

export type TilesetFrameRole =
  | "panel"
  | "panelTitle"
  /** Backdrop for a group header inside a select menu. A pack that ships two
   *  title strips can spend the alternate one here so a section header reads
   *  as a header without being mistaken for the panel's own title. */
  | "menuGroup"
  | "button"
  | "buttonHover"
  | "buttonActive"
  | "input"
  | "inputHover"
  | "inputActive"
  | "inputDisabled"
  | "disabled"
  | "barTrack"
  | "barFill"
  | "sliderTrack"
  | "sliderFill"
  | "scrollTrack"
  | "scrollThumb"
  | "scrollThumbHover"
  | "scrollThumbActive"
  | "tab"
  | "tabHover"
  | "tabActive";
export type TilesetButtonVariant = "primary" | "danger" | "ghost";
export type TilesetButtonState = "default" | "hover" | "active" | "disabled";
export type TilesetButtonVariants = Partial<
  Record<TilesetButtonVariant, Partial<Record<TilesetButtonState, NineSliceRegion>>>
>;

export interface TilesetSprite {
  image: CanvasImageSource;
  region: TileRegion;
  mapping?: TilesetMapping;
  /** The point INSIDE `region` (source px, from its top-left) that lands on
   *  whatever the sprite marks — a slider knob's value, a cursor's hotspot.
   *  Defaults to the region's center. Asymmetric art needs it: a comet-shaped
   *  knob is grabbed by its head, not by the middle of its tail. */
  anchor?: { x: number; y: number };
}

/** The source shape shared by `Tiles.Cell` and UI frame definitions. Keeping
 *  this structural lets a `Tiles.set(...).region(...)` or named cell feed a UI
 *  skin without making the UI package depend on a particular tileset factory. */
export interface TilesetCellSource extends TileRegion {
  image: CanvasImageSource;
}

/** Turn a named `Tiles.Cell`/region into a repeatable UI frame definition. */
export function frameFromCell(
  cell: TilesetCellSource,
  insets: NineSliceRegion["insets"],
): NineSliceRegion {
  return { image: cell.image, sx: cell.sx, sy: cell.sy, sw: cell.sw, sh: cell.sh, insets };
}

/** Typed, validated art roles consumed by the immediate-mode widgets. */
export interface TilesetSkin {
  readonly image: CanvasImageSource;
  readonly tileSize: { readonly w: number; readonly h: number };
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
  tileSize: { w: number; h: number };
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
  tileSize: { w: number; h: number };
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

export type TilesetButtonVariantsManifest = Partial<
  Record<TilesetButtonVariant, Partial<Record<TilesetButtonState, TilesetManifestRegion>>>
>;

/** One automatically discoverable source region in a skin. */
export interface TilesetDebugEntry {
  label: string;
  region: TileRegion;
  image: CanvasImageSource;
  /** Present when the region is an integer grid of skin tiles. */
  split?: { cols: number; rows: number };
  mapping: TilesetMapping;
  insets?: NineSliceRegion["insets"];
}

/** Introspection data for atlas/theme tooling. This is derived from the skin;
 *  theme authors never have to maintain a second debug-only list. */
export interface TilesetDebugInfo {
  image: CanvasImageSource;
  tileSize: { w: number; h: number };
  entries: readonly TilesetDebugEntry[];
}

function debugSplit(
  region: TileRegion,
  tileSize: { w: number; h: number },
): { cols: number; rows: number } | undefined {
  const cols = region.sw / tileSize.w;
  const rows = region.sh / tileSize.h;
  return Number.isInteger(cols) && Number.isInteger(rows) && (cols > 1 || rows > 1)
    ? { cols, rows }
    : undefined;
}

function debugMapping(
  region: TileRegion & {
    image?: CanvasImageSource;
    insets?: NineSliceRegion["insets"];
    mapping?: TilesetMapping;
  },
  split: { cols: number; rows: number } | undefined,
  hasInsets: boolean,
): TilesetMapping {
  if (region.mapping) return region.mapping;
  if (hasInsets) return "nine-slice";
  if (split?.cols === 3 && split.rows === 3) return "auto9";
  if (split?.cols === 2 && split.rows === 2) return "auto4";
  if (split?.cols === 4 && split.rows === 4) return "auto16";
  if (split) return "region";
  return "sprite";
}

/** Extract every frame, button variant state, and named sprite from a skin.
 *  It is intentionally pure and cheap enough for an inspector opened on
 *  demand; the returned entries are source-space facts, not draw commands. */
export function inspectTilesetSkin(skin: TilesetSkin): TilesetDebugInfo {
  const entries: TilesetDebugEntry[] = [];
  const add = (
    label: string,
    region: TileRegion & {
      image?: CanvasImageSource;
      insets?: NineSliceRegion["insets"];
      mapping?: TilesetMapping;
    },
    image = region.image ?? skin.image,
  ): void => {
    const split = debugSplit(region, skin.tileSize);
    entries.push({
      label,
      region: { sx: region.sx, sy: region.sy, sw: region.sw, sh: region.sh },
      image,
      split,
      mapping: debugMapping(region, split, "insets" in region),
      insets: region.insets ? { ...region.insets } : undefined,
    });
  };
  for (const [role, region] of Object.entries(skin.frames))
    if (region) add(`frame.${role}`, region);
  for (const [variant, states] of Object.entries(skin.buttonVariants))
    for (const [state, region] of Object.entries(states ?? {}))
      if (region) add(`button.${variant}.${state}`, region);
  for (const [name, sprite] of Object.entries(skin.sprites.icons ?? {}))
    add(`sprite.${name}`, { ...sprite.region, mapping: sprite.mapping ?? "sprite" }, sprite.image);
  if (skin.sprites.cursor)
    add(
      "sprite.cursor",
      { ...skin.sprites.cursor.region, mapping: skin.sprites.cursor.mapping ?? "sprite" },
      skin.sprites.cursor.image,
    );
  if (skin.sprites.divider)
    add(
      "sprite.divider",
      { ...skin.sprites.divider.region, mapping: skin.sprites.divider.mapping ?? "sprite" },
      skin.sprites.divider.image,
    );
  if (skin.sprites.sliderKnob)
    add(
      "sprite.sliderKnob",
      { ...skin.sprites.sliderKnob.region, mapping: skin.sprites.sliderKnob.mapping ?? "sprite" },
      skin.sprites.sliderKnob.image,
    );
  return { image: skin.image, tileSize: { ...skin.tileSize }, entries };
}

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

/** Two-axis content padding. Widget-level `pad` options remain numeric and
 *  apply the same value to both axes. */
export interface ThemePadding {
  x: number;
  y: number;
}

/** A text inset may stay as a scalar for compatibility, or use independent
 *  horizontal/vertical values for pixel UI. */
export type ThemeTextPadding = number | ThemePadding;

/** Resolve a scalar or two-axis text inset without making widgets duplicate
 *  the compatibility logic. */
export function resolveThemeTextPadding(
  value: ThemeTextPadding | undefined,
  fallback: ThemeTextPadding = 0,
): ThemePadding {
  const resolved = value ?? fallback;
  return typeof resolved === "number"
    ? { x: resolved, y: resolved }
    : { x: resolved.x, y: resolved.y };
}

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

/** The tokens a `ThemeSelect` falls back to when a theme leaves it unset. */
type SelectTokenSources = Pick<
  Theme,
  "buttonText" | "primary" | "bg" | "bgHover" | "bgActive" | "accent"
>;

/** Nudge a color toward white/black without parsing it — CSS `color-mix` is
 *  understood by canvas `fillStyle` in every browser we target. This is how the
 *  kit derives a hover lift and a pressed shade from a single authored fill, so
 *  it lives with the tokens rather than inside one widget. Memoized: the inputs
 *  are theme colors (a handful) and buttons call it every frame. */
const shadeCache = new Map<string, string>();
export function shade(color: string, dark: boolean): string {
  const key = dark ? `d:${color}` : `l:${color}`;
  let mixed = shadeCache.get(key);
  if (!mixed) {
    mixed = `color-mix(in srgb, ${color} ${dark ? 82 : 88}%, ${dark ? "#000" : "#fff"})`;
    shadeCache.set(key, mixed);
  }
  return mixed;
}

/** Resolve the `select` group against an ALREADY-MERGED theme, so the defaults
 *  track whatever `primary`/`accent`/`buttonText` that theme ended up with.
 *  (`withTheme` doesn't re-derive — like `buttonText`, a scoped override just
 *  merges over the group already in effect.) The two `shade` fallbacks are the
 *  lift and the press the primary button variant used to apply to the selected
 *  row — same helper, so they cannot drift apart. */
function resolveSelect(base: SelectTokenSources, overrides?: Partial<ThemeSelect>): ThemeSelect {
  return {
    text: overrides?.text ?? base.buttonText.ghost,
    textSelected: overrides?.textSelected ?? base.buttonText.primary,
    textDisabled: overrides?.textDisabled ?? base.buttonText.disabled,
    bg: overrides?.bg ?? "transparent",
    bgHover: overrides?.bgHover ?? base.bgHover,
    bgActive: overrides?.bgActive ?? base.bgActive,
    bgDisabled: overrides?.bgDisabled ?? base.bgActive,
    bgSelected: overrides?.bgSelected ?? base.primary,
    bgSelectedHover: overrides?.bgSelectedHover ?? shade(base.primary, false),
    bgSelectedActive: overrides?.bgSelectedActive ?? shade(base.primary, true),
    groupLabel: overrides?.groupLabel ?? base.accent,
  };
}

/** Optional canvas text outline used by pixel fonts with a dark keyline. */
export interface ThemeTextOutline {
  color: string;
  width: number;
}

function imageDimension(image: CanvasImageSource, axis: "w" | "h"): number {
  const value = image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number | unknown;
    height?: number | unknown;
  };
  const intrinsic = axis === "w" ? value.naturalWidth : value.naturalHeight;
  const plain = axis === "w" ? value.width : value.height;
  return intrinsic ?? (typeof plain === "number" ? plain : 0);
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`TilesetSkin: ${label} must be positive`);
}

function validateRegion(
  image: CanvasImageSource,
  region: TileRegion,
  label: string,
  insets?: NineSliceRegion["insets"],
): void {
  for (const [key, value] of Object.entries(region)) {
    if (key === "insets" || key === "image" || key === "mapping" || key === "orientation") continue;
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`TilesetSkin: ${label}.${key} must be non-negative`);
  }
  assertFinitePositive(region.sw, `${label}.sw`);
  assertFinitePositive(region.sh, `${label}.sh`);
  const iw = imageDimension(image, "w");
  const ih = imageDimension(image, "h");
  if (iw > 0 && (region.sx + region.sw > iw || region.sy + region.sh > ih)) {
    throw new Error(`TilesetSkin: ${label} lies outside its image (${iw}x${ih})`);
  }
  if (insets) {
    for (const [key, value] of Object.entries(insets)) {
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`TilesetSkin: ${label}.insets.${key} must be non-negative`);
    }
    if (insets.left + insets.right >= region.sw || insets.top + insets.bottom >= region.sh) {
      throw new Error(`TilesetSkin: ${label} insets must leave a positive center`);
    }
  }
}

/** Build a reusable skin from an image and source-pixel role manifest. */
export function createTilesetSkin(
  image: CanvasImageSource,
  options: TilesetSkinOptions,
): TilesetSkin {
  assertFinitePositive(options.tileSize.w, "tileSize.w");
  assertFinitePositive(options.tileSize.h, "tileSize.h");
  const frames = { ...options.frames };
  for (const [role, region] of Object.entries(frames)) {
    if (region) validateRegion(region.image ?? image, region, `frames.${role}`, region.insets);
  }
  const buttonVariants = { ...options.buttonVariants } as TilesetButtonVariants;
  for (const [variant, states] of Object.entries(buttonVariants)) {
    for (const [state, region] of Object.entries(states ?? {})) {
      if (region)
        validateRegion(
          region.image ?? image,
          region,
          `buttonVariants.${variant}.${state}`,
          region.insets,
        );
    }
  }
  const sprites = options.sprites ?? {};
  if (sprites.cursor) validateRegion(sprites.cursor.image, sprites.cursor.region, "sprites.cursor");
  if (sprites.divider)
    validateRegion(sprites.divider.image, sprites.divider.region, "sprites.divider");
  if (sprites.sliderKnob)
    validateRegion(sprites.sliderKnob.image, sprites.sliderKnob.region, "sprites.sliderKnob");
  for (const [name, sprite] of Object.entries(sprites.icons ?? {})) {
    validateRegion(sprite.image, sprite.region, `sprites.icons.${name}`);
  }
  return Object.freeze({
    image,
    tileSize: Object.freeze({ ...options.tileSize }),
    frames: Object.freeze(frames),
    buttonVariants: Object.freeze(buttonVariants),
    sprites: Object.freeze({
      cursor: sprites.cursor,
      divider: sprites.divider,
      sliderKnob: sprites.sliderKnob,
      icons: sprites.icons ? Object.freeze({ ...sprites.icons }) : undefined,
    }),
  });
}

/** Build a validated skin from a serializable atlas/theme manifest. A JSON
 *  file only needs `x/y/w/h`; runtime image references are supplied once by
 *  the caller. The resulting `TilesetSkin` is the same primitive used by all
 *  widgets and by `inspectTilesetSkin`. */
export function createTilesetSkinFromManifest(
  image: CanvasImageSource,
  manifest: TilesetSkinManifest,
): TilesetSkin {
  const frame = (source: TilesetManifestRegion): NineSliceRegion => ({
    image,
    sx: source.x,
    sy: source.y,
    sw: source.w,
    sh: source.h,
    insets: source.insets ?? { left: 0, top: 0, right: 0, bottom: 0 },
    mapping: source.mapping,
    orientation: source.orientation,
  });
  const sprite = (source: TilesetManifestSprite): TilesetSprite => ({
    image,
    region: { sx: source.x, sy: source.y, sw: source.w, sh: source.h },
    mapping: source.mapping,
  });
  return createTilesetSkin(image, {
    tileSize: manifest.tileSize,
    frames: Object.fromEntries(
      Object.entries(manifest.frames ?? {}).map(([role, source]) => [
        role,
        source && frame(source),
      ]),
    ) as Partial<Record<TilesetFrameRole, NineSliceRegion>>,
    buttonVariants: Object.fromEntries(
      Object.entries(manifest.buttonVariants ?? {}).map(([variant, states]) => [
        variant,
        Object.fromEntries(
          Object.entries(states ?? {}).map(([state, source]) => [state, source && frame(source)]),
        ),
      ]),
    ) as TilesetButtonVariants,
    sprites: manifest.sprites
      ? {
          cursor: manifest.sprites.cursor && sprite(manifest.sprites.cursor),
          divider: manifest.sprites.divider && sprite(manifest.sprites.divider),
          sliderKnob: manifest.sprites.sliderKnob && sprite(manifest.sprites.sliderKnob),
          icons: Object.fromEntries(
            Object.entries(manifest.sprites.icons ?? {}).map(([name, source]) => [
              name,
              sprite(source),
            ]),
          ),
        }
      : undefined,
  });
}

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
  /** Semantic button label colors. Individual button `color` overrides these. */
  buttonText: ThemeButtonText;
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
  /** Panel/modal/tooltip background. */
  panelBg: string;
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
  /** Horizontal padding added around auto-sized button labels. Default 28. */
  buttonPadX: number;
  /** Default button height in px. Default 30. Pixel skins can lower this to
   *  their native frame height so fixed artwork is not vertically stretched. */
  buttonH: number;
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
  /** Default button width in px. 0 keeps content auto-sizing; explicit `w`
   *  still wins. Pixel skins can set this to their native frame width. */
  buttonW: number;
  /** Minimum width for auto-sized buttons. Explicit `w` still wins. Default 0. */
  buttonMinW: number;
  /** Default tab-strip height in px. Default 30. */
  tabH: number;
  /** Height of a themed panel title strip. Default 32. */
  panelTitleH: number;
  /** Independent title-text inset. Unlike `textPad`, this only affects panel
   *  titles. Default `{ x: 0, y: 0 }`. */
  panelTitlePad: ThemePadding;
  /** Panel title text color. Defaults to `accent`. */
  panelTitleText?: string;
  /** How far the panel-title frame may extend past the panel frame while
   *  consuming its fixed insets. Values are non-negative. Default `{ x: 0,
   *  y: 0 }`. */
  panelTitleOverhang: ThemePadding;
  /** Extra space between a panel's frame and its children, added on top of
   *  `pad`. `y` is the one that earns its keep: a skin whose title strip is
   *  taller than `panelTitleH`, or whose frame carries a decorative inner rail,
   *  spends it here so EVERY panel in the theme clears the art — instead of
   *  each screen hand-tuning a y offset that only suits one skin. `x` insets
   *  both sides the same way. Default `{ x: 0, y: 0 }`. */
  panelInset: ThemePadding;
  /** Default inner padding (px) for bordered content containers — the `group`
   *  body inset. Override per call with `pad`. Structural flow containers
   *  (`row`/`col`) intentionally stay flush (pad 0) so widgets align to their
   *  slot edges; use a `group` (or an explicit `pad`) when you want a box that
   *  insets its content. Default `{ x: 8, y: 8 }`. */
  pad: ThemePadding;
  /** Default inset (px) applied by `UI.text` when no `pad`/`padX`/`padY` is
   *  given. 0 keeps a label flush with its slot (so it lines up with sibling
   *  widgets and HUD columns); raise it for a global label inset. Default 0. */
  textPad: ThemeTextPadding;
  /** Optional outline painted behind UI text. */
  textOutline?: ThemeTextOutline;
  /** Optional pixel-art skin. When absent, widgets use the color painter. */
  skin?: TilesetSkin;
}

/** Partial theme update with independently overridable spacing tokens. */
export type ThemeOverrides = Omit<
  Partial<Theme>,
  "spacing" | "buttonText" | "select" | "panelTitleOverhang" | "panelTitlePad" | "panelInset"
> & {
  spacing?: Partial<ThemeSpacing>;
  buttonText?: Partial<ThemeButtonText>;
  select?: Partial<ThemeSelect>;
  panelTitleOverhang?: Partial<ThemePadding>;
  panelTitlePad?: Partial<ThemePadding>;
  panelInset?: Partial<ThemePadding>;
};

const themeObjectIds = new WeakMap<object, number>();
let nextThemeObjectId = 1;

function themeObjectId(value: object): number {
  const existing = themeObjectIds.get(value);
  if (existing !== undefined) return existing;
  const id = nextThemeObjectId++;
  themeObjectIds.set(value, id);
  return id;
}

function themeValueKey(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    // Theme skins contain image objects and validated frame maps. Their
    // identity is the meaningful part of the cache key; recursively walking
    // them would be needlessly expensive and unstable for browser images.
    if ("image" in object || "frames" in object || "tileSize" in object)
      return `object:${themeObjectId(object)}`;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${key}:${themeValueKey(object[key])}`)
      .join(",")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

function themeValueSignature(value: Theme): string {
  return Object.keys(value)
    .sort()
    .map((key) => `${key}:${themeValueKey((value as unknown as Record<string, unknown>)[key])}`)
    .join("|");
}

/** The built-in `Theme` — the base every `setTheme` override is merged over
 *  (so overrides never compound) and the reset target for `getTheme`. */
const baseDefaults = {
  spacing: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 },
  font: "monospace",
  fontSize: 13,
  accent: "#4ecdc4",
  accentSoft: "#3a8f89",
  text: "#e8f0f4",
  textDim: "#7d8894",
  textDisabled: "#5a6a75",
  buttonText: {
    default: "#e8f0f4",
    primary: "#1d2b36",
    danger: "#e8f0f4",
    ghost: "#e8f0f4",
    disabled: "#5a6a75",
  },
  bg: "#24384a",
  bgHover: "#2c4356",
  bgActive: "#1d2b36",
  border: "#3a5568",
  panelBg: "rgba(13,18,26,0.92)",
  track: "rgba(255,255,255,0.12)",
  dim: "rgba(0,0,0,0.55)",
  primary: "#4ecdc4",
  danger: "#ff6b6b",
  borderWidth: 2,
  radius: 0,
  buttonPadX: 28,
  buttonH: 30,
  inputH: 32,
  barH: 12,
  sliderH: 4,
  scrollbarW: 10,
  scrollbarGap: 4,
  buttonW: 0,
  buttonMinW: 0,
  tabH: 30,
  panelTitleH: 32,
  panelTitlePad: { x: 0, y: 0 },
  panelTitleOverhang: { x: 0, y: 0 },
  panelInset: { x: 0, y: 0 },
  pad: { x: 8, y: 8 },
  textPad: 0,
};

// `select` is derived, not authored: it restates the tokens the drop-menu used
// to borrow, and `resolveSelect` runs again on every merge so a theme that
// moves `primary` moves the menu highlight with it.
export const defaultTheme: Theme = { ...baseDefaults, select: resolveSelect(baseDefaults) };

export let theme: Theme = { ...defaultTheme };
/** Changes whenever theme-dependent auto-layout measurements must be rebuilt. */
export let themeRevision = 0;
/** Stable cache identity for the active global or locally-scoped theme. */
export let themeKey = `global:${themeValueSignature(theme)}`;

/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export function setTheme(overrides: ThemeOverrides): void {
  const merged = {
    ...defaultTheme,
    ...overrides,
    spacing: { ...defaultTheme.spacing, ...overrides.spacing },
    buttonText: { ...defaultTheme.buttonText, ...overrides.buttonText },
    panelTitleOverhang: {
      ...defaultTheme.panelTitleOverhang,
      ...overrides.panelTitleOverhang,
    },
    panelTitlePad: { ...defaultTheme.panelTitlePad, ...overrides.panelTitlePad },
    panelInset: { ...defaultTheme.panelInset, ...overrides.panelInset },
  };
  // Resolved LAST, so the unset tokens fall back to the tokens THIS theme ended
  // up with rather than the built-in ones.
  theme = { ...merged, select: resolveSelect(merged, overrides.select) };
  themeRevision++;
  themeKey = `global:${themeRevision}:${themeValueSignature(theme)}`;
}

/** Run a subtree with a theme merged over the currently active theme.
 *
 * The override is lexical: every widget and nested layout container called by
 * `children` sees it, and the previous theme is restored even when `children`
 * throws. The global `setTheme` remains the right choice for restyling the
 * whole canvas; this is the per-element propagation primitive. */
export function withTheme<R>(overrides: ThemeOverrides | undefined, children: () => R): R {
  if (!overrides) return children();
  const previous = theme;
  const previousKey = themeKey;
  theme = {
    ...theme,
    ...overrides,
    spacing: { ...theme.spacing, ...overrides.spacing },
    buttonText: { ...theme.buttonText, ...overrides.buttonText },
    select: { ...theme.select, ...overrides.select },
    panelTitleOverhang: { ...theme.panelTitleOverhang, ...overrides.panelTitleOverhang },
    panelTitlePad: { ...theme.panelTitlePad, ...overrides.panelTitlePad },
    panelInset: { ...theme.panelInset, ...overrides.panelInset },
  };
  themeKey = `${previousKey}:scope:${themeValueSignature(theme)}`;
  try {
    return children();
  } finally {
    theme = previous;
    themeKey = previousKey;
  }
}

/** The active theme (live object — read, don't mutate). */
export function getTheme(): Theme {
  return theme;
}
