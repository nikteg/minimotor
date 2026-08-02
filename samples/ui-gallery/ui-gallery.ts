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
import type { TableSort, ThemeOverrides } from "minimotor";
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
// The root UI column reads the live viewport from the UI runtime, so its flow
// can REFLOW to the window instead of using a copied width/height. The board's
// OWN zoom is opt-in: the header's "UI Scale" slider drives `UI.scaled` (below),
// which scales the board's draw + pointer while it still reflows.
const game = createApp("game", { background: "#12141c" });
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
  invSlots: string[];
  clipOffset: number;
  layoutDebug: boolean;
  currentFont: string;
  currentTheme: string;
}

// Vite decides whether a module is self-accepting by STATICALLY scanning its
// source for `import.meta.hot.accept`. The bridge below calls `accept()` too,
// but through a function in another module, which that scan cannot see — so
// without this literal call the gallery is treated as non-accepting, every
// edit becomes a full PAGE RELOAD, and `hot.data` (with every field persisted
// into it) is gone before the next instance can read it.
(import.meta as ImportMeta & { hot?: HotModuleContext }).hot?.accept();
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

// drag & drop — two bins plus the inventory grid, all three trading items.
/** What every drag source here carries: the item, and the collection it came
 *  from so the drop knows where to remove it. */
interface DragItem {
  item: string;
  from: string;
}
let binLoadout: string[] = ["Sword", "Shield"];
let binStash: string[] = ["Potion", "Torch", "Rope", "Key"];

// UI.grid — an inventory grid; dragging a cell reorders it. `invItems` is the
// pack's fixed list, so the live order is its own array.
let invSlots: string[] = [...invItems];
// The layout-box overlay, toggled from the header.
let layoutDebug = false;
// UI.clip + UI.scrollbar — offset into a clipped, explicitly-scrolled region
let clipOffset = 0;

// ---- theme picker ----
// Each preset is a `ThemeOverrides` patch scoped over the board column. The header
// remains on the library default theme. "Teal" is the built-in default, so it
// passes `{}`. The colored presets swap the accent trio; "Slate Light" flips
// the whole palette bright.
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
  {
    label: "Micro5 — ultra narrow",
    value: "micro5",
    font: '"Micro5", monospace',
  },
  {
    label: "Jersey 10 — narrow",
    value: "jersey10",
    font: '"Jersey 10", monospace',
  },
  {
    label: "Jersey 15 — compact",
    value: "jersey15",
    font: '"Jersey 15", monospace',
  },
  { label: "m5x7 — narrow bitmap", value: "m5x7", font: '"m5x7", monospace' },
  {
    label: "Monogram — bitmap",
    value: "monogram",
    font: '"Monogram", monospace',
  },
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

function galleryTheme(): ThemeOverrides {
  const chosen = themePresets.find((themePreset) => themePreset.value === currentTheme);
  const selectedFont = fontOptions.find((font) => font.value === currentFont);
  return {
    ...(chosen?.preset ?? themePresets[0].preset),
    ...(selectedFont?.font ? { font: selectedFont.font } : {}),
  };
}

function applyTheme(value: string): void {
  currentTheme = themePresets.some((themePreset) => themePreset.value === value)
    ? value
    : "visuals";
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
  // `??` on the collections, not decoration: a payload saved by an EARLIER
  // build of this module has no key for a field added since, and `[...undefined]`
  // throws right here — at module top level, which loses the whole restore and
  // takes the page with it. The three drag-and-drop collections are the fields
  // most likely to be newer than the state in the page you are hot-reloading.
  binLoadout = [...(previousGalleryState.binLoadout ?? binLoadout)];
  binStash = [...(previousGalleryState.binStash ?? binStash)];
  invSlots = [...(previousGalleryState.invSlots ?? invSlots)];
  clipOffset = previousGalleryState.clipOffset;
  layoutDebug = previousGalleryState.layoutDebug;
  UI.layoutCapture(layoutDebug);
}

/** Resolve the theme scope a gallery panel should inherit. Panel call sites
 *  ask for a semantic treatment; they do not know which preset supplies it. */
function getTheme(scope: "default" | "panel-alt" = "default"): ThemeOverrides | undefined {
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
      getState(): {
        uiScale: number;
        volume: number;
        city: string;
        name: string;
        notes: string;
      };
      /** Width of `str` in the ACTIVE theme's UI font — what the widgets draw
       *  with. Tests use it to aim a click at a character offset. */
      textWidth(str: string): number;
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
  getState: () => ({ uiScale, volume, city, name, notes }),
  textWidth: (str) => UI.textWidth(str),
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
  invSlots: [...invSlots],
  clipOffset,
  layoutDebug,
  currentFont,
  currentTheme,
}));
galleryHot.onDispose(() => game.destroy());

Loop.run({
  update() {
    // No simulation — the gallery is drawn entirely from widget state.
  },

  draw() {
    // The viewport itself is the outer column: the header takes its natural
    // height, and the board fills whatever remains below it. The header stays
    // outside UI.scaled so its controls remain native-size and reachable.
    UI.col(
      {
        flex: "fill",
        gap: 0,
        pad: 8,
      },
      () => {
        UI.col(
          {
            pad: { y: 8 },
            fitCross: true,
          },
          () => {
            // FIXME: This equal-width row is a layout-API smell. The
            // gallery should not have to know that there are exactly two
            // fill children just to make sibling panels look balanced.
            //
            // TODO: Revisit the equal-distribution primitive in the UI
            // library. Ideally `row` would discover its direct fill
            // children automatically, without this count and without
            // measuring or sizing anything in the sample. A future
            // solution should also handle bins being added/removed while
            // preserving immediate-mode input semantics.
            //
            // TODO: Also question whether this gallery needs equal-sized
            // bins at all. Natural auto-sized panels may be the better
            // demonstration of the library's automatic flow, especially
            // for themes whose button padding and frame art differ.
            UI.row(
              {
                id: uiId("header-row"),
                justify: "center",
                alignCross: "center",
                fitCross: true,
              },
              () => {
                UI.col(
                  {
                    fitCross: true,
                    alignCross: "start",
                  },
                  () => {
                    UI.text("UI GALLERY", { size: 22, bold: true });
                    UI.text("every immediate-mode primitive on one screen", {
                      color: "dim",
                      size: 12,
                    });
                  },
                );

                UI.col(
                  {
                    fitCross: true,
                    alignCross: "start",
                  },
                  () => {
                    // Layout-box overlay toggle. It drives `layoutCapture` rather than
                    // just a draw flag: the recorder is off by default and costs nothing
                    // until something asks for it.
                    const debugOn = UI.toggle({
                      id: uiId("layout-debug"),
                      label: "Show layout bounding boxes",
                      on: layoutDebug,
                      tooltip: "Overlay every layout box — containers, padding and gaps",
                    });
                    if (debugOn !== layoutDebug) {
                      layoutDebug = debugOn;
                      UI.layoutCapture(layoutDebug);
                    }

                    uiScale = UI.slider({
                      id: uiId("ui-scale"),
                      label: "UI Scale",
                      value: uiScale,
                      min: 0.75,
                      max: 2,
                      step: 0.25,
                      format: (v) => `${v.toFixed(2)}x`,
                    });
                  },
                );
              },
            );
          },
        );

        // Publish the knob as the GLOBAL UI scale — the DEFAULT FACTOR the no-arg
        // `UI.scaled(() => …)` block below applies. The setting is only a
        // preference; the BLOCK is what applies it, so the boundary between what
        // zooms (everything inside) and what doesn't (this header) stays visible.
        UI.setScale(uiScale);

        // ---- responsive, scrollable board ----
        // A wrapping row of auto-sized columns inside a viewport-tall SCROLL column,
        // so the whole board pans as one on small screens (wheel / thumb / swipe).
        // `wrap: true` breaks columns onto a new line when the window is too narrow
        // (each new line clears the previous line's tallest column), and each column
        // AUTO-SIZES its width and height from its children.
        // `idScope` gives the nested containers stable cache ids.
        UI.col(
          {
            flex: "fill",
            pad: 8,
            id: uiId("board-slot"),

            theme: galleryTheme(),
          },
          () => {
            const th = UI.getTheme(); // drag & drop bins/preview paint from the board theme
            // The popover's anchor, in the board's REFERENCE coords — it's
            // drawn inside the same block, so it carries over without mapping.
            let popoverAt = { x: 0, y: 0 };
            UI.idScope("panels", () =>
              // ONE scaled block holds everything that zooms: the board, the drag
              // preview and the overlays. Draw AND pointer are scaled together, so
              // hit-testing matches. Inside we lay out in REFERENCE units and read the
              // (scaled) space via UI.width/height, so the columns still REFLOW to fit;
              // only the zoom differs. UI.fromScreen maps the auto-flowed screen slot
              // into those units, so no division by the scale appears here.
              UI.scaled(() => {
                UI.col(
                  {
                    flex: "fill",
                    overflow: "auto",
                    pad: 0,
                    id: uiId("scroll"),
                  },
                  () => {
                    UI.row(
                      {
                        wrap: true,
                        gap: 16,
                        id: uiId("board"),
                      },
                      () => {
                        // ================= COLUMN 1 =================
                        // Flows to its natural height; the WHOLE board scrolls as one (the
                        // wrapping scroll column it sits in), so there's no per-column scroll.
                        UI.col({ id: uiId("col1"), stretchCross: true }, () => {
                          // Theme picker — a normal group flowing with the rest (its drop-menu
                          // is a frame-end overlay, so it still renders above the panels).
                          UI.panel({ title: "Theme" }, () => {
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
                              options: fontOptions.map(({ label, value }) => ({
                                label,
                                value,
                              })),
                              wrapItems: true,
                              ariaLabel: "Pixel font",
                            });
                            if (fontSel.changed) applyFont(fontSel.value);
                            if (
                              atlasDebug[currentTheme] &&
                              UI.button({
                                id: uiId("atlas-debug"),
                                label: "Inspect atlas",
                              })
                            ) {
                              atlasDebugOpen = true;
                              resetAtlasView();
                            }
                          });

                          // Buttons — every variant, two per row so the row fits the column.
                          UI.panel({ title: "Buttons" }, () => {
                            UI.row(() => {
                              // ANCHORED float text — no coordinates, so it pops from the
                              // top-center of the button just placed, wherever the reflow
                              // put it, and at the board's zoom.
                              if (
                                UI.button({
                                  id: uiId("btn-default"),
                                  label: "Default",
                                })
                              )
                                UI.floatText("clicked");
                              UI.button({
                                id: uiId("btn-primary"),
                                label: "Primary",
                                variant: "primary",
                              });
                            });
                            UI.row(() => {
                              UI.button({
                                id: uiId("btn-danger"),
                                label: "Danger",
                                variant: "danger",
                              });
                              UI.button({
                                id: uiId("btn-ghost"),
                                label: "Ghost",
                                variant: "ghost",
                              });
                            });
                            UI.row(() => {
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

                          UI.panel({ title: "Toggles & Sliders" }, () => {
                            sound = UI.toggle({
                              id: uiId("tg-sound"),
                              label: "Sound enabled",
                              on: sound,
                            });
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

                          UI.panel({ title: "Select & Text input" }, () => {
                            UI.text("Quality preset", {
                              color: "dim",
                              size: 12,
                            });
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
                            UI.text("City (scrolling menu)", {
                              color: "dim",
                              size: 12,
                            });
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
                            UI.text("Player name", {
                              color: "dim",
                              size: 12,
                            });
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
                        UI.col({ id: uiId("col2"), stretchCross: true }, () => {
                          UI.panel(
                            {
                              title: "Tabs",
                              theme: getTheme("panel-alt"),
                            },
                            () => {
                              tab = UI.tabs({
                                id: uiId("tabs"),
                                items: tabPages,
                                active: tab,
                              });
                              if (tab === 0)
                                UI.text("A neutral summary of the current session.", {
                                  wrap: true,
                                });
                              else if (tab === 1)
                                UI.text("Kills 42 · Deaths 17 · Assists 9", {
                                  color: "accent",
                                });
                              else
                                UI.text("12:04 joined · 12:07 first blood · 12:31 win", {
                                  color: "dim",
                                  wrap: true,
                                });
                            },
                          );

                          UI.panel({ title: "Progress bar (UI.bar)" }, () => {
                            progress = UI.slider({
                              id: uiId("sl-progress"),
                              label: "Load",
                              flex: "fill",
                              value: progress,
                              min: 0,
                              max: 1,
                              format: (v) => `${Math.round(v * 100)}%`,
                            });
                            // bar() auto-flows into the row at the theme's natural size.
                            UI.row(() => {
                              UI.bar({ value: progress });
                            });
                            busy = UI.toggle({
                              id: uiId("tg-busy"),
                              label: "Working…",
                              on: busy,
                            });
                            UI.row(() => {
                              if (busy) UI.spinner({});
                            });
                          });

                          UI.panel({ title: "Overlays" }, () => {
                            UI.row((st) => {
                              if (
                                UI.button({
                                  id: uiId("open-popover"),
                                  label: "Popover",
                                })
                              )
                                popoverOpen = !popoverOpen;
                              // Remember the trigger's bottom-left; the popover is drawn
                              // later in this same block, so the coords carry over.
                              if (st.last)
                                popoverAt = {
                                  x: st.last.x,
                                  y: st.last.y + st.last.h,
                                };
                              if (
                                UI.button({
                                  id: uiId("open-modal"),
                                  label: "Modal",
                                })
                              )
                                modalOpen = true;
                            });
                            UI.row(() => {
                              if (
                                UI.button({
                                  id: uiId("open-dialog"),
                                  label: "Dialog",
                                })
                              )
                                dialogOpen = true;
                              if (
                                UI.button({
                                  id: uiId("open-confirm"),
                                  label: "Confirm",
                                  variant: "danger",
                                })
                              )
                                confirmOpen = true;
                            });
                          });

                          // A row with overflow: "auto" fills the panel width and scrolls
                          // horizontally when its chips are wider than it.
                          UI.panel({ title: "Horizontal scroll" }, () => {
                            UI.row(
                              {
                                overflow: "auto",
                                id: uiId("hscroll"),
                              },
                              () => {
                                for (let i = 1; i <= 8; i++)
                                  UI.button({
                                    id: uiId(`chip-${i}`),
                                    label: `Tag ${i}`,
                                  });
                              },
                            );
                          });

                          // Chat: the `submitted` flag is Enter; `blurOnSubmit: false` keeps
                          // focus; clearing `value` on submit empties the box (works even while
                          // focused). No dedicated chat API needed.
                          UI.panel({ title: "Chat" }, () => {
                            for (const m of chatLog.slice(-3))
                              UI.text(`• ${m}`, { size: 12, color: "dim" });
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
                        UI.col({ id: uiId("col3"), stretchCross: true }, () => {
                          UI.panel({ title: "List" }, (body) => {
                            // Take the panel's own body slot instead of guessing an inset:
                            // how far the title strip reaches down is the THEME's business
                            // (frame inset + panel.title.height), and a hardcoded offset slides
                            // the first row under a taller title.
                            const listArea: Rect = body.next(undefined, 210);
                            listOffset = UI.list(
                              {
                                ...listArea,
                                rowH: 28,
                                count: listItems.length,
                                offset: listOffset,
                                id: uiId("list"),
                              },
                              (i, rect) => {
                                if (
                                  UI.listItem({
                                    id: uiId(`li-${i}`),
                                    ...rect,
                                    selected: i === selectedItem,
                                  })
                                )
                                  selectedItem = i;
                                UI.text(listItems[i], {
                                  x: rect.x + 10,
                                  y: rect.y,
                                  h: rect.h,
                                });
                              },
                            );
                          });

                          UI.panel({ title: "Table" }, (body) => {
                            const res = UI.table<Player>({
                              ...body.next(undefined, 232),
                              rowHeight: 26,
                              cellPadding: { x: 8, y: 2 },
                              id: uiId("table"),
                              rows: players,
                              sort: tableSort,
                              offset: tableOffset,
                              selected: tableSel,
                              columns: [
                                {
                                  key: "name",
                                  label: "PLAYER",
                                  value: (p) => p.name,
                                },
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
                        //
                        // Two shapes of the same mechanic share one panel: a pair of
                        // vertical bins (a horizontal caret between rows) and a grid (a
                        // vertical caret between cells). The panel takes no height — it
                        // auto-sizes, and the bins grow as items pile into them.
                        UI.col({ id: uiId("col4"), stretchCross: true }, () => {
                          UI.panel({ title: "Drag & drop", stretchCross: true }, (body) => {
                            UI.text("Drag between bins, or reorder in place", {
                              color: "dim",
                              size: 12,
                            });
                            const bins: {
                              id: string;
                              title: string;
                              items: string[];
                            }[] = [
                              {
                                id: "loadout",
                                title: "LOADOUT",
                                items: binLoadout,
                              },
                              {
                                id: "stash",
                                title: "STASH",
                                items: binStash,
                              },
                            ];
                            UI.row(
                              {
                                gap: 12,
                                fitCross: true,
                                fillChildren: bins.length,
                              },
                              () => {
                                bins.forEach((bin) => {
                                  let target = UI.dropTargetState<DragItem>(`bin:${bin.id}`);
                                  let insertAt = 0;
                                  // A bin takes items from the OTHER bin and from itself —
                                  // so the same gesture that moves an item across also
                                  // reorders one in place — but not the inventory's emoji.
                                  // The two collections hold different kinds of thing, and
                                  // `accepts` is where that belongs: refusing at the target
                                  // makes the cursor and the ring say no before the release,
                                  // rather than the drop handler quietly discarding it.
                                  UI.panel<unknown, DragItem>(
                                    {
                                      flex: "fill",
                                      title: bin.title,
                                      dropTarget: {
                                        id: `bin:${bin.id}`,
                                        accepts: (payload) => payload.from !== "inventory",
                                      },
                                    },
                                    (binBody) => {
                                      const slots: Rect[] = [];
                                      bin.items.forEach((item) => {
                                        // Let the button reserve its natural themed width;
                                        // an explicit slot here would override a skin's
                                        // button minimum and make the item paint outside
                                        // the auto-sized bin panel.
                                        UI.button({
                                          at: binBody,
                                          id: `drag-button:${bin.id}:${item}`,
                                          label: item,
                                          variant: "ghost",
                                        });
                                        const slot = UI.lastRect();
                                        if (!slot) return;
                                        slots.push(slot);
                                        UI.dragSource({
                                          id: `item:${bin.id}:${item}`,
                                          ...slot,
                                          payload: { item, from: bin.id },
                                        });
                                      });
                                      // Drawn AFTER the items so the caret sits over them,
                                      // and `silent` on every bin but the hovered one — a
                                      // payload is in flight for both. An empty bin has no
                                      // slot to sit against, so it offers the body origin
                                      // (`extent` with nothing placed) instead.
                                      target = UI.dropTargetState<DragItem>(`bin:${bin.id}`);
                                      insertAt = UI.dropIndicator({
                                        items: slots,
                                        axis: "y",
                                        empty: {
                                          ...binBody.extent,
                                          h: 0,
                                        },
                                        silent: !target?.canDrop,
                                      });
                                    },
                                  );
                                  // Apply a completed drop: move the item across, or reorder
                                  // it inside its own bin. Removing first shifts everything
                                  // after the item down one, so an insertion point past it
                                  // has to come back by one to stay where the caret was.
                                  if (target?.dropped) {
                                    const { item, from } = target.dropped.payload;
                                    const sameBin = from === bin.id;
                                    if (from === "loadout")
                                      binLoadout = binLoadout.filter((x) => x !== item);
                                    else binStash = binStash.filter((x) => x !== item);
                                    const removedBefore =
                                      sameBin && bin.items.indexOf(item) < insertAt;
                                    const at = insertAt - (removedBefore ? 1 : 0);
                                    const dest =
                                      bin.id === "loadout" ? [...binLoadout] : [...binStash];
                                    dest.splice(at, 0, item);
                                    if (bin.id === "loadout") binLoadout = dest;
                                    else binStash = dest;
                                  }
                                });
                              },
                            );

                            // UI.grid — even 2-D cells, here a 4x2 emoji inventory in a
                            // panel of its own. Same mechanic turned ninety degrees: ONE
                            // drop target over the whole grid, because a reorder lands
                            // BETWEEN cells and which gap it lands in is `dropIndicator`'s
                            // job, not the hit test's.
                            //
                            // 22px is the emoji's own size, so a cell twice that reads as a
                            // slot around it. That only sizes the RESERVED box — the cells
                            // themselves come out of `fill()`, so they end up dividing
                            // exactly whatever interior the skin leaves.
                            const chrome =
                              th.panel.title.height +
                              (th.panel.frameInset.top ?? th.panel.frameInset.y ?? 0) +
                              (th.panel.frameInset.bottom ?? th.panel.frameInset.y ?? 0) +
                              (th.panel.padding.top ?? th.panel.padding.y ?? 0) * 2 +
                              20;
                            const invH = chrome + 22 * 2 * 2 + 6;
                            const invBox = body.next(undefined, invH);
                            const slot = UI.dropTarget<DragItem>({
                              id: uiId("inv-grid"),
                              ...invBox,
                              accepts: (payload) => payload.from === "inventory",
                            });
                            const cellRects: Rect[] = [];
                            const invAt = UI.panel(
                              {
                                ...invBox,
                                title: "INVENTORY",
                                highlight: slot.canDrop
                                  ? th.accent
                                  : slot.hovered
                                    ? th.danger
                                    : undefined,
                              },
                              (invBody) => {
                                const cells = invBody.fill();
                                UI.grid(
                                  {
                                    ...cells,
                                    cols: 4,
                                    count: invSlots.length,
                                  },
                                  (r, i) => {
                                    cellRects.push(r);
                                    UI.listItem({
                                      id: uiId(`slot-${i}`),
                                      ...r,
                                    });
                                    UI.text(invSlots[i] ?? "", {
                                      ...r,
                                      align: "center",
                                      size: 22,
                                    });
                                    UI.dragSource({
                                      id: uiId(`inv-drag-${i}`),
                                      ...r,
                                      payload: {
                                        item: invSlots[i] ?? "",
                                        from: "inventory",
                                      },
                                    });
                                  },
                                );
                                // `axis: "x"` in a row-major grid: the caret is a vertical
                                // rule between two cells, and because the nearest INSERTION
                                // SEGMENT wins (not the nearest cell centre on one axis),
                                // the end of a row and the start of the next stay distinct.
                                return UI.dropIndicator({
                                  items: cellRects,
                                  axis: "x",
                                  empty: { ...cells, w: 0 },
                                  silent: !slot.canDrop,
                                });
                              },
                            );
                            // Reorder only — `accepts` has already turned everything
                            // else away, so the item is always one of these.
                            if (slot.dropped) {
                              const { item } = slot.dropped.payload;
                              const was = invSlots.indexOf(item);
                              const next = invSlots.filter((_, i) => i !== was);
                              next.splice(was < invAt ? invAt - 1 : invAt, 0, item);
                              invSlots = next;
                            }
                          });
                        });

                        // ================= COLUMN 5 : Layout & regions =================
                        // The clipped scrollbar viewport intentionally uses a fixed
                        // region. The flow-cursor and spacer demos are ordinary auto-flowing
                        // panels, so their height comes from their children.
                        UI.col({ id: uiId("col5"), stretchCross: true }, () => {
                          // UI.flow — the low-level layout cursor (what row/col use inside).
                          // Here one cursor lays the label and two auto-width buttons out
                          // in sequence, so its finished extent is the panel's content.
                          UI.panel({ title: "Flow cursor (toolbar)" }, (body) => {
                            const origin = body.extent;
                            const bar = UI.flow({
                              x: origin.x,
                              y: origin.y,
                              dir: "row",
                              gap: th.spacing.md,
                            });
                            UI.text("History", { at: bar, color: "dim" });
                            if (
                              UI.button({
                                at: bar,
                                id: uiId("st-redo"),
                                label: "Redo",
                              })
                            )
                              UI.floatText(
                                "redo",
                                bar.last?.x ?? origin.x,
                                bar.last?.y ?? origin.y,
                              );
                            if (
                              UI.button({
                                at: bar,
                                id: uiId("st-undo"),
                                label: "Undo",
                              })
                            )
                              UI.floatText(
                                "undo",
                                bar.last?.x ?? origin.x,
                                bar.last?.y ?? origin.y,
                              );
                            // `UI.flow` is an independent low-level cursor, so its
                            // buttons do not automatically contribute to the panel
                            // body's extent. Include the finished toolbar explicitly;
                            // the panel can then grow to contain it.
                            body.include(bar.extent);
                          });

                          // UI.spacer — a fixed gap inserted before the next child; sized from
                          // the row cursor's `remaining` space, it pushes the button flush to
                          // the right edge (a manual alternative to a flex spacer).
                          UI.panel({ title: "Spacer (align right)" }, () => {
                            UI.row((rst) => {
                              UI.text("v1.4.2", { color: "dim" });
                              // The spacer has to know the button's width before the
                              // button exists, and `76` was a guess that only suited the
                              // default theme — a skin with wide decorative end caps got
                              // its label squeezed between them. `buttonWidth` asks the
                              // theme what this label will actually measure.
                              const saveW = UI.buttonWidth("Save");
                              UI.spacer(Math.max(0, rst.remaining - saveW));
                              if (
                                UI.button({
                                  id: uiId("sp-save"),
                                  label: "Save",
                                  variant: "primary",
                                })
                              )
                                UI.floatText("saved", UI.lastRect()?.x ?? 0, UI.lastRect()?.y ?? 0);
                            });
                          });

                          // UI.clip + UI.scrollbar — a clipped viewport masks tall content
                          // (drawn at a scrolled offset), and an EXPLICIT scrollbar bound to
                          // the content/view extents drives that offset (thumb, track and
                          // wheel). Distinct from the implicit overflow:"auto" columns above.
                          UI.panel({ title: "Clip + scrollbar" }, (body) => {
                            // The viewport is the panel's own body slot, minus a gutter
                            // for the scrollbar beside it. Hand-positioning it from
                            // `clipBox.y + 40` put the first credit line under any skin
                            // whose title strip reaches further down than the default
                            // theme's — how far that is belongs to the theme (frame
                            // inset + `panel.title.height`), not to this sample.
                            const area = body.next(undefined, 168);
                            // Same gutter the implicit `overflow: "auto"` containers take
                            // out of their own width, from the same theme tokens — a skin
                            // with a wide scrollbar rail widens both together.
                            const th = UI.getTheme();
                            const gutter = th.scrollbarW + th.scrollbarGap;
                            const vpRect: Rect = {
                              ...area,
                              w: area.w - gutter,
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
                              x: vpRect.x + vpRect.w + th.scrollbarGap,
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
                      },
                    );
                  },
                );

                // Drag preview: a chip trailing the pointer, above the flowing board.
                // The pointer arrives in screen coords, so bring it into the block's
                // units — then the chip is written at its natural size and zooms too.
                const dragged = UI.draggedItem<DragItem>();
                if (dragged) {
                  const at = UI.fromScreen(Pointer.x + 8, Pointer.y + 8);
                  // The chip is the theme's own surface with an accent ring, NOT a
                  // solid accent fill: `accent` is a light gold in most of these packs,
                  // so the label had to be dark to read on it — and "dark" resolved to
                  // `bgActive`, which is near-black under half of them. Panel
                  // background + `text` is the one pairing every theme guarantees.
                  Draw.rect(at.x, at.y, 96, 26, th.panel.background);
                  Draw.rectStroke(at.x, at.y, 96, 26, th.accent, 2);
                  UI.text(dragged.payload.item, {
                    ...at,
                    w: 96,
                    h: 26,
                    align: "center",
                    color: th.text,
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
                  {
                    x: popoverAt.x,
                    y: popoverAt.y + 6,
                    title: "Popover",
                    open: popoverOpen,
                  },
                  () => {
                    UI.text("A floating anchored panel.", {
                      color: "dim",
                      size: 12,
                      wrap: true,
                    });
                    if (UI.button({ id: uiId("pop-close"), label: "Close" })) popClose = true;
                  },
                );
                if (popClose) popoverOpen = false;

                // Modal — the CHILDREN form: dim + centered panel whose contents lay
                // themselves out and whose height shrink-wraps them (no `h`, no rect math).
                if (modalOpen) {
                  UI.modal({ title: "Modal", id: uiId("modal") }, () => {
                    UI.text("A centered dialog over a dimmed backdrop.", {
                      wrap: true,
                    });
                    // `justify: "end"` measures the content run from the container's
                    // cache, so the row needs an id to right-align from the first frame.
                    UI.row({ justify: "end", id: uiId("modal-actions") }, () => {
                      if (
                        UI.button({
                          id: uiId("modal-ok"),
                          label: "Got it",
                          variant: "primary",
                        })
                      )
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
                    lines: [
                      "Welcome to the UI gallery.",
                      "Every primitive here is immediate-mode.",
                    ],
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
                      Draw.text(String(index + 1), {
                        x: x + 2,
                        y: y + 2,
                        size: 8,
                        color: overlayColor,
                      });
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
                      tipX = Math.max(
                        viewport.x + 4,
                        Math.min(tipX, viewport.x + viewport.w - tipW - 4),
                      );
                      tipY = Math.max(
                        viewport.y + 4,
                        Math.min(tipY, viewport.y + viewport.h - tipH - 4),
                      );
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
          },
        );
      },
    );

    // Floating texts, then tooltips — on the very top, and OUTSIDE the block:
    // these paint things spawned/requested earlier, each of which captured the
    // scale it was created at. Inside the block they'd be scaled twice.
    UI.drawFloatText();
    UI.drawTips();

    // The layout-box overlay, last and also outside the block: it draws from
    // each entry's `screenRect`, which already has the scale baked in, so
    // inside the block every box would land at scale².
    if (layoutDebug) UI.drawLayoutOverlay({ dim: 0.12 });
  },
});
