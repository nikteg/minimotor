// UI Gallery — every immediate-mode UI primitive on one screen.
//
// A component storyboard: buttons (all variants), toggles, sliders, a select,
// a text input, tabs, a progress bar + spinner, a windowed list, a sortable
// table, drag & drop, an inventory grid, a stack-cursor toolbar, a clipped
// region with an explicit scrollbar, and the overlays (popover / modal /
// dialog / confirm).
//
// The engine calls UI.begin() for us each frame; every widget is drawn inside
// draw(). Interactive state lives in module-level `let`s: each widget takes the
// current value in and returns the (possibly changed) value, which we store
// straight back — the immediate-mode round-trip.
import { Draw, Loop, Pointer, Stage, UI } from "minimotor";
import type { TableSort, Theme } from "minimotor";

// No letterbox `resolution`: rendering at native scale keeps text crisp on
// high-DPI (Retina) screens — a fractional letterbox factor softens glyphs.
// We keep the live viewport handle and read `view.w`/`view.h` fresh each frame
// so the column layout can REFLOW to the window width instead of scaling.
const view = Stage.init("game", { background: "#12141c" });

// ---- interactive state (the round-trip target for each widget) ----
let tab = 0; // UI.tabs active index
let sound = true; // UI.toggle
let reducedMotion = false; // UI.toggle (cosmetic preference — pure state round-trip)
let disabledToggle = false; // UI.toggle (disabled demo)
let volume = 65; // UI.slider (0..100)
let zoom = 1.5; // UI.slider (0.5..3, stepped)
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

// overlays — which one is open
let popoverOpen = false;
let modalOpen = false;
let confirmOpen = false;
let dialogOpen = false;

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
const themePresets: { label: string; value: string; preset: Partial<Theme> }[] = [
  // Classic terminal: monospace, square corners (the engine default).
  { label: "Teal", value: "teal", preset: { radius: 0, borderWidth: 2, font: "monospace" } },
  {
    // Soft & rounded, thin borders, humanist sans.
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
    // Bold & blocky: square corners, heavy borders.
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
    // Friendly rounded sans.
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
    // Pill-shaped, serif — an editorial look.
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
    // Light mode, rounded, sans.
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
      panelBg: "rgba(244,247,250,0.96)",
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
let currentTheme = "teal"; // drives the Theme select; re-applied on change

const uiId = UI.ids("ui-gallery");

// ---- static demo data ----
const listItems = ["Fireball", "Ice Shard", "Lightning", "Heal", "Shield", "Teleport", "Meteor"];
const tabPages = ["Overview", "Stats", "Log"];
// 4×2 inventory for UI.grid.
const invItems = ["⚔️", "🛡️", "🧪", "🔥", "❄️", "⚡", "💎", "🗝️"];
// Tall content for the clipped, explicitly-scrolled region (UI.clip + scrollbar).
const creditLines = [
  "— CREDITS —",
  "Engine .......... minimotor",
  "Design .......... you",
  "Code ............ you",
  "Art ............. also you",
  "Audio ........... Web Audio",
  "Playtesting ..... the cat",
  "Coffee .......... a lot",
  "Bugs ............ a few",
  "Fixes ........... eventually",
  "Special thanks .. immediate mode",
  "— fin —",
];

interface Player {
  name: string;
  score: number;
  kd: number;
}
const players: Player[] = [
  { name: "Nova", score: 2480, kd: 2.4 },
  { name: "Pixel", score: 1930, kd: 1.8 },
  { name: "Ghost", score: 3110, kd: 3.1 },
  { name: "Ember", score: 870, kd: 0.9 },
  { name: "Quartz", score: 2050, kd: 1.5 },
  { name: "Vortex", score: 1420, kd: 1.2 },
];

// A tidy rect type for the panels we position by hand.
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

Loop.run({
  update() {
    // No simulation — the gallery is drawn entirely from widget state.
  },

  draw() {
    // Header (Draw.* draws in ambient/screen space, above the panels).
    Draw.text("UI GALLERY", {
      x: 24,
      y: 16,
      size: 22,
      color: "#e7ecf0",
      font: "bold 22px monospace",
    });
    Draw.text("every immediate-mode primitive on one screen", {
      x: 24,
      y: 44,
      size: 12,
      color: "#8b94a0",
    });

    // ---- responsive, scrollable board ----
    // A wrapping row of flowing columns inside a viewport-tall SCROLL column, so
    // the whole board pans as one on small screens (wheel / thumb / swipe).
    // `wrap: true` breaks the ~300px columns onto a new line when the window is
    // too narrow (each new line clears the previous line's tallest column, so
    // nothing overlaps), and each column AUTO-SIZES its height from its children.
    // `idScope` gives the nested containers stable cache ids.
    const baseX = 24;
    const baseY = 64;
    const colW = 300;
    const th = UI.getTheme(); // drag & drop bins/preview paint from the live theme
    let popoverAnchor: Rect = { x: baseX, y: baseY, w: 0, h: 0 };
    UI.idScope("panels", () => {
      UI.col(
        {
          x: baseX,
          y: baseY,
          w: view.w - baseX * 2,
          h: view.h - baseY - 12,
          overflow: "auto",
          pad: 0,
          gap: 0,
          id: uiId("scroll"),
        },
        () => {
          UI.row({ w: view.w - baseX * 2 - 14, gap: 16, wrap: true, id: uiId("board") }, () => {
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
                  options: themePresets.map((t) => ({ label: t.label, value: t.value })),
                  ariaLabel: "Theme",
                });
                if (themeSel.changed) {
                  currentTheme = themeSel.value;
                  const chosen = themePresets.find((t) => t.value === currentTheme);
                  UI.setTheme(chosen ? chosen.preset : {});
                }
              });

              // Buttons — every variant, two per row so the row fits the column.
              UI.panel({ title: "Buttons", gap: 8 }, () => {
                UI.row({ gap: 8 }, () => {
                  if (UI.button({ id: uiId("btn-default"), label: "Default" }))
                    UI.floatText("clicked", 120, 120);
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
              UI.panel({ title: "Tabs", gap: 10 }, () => {
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
              });

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
                UI.row({ h: 16 }, (st) => {
                  const r = st.next(220, 12);
                  UI.bar({ x: r.x, y: r.y, w: 220, h: 12, value: progress });
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
                  popoverAnchor = st.last ?? popoverAnchor;
                  if (UI.button({ id: uiId("open-modal"), label: "Modal" })) modalOpen = true;
                });
                UI.row({ gap: 8 }, () => {
                  if (UI.button({ id: uiId("open-dialog"), label: "Dialog" })) dialogOpen = true;
                  if (UI.button({ id: uiId("open-confirm"), label: "Confirm", variant: "danger" }))
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
              UI.panel({ ...listBox, title: "List" }, () => {
                const listArea: Rect = {
                  x: listBox.x + 10,
                  y: listBox.y + 40,
                  w: listBox.w - 20,
                  h: listBox.h - 50,
                };
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
                    if (UI.listItem({ id: uiId(`li-${i}`), ...rect, selected: i === selectedItem }))
                      selectedItem = i;
                    UI.text(listItems[i], { x: rect.x + 10, y: rect.y, h: rect.h });
                  },
                );
              });

              const tableBox = st.next(colW, 232);
              UI.panel({ ...tableBox, title: "Table" }, () => {
                const res = UI.table<Player>({
                  x: tableBox.x + 10,
                  y: tableBox.y + 40,
                  w: tableBox.w - 20,
                  h: tableBox.h - 50,
                  rowH: 26,
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
                      width: 60,
                      align: "right",
                      value: (p) => p.score,
                    },
                    {
                      key: "kd",
                      label: "K/D",
                      width: 48,
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
            // Bins/items are raw Draw.rect fills painted from the live theme (a
            // light theme would otherwise show hardcoded dark boxes).
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
                  Draw.rect(bx, binTop, binW, binH, target.canDrop ? th.bgHover : th.bgActive);
                  UI.text(bin.title, {
                    x: bx + 8,
                    y: binTop + 6,
                    size: 11,
                    bold: true,
                    color: "accent",
                  });
                  bin.items.forEach((item, ii) => {
                    const iy = binTop + 26 + ii * 30;
                    const src = UI.dragSource({
                      id: `item:${bin.id}:${item}`,
                      x: bx + 6,
                      y: iy,
                      w: binW - 12,
                      h: 26,
                      payload: { item, from: bin.id },
                    });
                    // The dragged item follows the pointer; draw its origin dimmed.
                    const dragging = src.dragging;
                    Draw.rect(bx + 6, iy, binW - 12, 26, dragging ? th.bgActive : th.bg);
                    UI.text(item, {
                      x: bx + 14,
                      y: iy,
                      h: 26,
                      color: dragging ? "dim" : undefined,
                    });
                  });
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
            // Grid, an explicit stack cursor, spacer alignment, and a clipped
            // region driven by an explicit scrollbar — all raw-rect widgets, so
            // reserve fixed slots from the flowing column and hand each its rect.
            UI.col({ w: colW, gap: 16, id: uiId("col5") }, (st) => {
              // UI.grid — even 2-D cells; here a 4×2 emoji inventory. listItem
              // paints each cell's hover/selected state; a click selects it.
              const gridBox = st.next(colW, 150);
              UI.panel({ ...gridBox, title: "Grid (inventory)" }, () => {
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
              });

              // UI.flow — the low-level layout cursor (what row/col use inside).
              // Here an `align: "end"` cursor lays two auto-width buttons out
              // right-to-left for a right-anchored toolbar.
              const barBox = st.next(colW, 80);
              UI.panel({ ...barBox, title: "Flow cursor (toolbar)" }, () => {
                UI.text("History", { x: barBox.x + 12, y: barBox.y + 40, h: 30, color: "dim" });
                const bar = UI.flow({
                  x: barBox.x + barBox.w - 12,
                  y: barBox.y + 40,
                  dir: "row",
                  align: "end",
                  gap: 8,
                });
                if (UI.button({ at: bar, id: uiId("st-redo"), label: "Redo" }))
                  UI.floatText("redo", barBox.x + barBox.w - 40, barBox.y + 40);
                if (UI.button({ at: bar, id: uiId("st-undo"), label: "Undo" }))
                  UI.floatText("undo", barBox.x + barBox.w - 100, barBox.y + 40);
              });

              // UI.spacer — a fixed gap inserted before the next child; sized from
              // the row cursor's `remaining` space, it pushes the button flush to
              // the right edge (a manual alternative to a flex spacer).
              const spBox = st.next(colW, 80);
              UI.panel({ ...spBox, title: "Spacer (align right)" }, () => {
                UI.row({ x: spBox.x + 12, y: spBox.y + 40, w: spBox.w - 24, h: 30 }, (rst) => {
                  UI.text("v1.4.2", { color: "dim", h: 30 });
                  UI.spacer(Math.max(0, rst.remaining - 76));
                  if (UI.button({ id: uiId("sp-save"), label: "Save", w: 76, variant: "primary" }))
                    UI.floatText("saved", spBox.x + spBox.w - 40, spBox.y + 40);
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
    });

    // Drag preview: a chip trailing the pointer, above the flowing board.
    const dragged = UI.draggedItem<{ item: string; from: string }>();
    if (dragged) {
      Draw.rect(Pointer.x + 8, Pointer.y + 8, 90, 24, th.accent);
      UI.text(dragged.payload.item, {
        x: Pointer.x + 8,
        y: Pointer.y + 8,
        w: 90,
        h: 24,
        align: "center",
        color: th.bgActive,
      });
    }

    // ================= OVERLAYS — drawn LAST so they sit on top and
    //                   deaden the widgets behind them =================

    // Popover anchored beneath its trigger button — the CHILDREN form, so the
    // box auto-sizes to its content (no manual height). A close button inside
    // can't override the returned open-state, so it sets a flag we apply after.
    let popClose = false;
    popoverOpen = UI.popover(
      {
        x: popoverAnchor.x,
        y: popoverAnchor.y + popoverAnchor.h + 6,
        w: 220,
        title: "Popover",
        open: popoverOpen,
      },
      () => {
        UI.text("A floating anchored panel.", { color: "dim", size: 12, wrap: true, w: 196 });
        if (UI.button({ id: uiId("pop-close"), label: "Close" })) popClose = true;
      },
    );
    if (popClose) popoverOpen = false;

    // Modal: dim + centered panel; draw contents into the returned rect.
    if (modalOpen) {
      const r = UI.modal({ w: 340, h: 160, title: "Modal" });
      UI.text("A centered dialog over a dimmed backdrop.", {
        x: r.x + 16,
        y: r.y + 48,
        w: r.w - 32,
        wrap: true,
        h: 40,
      });
      if (
        UI.button({
          id: uiId("modal-ok"),
          label: "Got it",
          variant: "primary",
          x: r.x + r.w - 108,
          y: r.y + r.h - 46,
          w: 96,
        })
      )
        modalOpen = false;
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

    // Floating combat/score texts, then tooltips — always on the very top.
    UI.drawFloatText();
    UI.drawTips();
  },
});
