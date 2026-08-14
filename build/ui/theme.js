// ---------- Theme tokens ----------
// The shared palette/metrics every on-canvas surface styles from — `ui`
// widgets and the on-screen gamepad both read it, so it lives in core rather
// than inside either one. The helpers that PAINT with these tokens (and so
// need text measurement) stay in `ui/core/theme.ts`.
/** Turn a named `Tiles.Cell`/region into a repeatable UI frame definition. */
export function frameFromCell(cell, insets) {
    return { image: cell.image, sx: cell.sx, sy: cell.sy, sw: cell.sw, sh: cell.sh, insets };
}
function debugSplit(region, tileSize) {
    const cols = region.sw / tileSize.w;
    const rows = region.sh / tileSize.h;
    return Number.isInteger(cols) && Number.isInteger(rows) && (cols > 1 || rows > 1)
        ? { cols, rows }
        : undefined;
}
function debugMapping(region, split, hasInsets) {
    if (region.mapping)
        return region.mapping;
    if (hasInsets)
        return "nine-slice";
    if (split?.cols === 3 && split.rows === 3)
        return "auto9";
    if (split?.cols === 2 && split.rows === 2)
        return "auto4";
    if (split?.cols === 4 && split.rows === 4)
        return "auto16";
    if (split)
        return "region";
    return "sprite";
}
/** Extract every frame, button variant state, and named sprite from a skin.
 *  It is intentionally pure and cheap enough for an inspector opened on
 *  demand; the returned entries are source-space facts, not draw commands. */
export function inspectTilesetSkin(skin) {
    const entries = [];
    const add = (label, region, image = region.image ?? skin.image) => {
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
        if (region)
            add(`frame.${role}`, region);
    for (const [variant, states] of Object.entries(skin.buttonVariants))
        for (const [state, region] of Object.entries(states ?? {}))
            if (region)
                add(`button.${variant}.${state}`, region);
    for (const [name, sprite] of Object.entries(skin.sprites.icons ?? {}))
        add(`sprite.${name}`, { ...sprite.region, mapping: sprite.mapping ?? "sprite" }, sprite.image);
    if (skin.sprites.cursor)
        add("sprite.cursor", { ...skin.sprites.cursor.region, mapping: skin.sprites.cursor.mapping ?? "sprite" }, skin.sprites.cursor.image);
    if (skin.sprites.divider)
        add("sprite.divider", { ...skin.sprites.divider.region, mapping: skin.sprites.divider.mapping ?? "sprite" }, skin.sprites.divider.image);
    if (skin.sprites.sliderKnob)
        add("sprite.sliderKnob", { ...skin.sprites.sliderKnob.region, mapping: skin.sprites.sliderKnob.mapping ?? "sprite" }, skin.sprites.sliderKnob.image);
    return { image: skin.image, tileSize: { ...skin.tileSize }, entries };
}
/** Resolve a scalar, axis shorthand, or explicit-edge padding value. */
export function resolveThemePadding(value, fallback = 0) {
    const resolved = value ?? fallback;
    if (typeof resolved === "number") {
        return {
            x: resolved,
            y: resolved,
            top: resolved,
            right: resolved,
            bottom: resolved,
            left: resolved,
        };
    }
    const x = resolved.x ?? 0;
    const y = resolved.y ?? 0;
    const left = resolved.left ?? x;
    const right = resolved.right ?? x;
    const top = resolved.top ?? y;
    const bottom = resolved.bottom ?? y;
    return { x: left, y: top, top, right, bottom, left };
}
/** Resolve a scalar or edge-aware text inset without making widgets duplicate
 *  the compatibility logic. */
export function resolveThemeTextPadding(value, fallback = 0) {
    return resolveThemePadding(value, fallback);
}
/** Nudge a color toward white/black without parsing it — CSS `color-mix` is
 *  understood by canvas `fillStyle` in every browser we target. This is how the
 *  kit derives a hover lift and a pressed shade from a single authored fill, so
 *  it lives with the tokens rather than inside one widget. Memoized: the inputs
 *  are theme colors (a handful) and buttons call it every frame. */
const shadeCache = new Map();
export function shade(color, dark) {
    const key = dark ? `d:${color}` : `l:${color}`;
    let mixed = shadeCache.get(key);
    if (!mixed) {
        mixed = `color-mix(in srgb, ${color} ${dark ? 82 : 88}%, ${dark ? "#000" : "#fff"})`;
        shadeCache.set(key, mixed);
    }
    return mixed;
}
/** Resolve the `select` group against an ALREADY-MERGED theme, so the defaults
 *  track whatever `primary`/`accent`/`button.text` that theme ended up with.
 *  The two `shade` fallbacks are the lift and the press the primary button
 *  variant uses for the selected row — same helper, so they cannot drift apart. */
function resolveSelect(base, overrides) {
    return {
        text: overrides?.text ?? base.button.text.ghost,
        textSelected: overrides?.textSelected ?? base.button.text.primary,
        textDisabled: overrides?.textDisabled ?? base.button.text.disabled,
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
function imageDimension(image, axis) {
    const value = image;
    const intrinsic = axis === "w" ? value.naturalWidth : value.naturalHeight;
    const plain = axis === "w" ? value.width : value.height;
    return intrinsic ?? (typeof plain === "number" ? plain : 0);
}
function assertFinitePositive(value, label) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`TilesetSkin: ${label} must be positive`);
}
function validateRegion(image, region, label, insets) {
    for (const [key, value] of Object.entries(region)) {
        if (key === "insets" || key === "image" || key === "mapping" || key === "orientation")
            continue;
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
export function createTilesetSkin(image, options) {
    assertFinitePositive(options.tileSize.w, "tileSize.w");
    assertFinitePositive(options.tileSize.h, "tileSize.h");
    const frames = { ...options.frames };
    for (const [role, region] of Object.entries(frames)) {
        if (region)
            validateRegion(region.image ?? image, region, `frames.${role}`, region.insets);
    }
    const buttonVariants = { ...options.buttonVariants };
    for (const [variant, states] of Object.entries(buttonVariants)) {
        for (const [state, region] of Object.entries(states ?? {})) {
            if (region)
                validateRegion(region.image ?? image, region, `buttonVariants.${variant}.${state}`, region.insets);
        }
    }
    const sprites = options.sprites ?? {};
    if (sprites.cursor)
        validateRegion(sprites.cursor.image, sprites.cursor.region, "sprites.cursor");
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
export function createTilesetSkinFromManifest(image, manifest) {
    const frame = (source) => ({
        image,
        sx: source.x,
        sy: source.y,
        sw: source.w,
        sh: source.h,
        insets: source.insets ?? { left: 0, top: 0, right: 0, bottom: 0 },
        mapping: source.mapping,
        orientation: source.orientation,
    });
    const sprite = (source) => ({
        image,
        region: { sx: source.x, sy: source.y, sw: source.w, sh: source.h },
        mapping: source.mapping,
    });
    return createTilesetSkin(image, {
        tileSize: manifest.tileSize,
        frames: Object.fromEntries(Object.entries(manifest.frames ?? {}).map(([role, source]) => [
            role,
            source && frame(source),
        ])),
        buttonVariants: Object.fromEntries(Object.entries(manifest.buttonVariants ?? {}).map(([variant, states]) => [
            variant,
            Object.fromEntries(Object.entries(states ?? {}).map(([state, source]) => [state, source && frame(source)])),
        ])),
        sprites: manifest.sprites
            ? {
                cursor: manifest.sprites.cursor && sprite(manifest.sprites.cursor),
                divider: manifest.sprites.divider && sprite(manifest.sprites.divider),
                sliderKnob: manifest.sprites.sliderKnob && sprite(manifest.sprites.sliderKnob),
                icons: Object.fromEntries(Object.entries(manifest.sprites.icons ?? {}).map(([name, source]) => [
                    name,
                    sprite(source),
                ])),
            }
            : undefined,
    });
}
const themeObjectIds = new WeakMap();
let nextThemeObjectId = 1;
function themeObjectId(value) {
    const existing = themeObjectIds.get(value);
    if (existing !== undefined)
        return existing;
    const id = nextThemeObjectId++;
    themeObjectIds.set(value, id);
    return id;
}
function themeValueKey(value) {
    if (value === null)
        return "null";
    if (typeof value === "object") {
        const object = value;
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
function themeValueSignature(value) {
    return Object.keys(value)
        .sort()
        .map((key) => `${key}:${themeValueKey(value[key])}`)
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
    button: {
        text: {
            default: "#e8f0f4",
            primary: "#1d2b36",
            danger: "#e8f0f4",
            ghost: "#e8f0f4",
            disabled: "#5a6a75",
        },
        padding: { x: 14, y: 0 },
        width: 0,
        minWidth: 0,
        height: 30,
    },
    bg: "#24384a",
    bgHover: "#2c4356",
    bgActive: "#1d2b36",
    border: "#3a5568",
    track: "rgba(255,255,255,0.12)",
    dim: "rgba(0,0,0,0.55)",
    primary: "#4ecdc4",
    danger: "#ff6b6b",
    borderWidth: 2,
    radius: 0,
    inputH: 32,
    barH: 12,
    sliderH: 4,
    scrollbarW: 10,
    scrollbarGap: 4,
    tabH: 30,
    panel: {
        background: "rgba(13,18,26,0.92)",
        padding: { x: 8, y: 8 },
        frameInset: { x: 0, y: 0 },
        title: {
            // Solved so the gap a reader sees above the title equals the gap beside
            // it, which at 32 it did not: the text is optically centred in the band
            // (`centeredText`), so the top gap is `(height - capHeight) / 2` while
            // the side gap is `panel.padding.x + title.padding.x`. With a 14px title
            // (`fontSize + 1`), a 0.7em cap height and an 8-unit body pad that read
            // 11.1 above against 8 beside. `2 * 8 + 0.7 * 14` is 25.8, so 26.
            height: 26,
            padding: { x: 0, y: 0 },
            overhang: { x: 0, y: 0 },
        },
    },
    textPad: 0,
    focusStyle: "ring",
};
// `select` is derived, not authored: it restates the tokens the drop-menu used
// to borrow, and `resolveSelect` runs again on every merge so a theme that
// moves `primary` moves the menu highlight with it.
export const defaultTheme = {
    ...baseDefaults,
    skin: undefined,
    select: resolveSelect(baseDefaults),
};
export let theme = { ...defaultTheme };
/** Changes whenever theme-dependent auto-layout measurements must be rebuilt. */
export let themeRevision = 0;
/** Stable cache identity for the active global or locally-scoped theme. */
export let themeKey = `global:${themeValueSignature(theme)}`;
function mergeButtonTheme(base, override) {
    return {
        ...base,
        ...override,
        text: { ...base.text, ...override?.text },
        padding: { ...base.padding, ...override?.padding },
    };
}
function mergePanelTheme(base, override) {
    return {
        ...base,
        ...override,
        padding: { ...base.padding, ...override?.padding },
        frameInset: { ...base.frameInset, ...override?.frameInset },
        title: {
            ...base.title,
            ...override?.title,
            padding: { ...base.title.padding, ...override?.title?.padding },
            overhang: { ...base.title.overhang, ...override?.title?.overhang },
        },
    };
}
/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export function setTheme(overrides) {
    const merged = {
        ...defaultTheme,
        ...overrides,
        spacing: { ...defaultTheme.spacing, ...overrides.spacing },
        button: mergeButtonTheme(defaultTheme.button, overrides.button),
        panel: mergePanelTheme(defaultTheme.panel, overrides.panel),
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
export function withTheme(overrides, children) {
    if (!overrides)
        return children();
    const previous = theme;
    const previousKey = themeKey;
    const merged = {
        ...theme,
        ...overrides,
        spacing: { ...theme.spacing, ...overrides.spacing },
        select: { ...theme.select, ...overrides.select },
        button: mergeButtonTheme(theme.button, overrides.button),
        panel: mergePanelTheme(theme.panel, overrides.panel),
    };
    theme = { ...merged, select: resolveSelect(merged, overrides.select) };
    themeKey = `${previousKey}:scope:${themeValueSignature(theme)}`;
    try {
        return children();
    }
    finally {
        theme = previous;
        themeKey = previousKey;
    }
}
/** The active theme (live object — read, don't mutate). */
export function getTheme() {
    return theme;
}
