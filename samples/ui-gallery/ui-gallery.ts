// UI Gallery — every immediate-mode UI primitive on one screen.
//
// A component storyboard: buttons (all variants), toggles, sliders, a select,
// a text input, tabs, a progress bar + spinner, a windowed list, a sortable
// table, drag & drop, an inventory grid, a stack-cursor toolbar, a clipped
// region with an explicit scrollbar, the overlays (popover / modal / dialog /
// confirm), and a UI-scale knob (UI.scaled) that zooms the whole board live.
//
// createUI(game) binds every widget to this game; every widget is drawn inside
// draw(). Interactive state lives in module-level `let`s: each widget takes the
// current value in and returns the (possibly changed) value, which we store
// straight back — the immediate-mode round-trip.
import { createUI } from "minimotor/ui";
import { createApp } from "minimotor";
import * as HotReload from "minimotor/hot-reload";
import { createAssets } from "minimotor/assets";
import { createBrowserStorage } from "minimotor/storage";
import type { SelectGroup } from "minimotor/ui";
import type { HotModuleContext } from "minimotor/hot-reload";
import type { TableSort, Theme } from "minimotor";
import { installLayoutProbe } from "../shared/layout-probe.ts";
import { createGalleryThemeCatalog } from "./gallery-themes.ts";
import {
  creditLines,
  invItems,
  listItems,
  players,
  tabPages,
  type Player,
  type Rect,
} from "./gallery-data.ts";

// No letterbox `resolution`: rendering at native scale keeps text crisp on
// high-DPI (Retina) screens — a fractional letterbox factor softens glyphs.
// We keep the live viewport handle and read `view.w`/`view.h` fresh each frame
// so the column layout can REFLOW to the window width instead of scaling. The
// board's OWN zoom is opt-in: the header's "UI Scale" slider drives `UI.scaled`
// (below), which scales the board's draw + pointer while it still reflows.
const game = createApp("game", { background: "#12141c" });
const view = game.viewport;
const { Draw, Loop, Pointer } = game;
const Assets = createAssets(game);
const Storage = createBrowserStorage(game);
const UI = createUI(game);
installLayoutProbe(UI);

// Canvas text measurement must happen after the @font-face has resolved, or
// the first layout pass would measure fallback monospace and then jump when
// Any selected pixel font must be ready before the first layout pass.
await Promise.all([
  document.fonts.load('12px "Silkscreen"'),
  document.fonts.load('bold 12px "Silkscreen"'),
  document.fonts.load('12px "Press Start 2P"'),
  document.fonts.load('12px "Pixelify Sans"'),
  document.fonts.load('12px "DotGothic16"'),
  document.fonts.load('12px "VT323"'),
  document.fonts.load('12px "Tiny5"'),
  document.fonts.load('12px "lores-28-narrow"'),
  document.fonts.load('12px "Micro5"'),
  document.fonts.load('12px "Jersey 10"'),
  document.fonts.load('12px "Jersey 15"'),
  document.fonts.load('12px "m5x7"'),
  document.fonts.load('12px "Monogram"'),
  document.fonts.load('12px "DePixel Schmal"'),
]);

const {
  presets: themePresets,
  alternatives: themeAlternatives,
  atlasDebug,
} = await createGalleryThemeCatalog(Assets, {
  defineAlternatives: ({ tiny }) => ({
    "tiny-rpg-mana-soul": [{ key: "panel-alt", label: "Panel alt", theme: tiny.panelAlt }],
  }),
});

interface GalleryHmrState {
  tab: number;
  sound: boolean;
  reducedMotion: boolean;
  disabledToggle: boolean;
  volume: number;
  zoom: number;
  uiScale: number;
  name: string;
  notes: string;
  chatDraft: string;
  chatLog: string[];
  quality: string;
  city: string;
  selectedItem: number;
  listOffset: number;
  progress: number;
  busy: boolean;
  radio: boolean;
  popoverOpen: boolean;
  modalOpen: boolean;
  confirmOpen: boolean;
  dialogOpen: boolean;
  atlasDebugOpen: boolean;
  atlasZoom: number;
  atlasVariant: number;
  atlasPan: { x: number; y: number };
  tableSort: TableSort;
  tableOffset: number;
  tableSel: Player | null;
  binLoadout: string[];
  binStash: string[];
  invSel: number;
  clipOffset: number;
  currentFont: string;
  currentTheme: string;
}

const galleryHot = HotReload.create((import.meta as ImportMeta & { hot?: HotModuleContext }).hot);
const previousGalleryState = galleryHot.restore<GalleryHmrState>("ui-gallery");

// ---- interactive state (the round-trip target for each widget) ----
let tab = 0; // UI.tabs active index
let sound = true; // UI.toggle
let reducedMotion = false; // UI.toggle (cosmetic preference — pure state round-trip)
let disabledToggle = false; // UI.toggle (disabled demo)
let volume = 65; // UI.slider (0..100)
let zoom = 1.5; // UI.slider (0.5..3, stepped)
let uiScale = 1; // the header slider's value, published via UI.setScale each frame
let name = ""; // UI.textInput
let notes = ""; // UI.textInput (multiline)
let chatDraft = ""; // UI.textInput (chat: clears on send, keeps focus)
let chatLog: string[] = ["gg", "nice shot!"]; // chat history
let quality = "high"; // UI.select value
let city = "Tokyo"; // UI.select with a long option list — its drop menu scrolls
let selectedItem = 1; // UI.list selection
let listOffset = 0; // UI.list scroll offset
let progress = 0.4; // UI.bar fill fraction (also driven by a slider)
let busy = true; // show the spinner
let radio = true; // UI.toggle appearance: radio

// overlays — which one is open
let popoverOpen = false;
let modalOpen = false;
let confirmOpen = false;
let dialogOpen = false;
let atlasDebugOpen = false;
let atlasZoom = 1;
let atlasVariant = 0;
let atlasPan = { x: 0, y: 0 };
let atlasDragStart = { panX: 0, panY: 0 };
let atlasWasDragging = false;

function resetAtlasView(): void {
  // atlasZoom is a multiplier over the automatically calculated fit scale.
  atlasZoom = 1;
  atlasPan = { x: 0, y: 0 };
  atlasWasDragging = false;
}

// table state
let tableSort: TableSort = { key: "score", dir: -1 };
let tableOffset = 0;
let tableSel: Player | null = null;

// drag & drop — two bins of items; a drop moves an item across
let binLoadout: string[] = ["Sword", "Shield"];
let binStash: string[] = ["Potion", "Torch", "Rope", "Key"];

// UI.grid — an inventory grid; clicking a cell selects it
let invSel = 0;
// UI.clip + UI.scrollbar — offset into a clipped, explicitly-scrolled region
let clipOffset = 0;

// ---- theme picker ----
// Each preset is a `Partial<Theme>` merged over the DEFAULT theme by
// `UI.setTheme` (overrides never compound). "Teal" is the built-in default, so
// it passes `{}`. The colored presets swap the accent trio; "Slate Light"
// flips the whole palette bright.
// Presets vary more than accent color: each also tweaks corner radius, border
// weight, and font family/size so the whole UI feels different, not just tinted.
const themeGroups: SelectGroup<string>[] = [
  {
    label: "Tileset themes",
    options: themePresets
      .filter((themePreset) => themePreset.preset.skin !== undefined)
      .map(({ label, value }) => ({ label, value })),
  },
  {
    label: "Font / color themes",
    options: themePresets
      .filter((themePreset) => themePreset.preset.skin === undefined)
      .map(({ label, value }) => ({ label, value })),
  },
];
const THEME_STORAGE_KEY = "ui-gallery:theme";
const FONT_STORAGE_KEY = "ui-gallery:font";
const storedTheme = await Storage.load(THEME_STORAGE_KEY, "visuals");
const fontOptions = [
  { label: "Theme default", value: "theme", font: undefined },
  { label: "Micro5 — ultra narrow", value: "micro5", font: '"Micro5", monospace' },
  { label: "Jersey 10 — narrow", value: "jersey10", font: '"Jersey 10", monospace' },
  { label: "Jersey 15 — compact", value: "jersey15", font: '"Jersey 15", monospace' },
  { label: "m5x7 — narrow bitmap", value: "m5x7", font: '"m5x7", monospace' },
  { label: "Monogram — bitmap", value: "monogram", font: '"Monogram", monospace' },
  {
    label: "DePixel Schmal — narrow bitmap",
    value: "depixel-schmal",
    font: '"DePixel Schmal", monospace',
  },
  { label: "Tiny5", value: "tiny5", font: '"Tiny5", monospace' },
  { label: "Silkscreen", value: "silkscreen", font: '"Silkscreen", monospace' },
  { label: "VT323", value: "vt323", font: '"VT323", monospace' },
];
const storedFont = await Storage.load(FONT_STORAGE_KEY, "theme");
let currentFont = fontOptions.some((font) => font.value === storedFont) ? storedFont : "theme";
let currentTheme = themePresets.some((themePreset) => themePreset.value === storedTheme)
  ? storedTheme
  : "visuals"; // drives the Theme select; restored from MiniMotor.Storage

if (previousGalleryState) {
  if (fontOptions.some((font) => font.value === previousGalleryState.currentFont))
    currentFont = previousGalleryState.currentFont;
  if (themePresets.some((themePreset) => themePreset.value === previousGalleryState.currentTheme))
    currentTheme = previousGalleryState.currentTheme;
}

function applyTheme(value: string): void {
  currentTheme = themePresets.some((themePreset) => themePreset.value === value)
    ? value
    : "visuals";
  const chosen = themePresets.find((themePreset) => themePreset.value === currentTheme);
  const selectedFont = fontOptions.find((font) => font.value === currentFont);
  UI.setTheme({
    ...(chosen?.preset ?? themePresets[0].preset),
    ...(selectedFont?.font ? { font: selectedFont.font } : {}),
  });
  resetAtlasView();
  atlasVariant = 0;
  void Storage.save(THEME_STORAGE_KEY, currentTheme);
}

function applyFont(value: string): void {
  currentFont = fontOptions.some((font) => font.value === value) ? value : "theme";
  applyTheme(currentTheme);
  void Storage.save(FONT_STORAGE_KEY, currentFont);
}

applyTheme(currentTheme);

if (previousGalleryState) {
  tab = previousGalleryState.tab;
  sound = previousGalleryState.sound;
  reducedMotion = previousGalleryState.reducedMotion;
  disabledToggle = previousGalleryState.disabledToggle;
  volume = previousGalleryState.volume;
  zoom = previousGalleryState.zoom;
  uiScale = previousGalleryState.uiScale;
  name = previousGalleryState.name;
  notes = previousGalleryState.notes;
  chatDraft = previousGalleryState.chatDraft;
  chatLog = [...previousGalleryState.chatLog];
  quality = previousGalleryState.quality;
  city = previousGalleryState.city;
  selectedItem = previousGalleryState.selectedItem;
  listOffset = previousGalleryState.listOffset;
  progress = previousGalleryState.progress;
  busy = previousGalleryState.busy;
  radio = previousGalleryState.radio;
  popoverOpen = previousGalleryState.popoverOpen;
  modalOpen = previousGalleryState.modalOpen;
  confirmOpen = previousGalleryState.confirmOpen;
  dialogOpen = previousGalleryState.dialogOpen;
  atlasDebugOpen = previousGalleryState.atlasDebugOpen;
  atlasZoom = previousGalleryState.atlasZoom;
  atlasVariant = previousGalleryState.atlasVariant;
  atlasPan = { ...previousGalleryState.atlasPan };
  tableSort = { ...previousGalleryState.tableSort };
  tableOffset = previousGalleryState.tableOffset;
  tableSel = previousGalleryState.tableSel ? { ...previousGalleryState.tableSel } : null;
  binLoadout = [...previousGalleryState.binLoadout];
  binStash = [...previousGalleryState.binStash];
  invSel = previousGalleryState.invSel;
  clipOffset = previousGalleryState.clipOffset;
}

/** Resolve the theme scope a gallery panel should inherit. Panel call sites
 *  ask for a semantic treatment; they do not know which preset supplies its
 *  art or whether the current global theme supports it. */
function getTheme(scope: "default" | "panel-alt" = "default"): Partial<Theme> | undefined {
  if (scope === "default") return undefined;
  return themeAlternatives[currentTheme]?.find((alternative) => alternative.key === scope)?.theme;
}

const uiId = UI.ids("ui-gallery");

// ---- e2e hook ----
// The Playwright spec (e2e/ui-scale.spec.ts) drives the UI-scale knob and
// verifies the board's geometry through the layout-capture harness, instead
// of scraping canvas pixels. Harmless in normal use (capture stays off).
declare global {
  interface Window {
    __uiGallery?: {
      setScale(s: number): void;
      setTheme(value: string): void;
      getState(): { uiScale: number; volume: number; city: string };
      layoutCapture(on: boolean): void;
      layoutTree(): ReturnType<typeof UI.layoutTree>;
    };
  }
}
window.__uiGallery = {
  setScale: (s) => {
    uiScale = s;
  },
  setTheme: (value) => {
    applyTheme(value);
  },
  getState: () => ({ uiScale, volume, city }),
  layoutCapture: UI.layoutCapture,
  layoutTree: UI.layoutTree,
};

galleryHot.persist("ui-gallery", () => ({
  tab,
  sound,
  reducedMotion,
  disabledToggle,
  volume,
  zoom,
  uiScale,
  name,
  notes,
  chatDraft,
  chatLog: [...chatLog],
  quality,
  city,
  selectedItem,
  listOffset,
  progress,
  busy,
  radio,
  popoverOpen,
  modalOpen,
  confirmOpen,
  dialogOpen,
  atlasDebugOpen,
  atlasZoom,
  atlasVariant,
  atlasPan: { ...atlasPan },
  tableSort: { ...tableSort },
  tableOffset,
  tableSel: tableSel ? { ...tableSel } : null,
  binLoadout: [...binLoadout],
  binStash: [...binStash],
  invSel,
  clipOffset,
  currentFont,
  currentTheme,
}));
galleryHot.onDispose(() => game.destroy());

Loop.run({
  update() {
    // No simulation — the gallery is drawn entirely from widget state.
  },

  draw() {
    // Header (Draw.* draws in ambient/screen space, above the panels).
    const headerFont = UI.getTheme().font;
    Draw.text("UI GALLERY", {
      x: 24,
      y: 16,
      size: 22,
      color: "#e7ecf0",
      font: `bold 22px ${headerFont}`,
    });
    Draw.text("every immediate-mode primitive on one screen", {
      x: 24,
      y: 44,
      size: 12,
      color: "#8b94a0",
      font: `12px ${headerFont}`,
    });

    // UI-scale knob — drawn in NATIVE screen space (pinned top-right, outside the
    // UI.scaled block below) so it's always the same size and reachable no matter
    // how far the board is zoomed. It's the one control that must not scale itself.
    uiScale = UI.slider({
      id: uiId("ui-scale"),
      x: Math.max(232, view.w - 236),
      y: 20,
      w: 212,
      label: "UI Scale",
      value: uiScale,
      min: 0.75,
      max: 2,
      step: 0.25,
      format: (v) => `${v.toFixed(2)}x`,
    });
    // Publish the knob as the GLOBAL UI scale — the DEFAULT FACTOR the no-arg
    // `UI.scaled(() => …)` block below applies. The setting is only a
    // preference; the BLOCK is what applies it, so the boundary between what
    // zooms (everything inside) and what doesn't (this header) stays visible.
    UI.setScale(uiScale);

    // ---- responsive, scrollable board ----
    // A wrapping row of flowing columns inside a viewport-tall SCROLL column, so
    // the whole board pans as one on small screens (wheel / thumb / swipe).
    // `wrap: true` breaks the ~300px columns onto a new line when the window is
    // too narrow (each new line clears the previous line's tallest column, so
    // nothing overlaps), and each column AUTO-SIZES its height from its children.
    // `idScope` gives the nested containers stable cache ids.
    const th = UI.getTheme(); // drag & drop bins/preview paint from the live theme
    const HEADER_H = 64; // header chrome (screen px); the board sits just below it
    // The popover's anchor, in the board's REFERENCE coords — it's drawn inside
    // the same block, so it carries over without mapping.
    let popoverAt = { x: 24, y: HEADER_H };
    UI.idScope("panels", () =>
      // ONE scaled block holds everything that zooms: the board, the drag
      // preview and the overlays. Draw AND pointer are scaled together, so
      // hit-testing matches. Inside we lay out in REFERENCE units and read the
      // (scaled) space via UI.width/height, so the columns still REFLOW to fit;
      // only the zoom differs. UI.fromScreen brings the header's screen-px
      // chrome into those units, so no division by the scale appears here.
      UI.scaled(() => {
        const availW = UI.width();
        const availH = UI.height();
        const baseX = 24;
        const baseY = UI.fromScreen(0, HEADER_H).y; // pin the board under the header
        const bottomGap = UI.fromScreen(0, 12).y;
        const colW = 300;
        UI.col(
          {
            x: baseX,
            y: baseY,
            w: availW - baseX * 2,
            h: availH - baseY - bottomGap,
            overflow: "auto",
            pad: 0,
            gap: 0,
            id: uiId("scroll"),
          },
          () => {
            UI.row({ w: availW - baseX * 2 - 14, gap: 16, wrap: true, id: uiId("board") }, () => {
              // ================= COLUMN 1 =================
              // Flows to its natural height; the WHOLE board scrolls as one (the
              // wrapping scroll column it sits in), so there's no per-column scroll.
              UI.col({ w: colW, gap: 16, id: uiId("col1") }, () => {
                // Theme picker — a normal group flowing with the rest (its drop-menu
                // is a frame-end overlay, so it still renders above the panels).
                UI.panel({ title: "Theme", gap: 8 }, () => {
                  const themeSel = UI.select({
                    id: uiId("theme"),
                    value: currentTheme,
                    groups: themeGroups,
                    wrapItems: true,
                    ariaLabel: "Theme",
                  });
                  if (themeSel.changed) {
                    applyTheme(themeSel.value);
                  }
                  const fontSel = UI.select({
                    id: uiId("font"),
                    value: currentFont,
                    options: fontOptions.map(({ label, value }) => ({ label, value })),
                    wrapItems: true,
                    ariaLabel: "Pixel font",
                  });
                  if (fontSel.changed) applyFont(fontSel.value);
                  if (
                    atlasDebug[currentTheme] &&
                    UI.button({ id: uiId("atlas-debug"), label: "Inspect atlas" })
                  ) {
                    atlasDebugOpen = true;
                    resetAtlasView();
                  }
                });

                // Buttons — every variant, two per row so the row fits the column.
                UI.panel({ title: "Buttons", gap: 8 }, () => {
                  UI.row({ gap: 8 }, () => {
                    // ANCHORED float text — no coordinates, so it pops from the
                    // top-center of the button just placed, wherever the reflow
                    // put it, and at the board's zoom.
                    if (UI.button({ id: uiId("btn-default"), label: "Default" }))
                      UI.floatText("clicked");
                    UI.button({ id: uiId("btn-primary"), label: "Primary", variant: "primary" });
                  });
                  UI.row({ gap: 8 }, () => {
                    UI.button({ id: uiId("btn-danger"), label: "Danger", variant: "danger" });
                    UI.button({ id: uiId("btn-ghost"), label: "Ghost", variant: "ghost" });
                  });
                  UI.row({ gap: 8 }, () => {
                    UI.button({
                      id: uiId("btn-disabled"),
                      label: "Disabled",
                      disabled: true,
                      tooltip: "This button is disabled",
                    });
                    UI.button({
                      id: uiId("btn-tip"),
                      label: "Hover me",
                      tooltip: "A tooltip appears after a moment",
                    });
                  });
                });

                UI.panel({ title: "Toggles & Sliders", gap: 10 }, () => {
                  sound = UI.toggle({ id: uiId("tg-sound"), label: "Sound enabled", on: sound });
                  reducedMotion = UI.toggle({
                    id: uiId("tg-motion"),
                    label: "Reduced motion",
                    on: reducedMotion,
                  });
                  radio = UI.toggle({
                    id: uiId("tg-radio"),
                    label: "Radio appearance",
                    appearance: "radio",
                    on: radio,
                  });
                  disabledToggle = UI.toggle({
                    id: uiId("tg-disabled"),
                    label: "Locked option",
                    on: disabledToggle,
                    disabled: true,
                  });
                  volume = UI.slider({
                    id: uiId("sl-volume"),
                    label: "Vol",
                    value: volume,
                    min: 0,
                    max: 100,
                    format: (v) => `${Math.round(v)}%`,
                  });
                  zoom = UI.slider({
                    id: uiId("sl-zoom"),
                    label: "Zoom",
                    value: zoom,
                    min: 0.5,
                    max: 3,
                    step: 0.25,
                    format: (v) => `${v.toFixed(2)}x`,
                  });
                });

                UI.panel({ title: "Select & Text input", gap: 10 }, () => {
                  UI.text("Quality preset", { color: "dim", size: 12 });
                  quality = UI.select({
                    id: uiId("select-quality"),
                    value: quality,
                    options: [
                      { label: "Low", value: "low" },
                      { label: "Medium", value: "medium" },
                      { label: "High", value: "high" },
                      { label: "Ultra", value: "ultra" },
                    ],
                    ariaLabel: "Quality preset",
                  }).value;
                  // A long option list: the drop menu caps at `maxVisible` rows
                  // (default 8) and SCROLLS — windowed around the current value,
                  // with wheel + a scrollbar — instead of running off-screen.
                  UI.text("City (scrolling menu)", { color: "dim", size: 12 });
                  city = UI.select({
                    id: uiId("select-city"),
                    value: city,
                    options: [
                      "Auckland",
                      "Bangkok",
                      "Berlin",
                      "Cairo",
                      "Chicago",
                      "Dubai",
                      "Helsinki",
                      "Istanbul",
                      "London",
                      "Los Angeles",
                      "Madrid",
                      "Mumbai",
                      "Nairobi",
                      "New York",
                      "Oslo",
                      "Paris",
                      "São Paulo",
                      "Seoul",
                      "Singapore",
                      "Stockholm",
                      "Sydney",
                      "Tokyo",
                      "Toronto",
                      "Vancouver",
                    ].map((c) => ({ label: c, value: c })),
                    ariaLabel: "City",
                  }).value;
                  UI.text("Player name", { color: "dim", size: 12 });
                  name = UI.textInput({
                    id: uiId("input-name"),
                    value: name,
                    placeholder: "Type a name…",
                    maxLength: 16,
                    ariaLabel: "Player name",
                  }).value;
                  UI.text(name ? `Hello, ${name}!` : "(nothing entered)", {
                    color: name ? "accent" : "dim",
                    size: 12,
                  });
                  UI.text("Notes (multiline — drag to select, ⌘C to copy)", {
                    color: "dim",
                    size: 12,
                  });
                  notes = UI.textInput({
                    id: uiId("input-notes"),
                    value: notes,
                    rows: 3,
                    placeholder: "Write a few lines…",
                    ariaLabel: "Notes",
                  }).value;
                });
              });

              // ================= COLUMN 2 =================
              UI.col({ w: colW, gap: 16, id: uiId("col2") }, () => {
                UI.panel(
                  {
                    title: "Tabs",
                    gap: 10,
                    theme: getTheme("panel-alt"),
                  },
                  () => {
                    tab = UI.tabs({ id: uiId("tabs"), items: tabPages, active: tab, w: 256 });
                    if (tab === 0)
                      UI.text("A neutral summary of the current session.", {
                        wrap: true,
                        h: 40,
                        w: 256,
                      });
                    else if (tab === 1)
                      UI.text("Kills 42 · Deaths 17 · Assists 9", { color: "accent" });
                    else
                      UI.text("12:04 joined · 12:07 first blood · 12:31 win", {
                        color: "dim",
                        wrap: true,
                        h: 40,
                        w: 256,
                      });
                  },
                );

                UI.panel({ title: "Progress bar (UI.bar)", gap: 10 }, () => {
                  progress = UI.slider({
                    id: uiId("sl-progress"),
                    label: "Load",
                    value: progress,
                    min: 0,
                    max: 1,
                    format: (v) => `${Math.round(v * 100)}%`,
                  });
                  // bar() is a raw draw call — reserve a slot from the layout for geometry.
                  UI.row({ h: th.barH }, (st) => {
                    const r = st.next(220, th.barH);
                    UI.bar({ x: r.x, y: r.y, w: 220, h: th.barH, value: progress });
                  });
                  busy = UI.toggle({ id: uiId("tg-busy"), label: "Working…", on: busy });
                  UI.row({ h: 24 }, (st) => {
                    const r = st.next(20, 20);
                    if (busy) UI.spinner({ x: r.x + 10, y: r.y + 10 });
                  });
                });

                UI.panel({ title: "Overlays", gap: 8 }, () => {
                  UI.row({ gap: 8 }, (st) => {
                    if (UI.button({ id: uiId("open-popover"), label: "Popover" }))
                      popoverOpen = !popoverOpen;
                    // Remember the trigger's bottom-left; the popover is drawn
                    // later in this same block, so the coords carry over.
                    if (st.last) popoverAt = { x: st.last.x, y: st.last.y + st.last.h };
                    if (UI.button({ id: uiId("open-modal"), label: "Modal" })) modalOpen = true;
                  });
                  UI.row({ gap: 8 }, () => {
                    if (UI.button({ id: uiId("open-dialog"), label: "Dialog" })) dialogOpen = true;
                    if (
                      UI.button({ id: uiId("open-confirm"), label: "Confirm", variant: "danger" })
                    )
                      confirmOpen = true;
                  });
                });

                // A row with overflow: "auto" fills the panel width and scrolls
                // horizontally when its chips are wider than it.
                UI.panel({ title: "Horizontal scroll", gap: 8 }, () => {
                  UI.row({ overflow: "auto", gap: 8, id: uiId("hscroll") }, () => {
                    for (let i = 1; i <= 8; i++)
                      UI.button({ id: uiId(`chip-${i}`), label: `Tag ${i}` });
                  });
                });

                // Chat: the `submitted` flag is Enter; `blurOnSubmit: false` keeps
                // focus; clearing `value` on submit empties the box (works even while
                // focused). No dedicated chat API needed.
                UI.panel({ title: "Chat", gap: 6 }, () => {
                  for (const m of chatLog.slice(-3)) UI.text(`• ${m}`, { size: 12, color: "dim" });
                  const sent = UI.textInput({
                    id: uiId("chat"),
                    value: chatDraft,
                    placeholder: "Message… (Enter to send)",
                    blurOnSubmit: false,
                    maxLength: 80,
                    ariaLabel: "Chat message",
                  });
                  chatDraft = sent.value;
                  if (sent.submitted && sent.value.trim()) {
                    chatLog.push(sent.value.trim());
                    chatDraft = ""; // cleared while focused — the controlled-value fix
                  }
                });
              });

              // ================= COLUMN 3 : List + Table =================
              // list/table are raw rect widgets — reserve a fixed-height slot from
              // the flowing column and hand each its slot rect.
              UI.col({ w: colW, gap: 16, id: uiId("col3") }, (st) => {
                const listBox = st.next(colW, 210);
                UI.panel({ ...listBox, title: "List" }, (body) => {
                  // Take the panel's own body slot instead of guessing an inset:
                  // how far the title strip reaches down is the THEME's business
                  // (frame inset + panelTitleH), and a hardcoded offset slides
                  // the first row under a taller title.
                  const listArea: Rect = body.fill();
                  listOffset = UI.list(
                    {
                      ...listArea,
                      rowH: 28,
                      gap: 2,
                      count: listItems.length,
                      offset: listOffset,
                      id: uiId("list"),
                    },
                    (i, rect) => {
                      if (
                        UI.listItem({ id: uiId(`li-${i}`), ...rect, selected: i === selectedItem })
                      )
                        selectedItem = i;
                      UI.text(listItems[i], { x: rect.x + 10, y: rect.y, h: rect.h });
                    },
                  );
                });

                const tableBox = st.next(colW, 232);
                UI.panel({ ...tableBox, title: "Table" }, (body) => {
                  const res = UI.table<Player>({
                    ...body.fill(),
                    rowH: 26,
                    cellPadX: 8,
                    cellPadY: 2,
                    id: uiId("table"),
                    rows: players,
                    sort: tableSort,
                    offset: tableOffset,
                    selected: tableSel,
                    columns: [
                      { key: "name", label: "PLAYER", value: (p) => p.name },
                      {
                        key: "score",
                        label: "SCORE",
                        width: 72,
                        align: "right",
                        value: (p) => p.score,
                      },
                      {
                        key: "kd",
                        label: "K/D",
                        width: 58,
                        align: "right",
                        value: (p) => p.kd,
                        cell: (p, r) =>
                          UI.text(p.kd.toFixed(1), {
                            ...r,
                            align: "right",
                            color: p.kd >= 2 ? "accent" : "dim",
                          }),
                      },
                    ],
                  });
                  tableSort = res.sort;
                  tableOffset = res.offset;
                  tableSel = res.selected;
                });
              });

              // ================= COLUMN 4 : Drag & drop =================
              // DragSource/dropTarget provide interaction state only; the
              // consumer owns the visual surface. Use normal themed panels and
              // buttons here so the example follows the active skin.
              UI.col({ w: colW, gap: 16, id: uiId("col4") }, (st) => {
                const ddBox = st.next(colW, 300);
                UI.panel({ ...ddBox, title: "Drag & drop" }, () => {
                  UI.text("Drag items between the two bins", {
                    x: ddBox.x + 12,
                    y: ddBox.y + 38,
                    color: "dim",
                    size: 12,
                  });
                  const binW = (ddBox.w - 36) / 2;
                  const binTop = ddBox.y + 62;
                  const binH = ddBox.h - 74;
                  const bins: { id: string; title: string; items: string[] }[] = [
                    { id: "loadout", title: "LOADOUT", items: binLoadout },
                    { id: "stash", title: "STASH", items: binStash },
                  ];
                  bins.forEach((bin, bi) => {
                    const bx = ddBox.x + 12 + bi * (binW + 12);
                    const target = UI.dropTarget<{ item: string; from: string }>({
                      id: `bin:${bin.id}`,
                      x: bx,
                      y: binTop,
                      w: binW,
                      h: binH,
                      accepts: (payload) => payload.from !== bin.id,
                    });
                    UI.panel(
                      {
                        x: bx,
                        y: binTop,
                        w: binW,
                        h: binH,
                        title: bin.title,
                        pad: 6,
                        gap: 4,
                        border: target.canDrop ? th.accent : undefined,
                      },
                      () => {
                        bin.items.forEach((item) => {
                          UI.button({
                            id: `drag-button:${bin.id}:${item}`,
                            label: item,
                            w: binW - 12,
                            h: th.buttonH,
                            variant: "ghost",
                          });
                          const itemRect = UI.lastRect();
                          if (itemRect) {
                            UI.dragSource({
                              id: `item:${bin.id}:${item}`,
                              ...itemRect,
                              payload: { item, from: bin.id },
                            });
                          }
                        });
                      },
                    );
                    // Apply a completed drop: move the item across.
                    if (target.dropped) {
                      const { item, from } = target.dropped.payload;
                      if (from === "loadout") binLoadout = binLoadout.filter((x) => x !== item);
                      else binStash = binStash.filter((x) => x !== item);
                      if (bin.id === "loadout") binLoadout = [...binLoadout, item];
                      else binStash = [...binStash, item];
                    }
                  });
                });
              });

              // ================= COLUMN 5 : Layout & regions =================
              // Grid and the clipped scrollbar viewport intentionally use fixed
              // regions. The flow-cursor and spacer demos are ordinary auto-flowing
              // panels, so their height comes from their children.
              UI.col({ w: colW, gap: 16, id: uiId("col5") }, (st) => {
                // UI.grid — even 2-D cells; here a 4×2 emoji inventory. listItem
                // paints each cell's hover/selected state; a click selects it.
                const gridBox = st.next(colW, 150);
                UI.panel(
                  {
                    ...gridBox,
                    title: "Grid (inventory)",
                    theme: getTheme("panel-alt"),
                  },
                  () => {
                    UI.grid(
                      {
                        x: gridBox.x + 12,
                        y: gridBox.y + 42,
                        w: gridBox.w - 24,
                        h: gridBox.h - 54,
                        cols: 4,
                        count: 8,
                        gap: 6,
                      },
                      (cell, i) => {
                        if (UI.listItem({ id: uiId(`slot-${i}`), ...cell, selected: i === invSel }))
                          invSel = i;
                        UI.text(invItems[i] ?? "", { ...cell, align: "center", size: 22 });
                      },
                    );
                  },
                );

                // UI.flow — the low-level layout cursor (what row/col use inside).
                // Here an `align: "end"` cursor lays two auto-width buttons out
                // right-to-left for a right-anchored toolbar.
                UI.panel({ w: colW, title: "Flow cursor (toolbar)" }, (body) => {
                  const row = body.next(undefined, 30);
                  UI.text("History", { x: row.x, y: row.y, h: row.h, color: "dim" });
                  const bar = UI.flow({
                    x: row.x + row.w - 12,
                    y: row.y,
                    dir: "row",
                    align: "end",
                    gap: 8,
                  });
                  if (UI.button({ at: bar, id: uiId("st-redo"), label: "Redo" }))
                    UI.floatText("redo", row.x + row.w - 40, row.y);
                  if (UI.button({ at: bar, id: uiId("st-undo"), label: "Undo" }))
                    UI.floatText("undo", row.x + row.w - 100, row.y);
                });

                // UI.spacer — a fixed gap inserted before the next child; sized from
                // the row cursor's `remaining` space, it pushes the button flush to
                // the right edge (a manual alternative to a flex spacer).
                UI.panel({ w: colW, title: "Spacer (align right)" }, () => {
                  UI.row({ h: 30 }, (rst) => {
                    UI.text("v1.4.2", { color: "dim", h: 30 });
                    UI.spacer(Math.max(0, rst.remaining - 76));
                    if (
                      UI.button({ id: uiId("sp-save"), label: "Save", w: 76, variant: "primary" })
                    )
                      UI.floatText("saved", UI.lastRect()?.x ?? 0, UI.lastRect()?.y ?? 0);
                  });
                });

                // UI.clip + UI.scrollbar — a clipped viewport masks tall content
                // (drawn at a scrolled offset), and an EXPLICIT scrollbar bound to
                // the content/view extents drives that offset (thumb, track and
                // wheel). Distinct from the implicit overflow:"auto" columns above.
                const clipBox = st.next(colW, 168);
                UI.panel({ ...clipBox, title: "Clip + scrollbar" }, () => {
                  const vpRect: Rect = {
                    x: clipBox.x + 12,
                    y: clipBox.y + 40,
                    w: clipBox.w - 34,
                    h: clipBox.h - 52,
                  };
                  const lineH = 22;
                  const content = creditLines.length * lineH;
                  UI.clip(vpRect, () => {
                    for (let i = 0; i < creditLines.length; i++)
                      UI.text(creditLines[i], {
                        x: vpRect.x + 4,
                        y: vpRect.y - clipOffset + i * lineH,
                        h: lineH,
                        size: 13,
                        color: i === 0 ? "accent" : undefined,
                      });
                  });
                  clipOffset = UI.scrollbar({
                    x: vpRect.x + vpRect.w + 6,
                    y: vpRect.y,
                    h: vpRect.h,
                    view: vpRect.h,
                    content,
                    offset: clipOffset,
                    wheelArea: vpRect,
                    id: uiId("clip-sb"),
                  });
                });
              });
            });
          },
        );

        // Drag preview: a chip trailing the pointer, above the flowing board.
        // The pointer arrives in screen coords, so bring it into the block's
        // units — then the chip is written at its natural size and zooms too.
        const dragged = UI.draggedItem<{ item: string; from: string }>();
        if (dragged) {
          const at = UI.fromScreen(Pointer.x + 8, Pointer.y + 8);
          Draw.rect(at.x, at.y, 90, 24, th.accent);
          UI.text(dragged.payload.item, {
            ...at,
            w: 90,
            h: 24,
            align: "center",
            color: th.bgActive,
          });
        }

        // ================= OVERLAYS — drawn LAST so they sit on top and
        //                   deaden the widgets behind them =================
        // Still inside the one scaled block: sitting on top is about draw ORDER,
        // not about escaping the block. They lay out in the same reference units,
        // and the viewport-anchored bits (modal centering, the dialog's bottom
        // edge) measure the block's reference box.

        // Popover anchored beneath its trigger button — the CHILDREN form, so the
        // box auto-sizes to its content (no manual height). A close button inside
        // can't override the returned open-state, so it sets a flag we apply after.
        let popClose = false;
        popoverOpen = UI.popover(
          { x: popoverAt.x, y: popoverAt.y + 6, w: 220, title: "Popover", open: popoverOpen },
          () => {
            UI.text("A floating anchored panel.", { color: "dim", size: 12, wrap: true, w: 196 });
            if (UI.button({ id: uiId("pop-close"), label: "Close" })) popClose = true;
          },
        );
        if (popClose) popoverOpen = false;

        // Modal — the CHILDREN form: dim + centered panel whose contents lay
        // themselves out and whose height shrink-wraps them (no `h`, no rect math).
        if (modalOpen) {
          UI.modal({ w: 340, title: "Modal", id: uiId("modal") }, () => {
            UI.text("A centered dialog over a dimmed backdrop.", { wrap: true, w: 300, h: 40 });
            // `justify: "end"` measures the content run from the container's
            // cache, so the row needs an id to right-align from the first frame.
            UI.row({ justify: "end", id: uiId("modal-actions") }, () => {
              if (UI.button({ id: uiId("modal-ok"), label: "Got it", variant: "primary", w: 96 }))
                modalOpen = false;
            });
          });
        }

        // Confirm: a whole dialog in one declarative call.
        if (confirmOpen) {
          const hit = UI.confirm({
            id: uiId("confirm"),
            title: "Delete save?",
            lines: ["This cannot be undone.", "Your progress will be lost."],
            buttons: ["Cancel", "Delete"],
            variants: ["default", "danger"],
          });
          if (hit) confirmOpen = false;
        }

        // Dialog: bottom-screen speaker box with choices.
        if (dialogOpen) {
          const answer = UI.dialog({
            id: uiId("dialog"),
            speaker: "GUIDE",
            lines: ["Welcome to the UI gallery.", "Every primitive here is immediate-mode."],
            choices: ["Neat", "Close"],
          });
          if (answer) dialogOpen = false;
        }

        // Atlas inspector — a deliberately gallery-only diagnostic overlay.
        // It reads the same semantic regions used by the theme factory, draws
        // the atlas at nearest-neighbour scale, and marks each frame's 3×3/3×1
        // source split so a tileset definition can be checked visually.
        const atlas = atlasDebug[currentTheme];
        if (atlasDebugOpen && atlas) {
          // The inspector is tooling, not part of the themed showcase. Use
          // the engine default chrome/font so a broken or highly decorative
          // theme cannot make its own debugger unreadable. The atlas art and
          // mapping overlays remain the selected theme's data.
          UI.withTheme({ ...UI.defaultTheme, skin: undefined }, () => {
            const modal = UI.modal({
              w: Math.round(UI.width() * 0.95),
              h: Math.round(UI.height() * 0.95),
              title: `${currentTheme} atlas`,
              id: uiId("atlas-modal"),
            });
            const views = [atlas, ...(atlas.variants ?? [])];
            atlasVariant = Math.max(0, Math.min(atlasVariant, views.length - 1));
            const view = views[atlasVariant];
            const overlayColors = ["#ff4ecb", "#35d9ff", "#a7f542", "#ffad42"];
            const overlayFills = [
              "rgba(255,78,203,0.18)",
              "rgba(53,217,255,0.18)",
              "rgba(167,245,66,0.18)",
              "rgba(255,173,66,0.18)",
            ];
            const overlayColor = overlayColors[atlasVariant % overlayColors.length];
            const overlayFill = overlayFills[atlasVariant % overlayFills.length];
            const source = view.image as {
              width?: number;
              height?: number;
              naturalWidth?: number;
              naturalHeight?: number;
            };
            const sourceW = source.naturalWidth ?? source.width ?? 1;
            const sourceH = source.naturalHeight ?? source.height ?? 1;
            const legendW = Math.min(330, Math.max(240, modal.w * 0.3));
            const viewport = {
              x: modal.x + 14,
              y: modal.y + 38,
              w: modal.w - legendW - 28,
              h: modal.h - 78,
            };
            const fitScale = Math.min(1, viewport.w / sourceW, viewport.h / sourceH);
            const scale = fitScale * atlasZoom;
            const imageW = sourceW * scale;
            const imageH = sourceH * scale;
            const centeredImageX = viewport.x + (viewport.w - imageW) / 2;
            const centeredImageY = viewport.y + (viewport.h - imageH) / 2;
            const atlasDrag = UI.dragGesture({
              id: uiId("atlas-pan"),
              x: viewport.x,
              y: viewport.y,
              w: viewport.w,
              h: viewport.h,
            });
            if (atlasDrag.dragging) {
              if (!atlasWasDragging) {
                atlasDragStart = {
                  panX: atlasPan.x,
                  panY: atlasPan.y,
                };
                atlasWasDragging = true;
              }
              atlasPan = {
                x: atlasDragStart.panX + atlasDrag.dx,
                y: atlasDragStart.panY + atlasDrag.dy,
              };
            } else {
              atlasWasDragging = false;
            }
            const imageX = centeredImageX + atlasPan.x;
            const imageY = centeredImageY + atlasPan.y;
            const pointer = UI.fromScreen(Pointer.x, Pointer.y);
            let hoveredCell: {
              entry: (typeof view.entries)[number];
              index: number;
              col: number;
              row: number;
              cols: number;
              rows: number;
              sourceX: number;
              sourceY: number;
              sourceW: number;
              sourceH: number;
            } | null = null;
            const ctx = Draw.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.rect(viewport.x, viewport.y, viewport.w, viewport.h);
            ctx.clip();
            Draw.image(view.image, imageX, imageY, imageW, imageH);
            view.entries.forEach((entry, index) => {
              const r = entry.region;
              const x = imageX + r.sx * scale;
              const y = imageY + r.sy * scale;
              const w = r.sw * scale;
              const h = r.sh * scale;
              const nineSlice = entry.mapping === "nine-slice" && entry.insets;
              const cols = nineSlice ? 3 : (entry.split?.cols ?? 1);
              const rows = nineSlice ? 3 : (entry.split?.rows ?? 1);
              const sourceXs = nineSlice
                ? [0, entry.insets!.left, r.sw - entry.insets!.right, r.sw]
                : Array.from({ length: cols + 1 }, (_, edge) => (r.sw / cols) * edge);
              const sourceYs = nineSlice
                ? [0, entry.insets!.top, r.sh - entry.insets!.bottom, r.sh]
                : Array.from({ length: rows + 1 }, (_, edge) => (r.sh / rows) * edge);
              for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                  const sourceX = sourceXs[col];
                  const sourceY = sourceYs[row];
                  const sourceW = sourceXs[col + 1] - sourceX;
                  const sourceH = sourceYs[row + 1] - sourceY;
                  const cellX = imageX + (r.sx + sourceX) * scale;
                  const cellY = imageY + (r.sy + sourceY) * scale;
                  const cellW = sourceW * scale;
                  const cellH = sourceH * scale;
                  if (sourceW <= 0 || sourceH <= 0) continue;
                  Draw.rect(cellX, cellY, cellW, cellH, overlayFill);
                  if (
                    !hoveredCell &&
                    pointer.x >= cellX &&
                    pointer.x <= cellX + cellW &&
                    pointer.y >= cellY &&
                    pointer.y <= cellY + cellH
                  ) {
                    hoveredCell = {
                      entry,
                      index,
                      col,
                      row,
                      cols,
                      rows,
                      sourceX: r.sx + sourceX,
                      sourceY: r.sy + sourceY,
                      sourceW,
                      sourceH,
                    };
                    Draw.rect(cellX, cellY, cellW, cellH, "rgba(255,255,255,0.20)");
                  }
                  const cellName =
                    entry.mapping === "auto9" || entry.mapping === "nine-slice"
                      ? ["TL", "T", "TR", "L", "C", "R", "BL", "B", "BR"][row * cols + col]
                      : `${row * cols + col}`;
                  if (cellW >= 12 && cellH >= 10)
                    Draw.text(cellName, {
                      x: cellX + 2,
                      y: cellY + 2,
                      size: Math.max(7, Math.min(11, cellH * 0.35)),
                      color: overlayColor,
                    });
                }
              }
              ctx.save();
              ctx.globalCompositeOperation = "difference";
              Draw.rectStroke(x, y, w, h, "#fff", Math.max(1, 2 * scale));
              for (let col = 1; col < sourceXs.length - 1; col++)
                if (sourceXs[col] > 0 && sourceXs[col] < r.sw)
                  Draw.line(
                    x + sourceXs[col] * scale,
                    y,
                    x + sourceXs[col] * scale,
                    y + h,
                    "#fff",
                    1,
                  );
              for (let row = 1; row < sourceYs.length - 1; row++)
                if (sourceYs[row] > 0 && sourceYs[row] < r.sh)
                  Draw.line(
                    x,
                    y + sourceYs[row] * scale,
                    x + w,
                    y + sourceYs[row] * scale,
                    "#fff",
                    1,
                  );
              ctx.restore();
              Draw.text(String(index + 1), { x: x + 2, y: y + 2, size: 8, color: overlayColor });
            });
            ctx.restore();
            const legendX = viewport.x + viewport.w + 10;
            const legendCols = view.entries.length > 42 ? 2 : 1;
            const legendColW = (modal.x + modal.w - legendX - 10) / legendCols;
            const legendLineH = 14;
            const rowsPerCol = Math.ceil(view.entries.length / legendCols);
            view.entries.forEach((entry, index) => {
              const col = Math.floor(index / rowsPerCol);
              const row = index % rowsPerCol;
              Draw.text(`${index + 1}. ${entry.label} · ${entry.mapping}`, {
                x: legendX + col * legendColW,
                y: viewport.y + row * legendLineH,
                size: 9,
                color: overlayColor,
              });
            });

            const hovered = hoveredCell as {
              entry: (typeof view.entries)[number];
              index: number;
              col: number;
              row: number;
              cols: number;
              rows: number;
              sourceX: number;
              sourceY: number;
              sourceW: number;
              sourceH: number;
            } | null;
            if (hovered) {
              const { entry, col, row, cols } = hovered;
              const cellIndex = row * cols + col;
              const cellName =
                entry.mapping === "auto9" || entry.mapping === "nine-slice"
                  ? [
                      "top-left",
                      "top",
                      "top-right",
                      "left",
                      "center",
                      "right",
                      "bottom-left",
                      "bottom",
                      "bottom-right",
                    ][cellIndex]
                  : `cell ${cellIndex}`;
              const lines = [
                entry.label,
                `mapping: ${entry.mapping}`,
                `${cellName} (${col}, ${row})`,
                `source: ${hovered.sourceX}, ${hovered.sourceY} (${hovered.sourceW}×${hovered.sourceH})`,
              ];
              const tipW = 278;
              const tipH = 12 + lines.length * 15;
              let tipX = pointer.x + 14;
              let tipY = pointer.y + 14;
              if (tipX + tipW > viewport.x + viewport.w) tipX = pointer.x - tipW - 14;
              if (tipY + tipH > viewport.y + viewport.h) tipY = pointer.y - tipH - 14;
              tipX = Math.max(viewport.x + 4, Math.min(tipX, viewport.x + viewport.w - tipW - 4));
              tipY = Math.max(viewport.y + 4, Math.min(tipY, viewport.y + viewport.h - tipH - 4));
              Draw.rect(tipX, tipY, tipW, tipH, "rgba(8,10,22,0.96)");
              Draw.rectStroke(tipX, tipY, tipW, tipH, overlayColor, 2);
              lines.forEach((line, lineIndex) => {
                Draw.text(line, {
                  x: tipX + 10,
                  y: tipY + 7 + lineIndex * 15,
                  size: 10,
                  font: UI.getTheme().font,
                  color: "#fff7d6",
                });
              });
            }

            const controlsY = modal.y + modal.h - 34;
            if (
              UI.button({
                x: modal.x + 14,
                y: controlsY,
                w: 30,
                h: 24,
                label: "−",
                id: uiId("atlas-zoom-out"),
              })
            )
              atlasZoom = Math.max(0.5, atlasZoom / 2);
            if (
              UI.button({
                x: modal.x + 48,
                y: controlsY,
                w: 62,
                h: 24,
                label: "Fit",
                id: uiId("atlas-zoom-reset"),
              })
            )
              resetAtlasView();
            if (
              UI.button({
                x: modal.x + 114,
                y: controlsY,
                w: 30,
                h: 24,
                label: "+",
                id: uiId("atlas-zoom-in"),
              })
            )
              atlasZoom = Math.min(4, atlasZoom * 2);
            if (
              UI.button({
                x: modal.x + 150,
                y: controlsY,
                w: 76,
                h: 24,
                label: "Center",
                id: uiId("atlas-center"),
              })
            )
              atlasPan = { x: 0, y: 0 };
            if (views.length > 1) {
              let variantX = modal.x + 242;
              views.forEach((candidate, index) => {
                const label = index === 0 ? "Default" : candidate.label;
                const variantW = Math.max(72, label.length * 7 + 18);
                if (
                  UI.button({
                    x: variantX,
                    y: controlsY,
                    w: variantW,
                    h: 24,
                    label,
                    id: uiId(`atlas-variant-${index}`),
                  })
                )
                  atlasVariant = index;
                variantX += variantW + 6;
              });
            }
            if (
              UI.button({
                x: modal.x + modal.w - 108,
                y: controlsY,
                w: 92,
                h: 24,
                label: "Close",
                id: uiId("atlas-close"),
              })
            )
              atlasDebugOpen = false;
          });
        }
      }),
    );

    // Floating texts, then tooltips — on the very top, and OUTSIDE the block:
    // these paint things spawned/requested earlier, each of which captured the
    // scale it was created at. Inside the block they'd be scaled twice.
    UI.drawFloatText();
    UI.drawTips();
  },
});
