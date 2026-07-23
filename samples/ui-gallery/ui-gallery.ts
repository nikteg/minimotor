// UI Gallery — every immediate-mode UI primitive on one screen.
//
// A component storyboard: buttons (all variants), toggles, sliders, a select,
// a text input, tabs, a progress bar + spinner, a windowed list, a sortable
// table, drag & drop, and the overlays (popover / modal / dialog / confirm).
//
// The engine calls UI.begin() for us each frame; every widget is drawn inside
// draw(). Interactive state lives in module-level `let`s: each widget takes the
// current value in and returns the (possibly changed) value, which we store
// straight back — the immediate-mode round-trip.
import { Draw, Loop, Pointer, Stage, UI } from "minimotor";
import type { TableSort } from "minimotor";

Stage.init("game", { background: "#12141c" });

// ---- interactive state (the round-trip target for each widget) ----
let tab = 0; // UI.tabs active index
let sound = true; // UI.toggle
let showFps = false; // UI.toggle
let disabledToggle = false; // UI.toggle (disabled demo)
let volume = 65; // UI.slider (0..100)
let zoom = 1.5; // UI.slider (0.5..3, stepped)
let name = ""; // UI.textInput
let quality = "high"; // UI.select value
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

const uiId = UI.ids("ui-gallery");

// ---- static demo data ----
const listItems = ["Fireball", "Ice Shard", "Lightning", "Heal", "Shield", "Teleport", "Meteor"];
const tabPages = ["Overview", "Stats", "Log"];

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

  draw(ctx) {
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

    // Columns 1 & 2 FLOW inside parent columns: each group is pinned by neither
    // width nor height — it fills the column's width and AUTO-SIZES its height
    // from its children, so the sections stack with a gap and never overlap
    // (the whole point of the auto-sizing containers). `idScope` gives the
    // nested containers stable ids so their measured size caches frame-to-frame.
    let popoverAnchor: Rect = { x: 344, y: 360, w: 0, h: 0 };
    UI.idScope("panels", () => {
      // ================= COLUMN 1 =================
      UI.col({ x: 24, y: 64, w: 300, gap: 16 }, () => {
        // Buttons — every variant, two per row so the row fits the column.
        UI.group({ title: "Buttons", gap: 8 }, () => {
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

        UI.group({ title: "Toggles & Sliders", gap: 10 }, () => {
          sound = UI.toggle({ id: uiId("tg-sound"), label: "Sound enabled", on: sound });
          showFps = UI.toggle({ id: uiId("tg-fps"), label: "Show FPS", on: showFps });
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

        UI.group({ title: "Select & Text input", gap: 10 }, () => {
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
        });
      });

      // ================= COLUMN 2 =================
      UI.col({ x: 344, y: 64, w: 300, gap: 16 }, () => {
        UI.group({ title: "Tabs", gap: 10 }, () => {
          tab = UI.tabs({ id: uiId("tabs"), items: tabPages, active: tab, w: 256 });
          if (tab === 0)
            UI.text("A neutral summary of the current session.", { wrap: true, h: 40, w: 256 });
          else if (tab === 1) UI.text("Kills 42 · Deaths 17 · Assists 9", { color: "accent" });
          else
            UI.text("12:04 joined · 12:07 first blood · 12:31 win", {
              color: "dim",
              wrap: true,
              h: 40,
              w: 256,
            });
        });

        UI.group({ title: "Progress bar (UI.bar)", gap: 10 }, () => {
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
            UI.bar(r.x, r.y, 220, 12, progress);
          });
          busy = UI.toggle({ id: uiId("tg-busy"), label: "Working…", on: busy });
          UI.row({ h: 24 }, (st) => {
            const r = st.next(20, 20);
            if (busy) UI.spinner(r.x + 10, r.y + 10);
          });
        });

        UI.group({ title: "Overlays", gap: 8 }, () => {
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
      });
    });

    // ================= COLUMN 3 =================
    const col3 = 664;

    // ---- List: a windowed, scrollable, selectable list ----
    const listBox: Rect = { x: col3, y: 64, w: 250, h: 210 };
    UI.panel({ ...listBox, title: "List" });
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

    // ---- Table: sortable headers + windowed, selectable rows ----
    const tableBox: Rect = { x: col3, y: 292, w: 250, h: 232 };
    UI.panel({ ...tableBox, title: "Table" });
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
        { key: "score", label: "SCORE", width: 60, align: "right", value: (p) => p.score },
        {
          key: "kd",
          label: "K/D",
          width: 48,
          align: "right",
          value: (p) => p.kd,
          cell: (p, r) =>
            UI.text(p.kd.toFixed(1), { ...r, align: "right", color: p.kd >= 2 ? "accent" : "dim" }),
        },
      ],
    });
    tableSort = res.sort;
    tableOffset = res.offset;
    tableSel = res.selected;

    // ================= COLUMN 4 : Drag & drop =================
    const col4 = 940;
    const ddBox: Rect = { x: col4, y: 64, w: 300, h: 300 };
    UI.panel({ ...ddBox, title: "Drag & drop" });
    UI.text("Drag items between the two bins", {
      x: ddBox.x + 12,
      y: ddBox.y + 38,
      color: "dim",
      size: 12,
    });

    // Two drop-target columns; each lists its items as drag sources.
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
      Draw.rect(
        bx,
        binTop,
        binW,
        binH,
        target.canDrop ? "rgba(78,205,196,0.18)" : "rgba(255,255,255,0.04)",
      );
      UI.text(bin.title, { x: bx + 8, y: binTop + 6, size: 11, bold: true, color: "accent" });
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
        Draw.rect(bx + 6, iy, binW - 12, 26, dragging ? "rgba(255,255,255,0.06)" : "#232838");
        UI.text(item, { x: bx + 14, y: iy, h: 26, color: dragging ? "dim" : undefined });
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
    // Drag preview: a chip trailing the pointer.
    const dragged = UI.draggedItem<{ item: string; from: string }>();
    if (dragged) {
      Draw.rect(Pointer.x + 8, Pointer.y + 8, 90, 24, "#4ecdc4");
      UI.text(dragged.payload.item, {
        x: Pointer.x + 8,
        y: Pointer.y + 8,
        w: 90,
        h: 24,
        align: "center",
        color: "#06231f",
      });
    }

    // ================= OVERLAYS — drawn LAST so they sit on top and
    //                   deaden the widgets behind them =================

    // Popover anchored beneath its trigger button.
    popoverOpen = UI.popover({
      x: popoverAnchor.x,
      y: popoverAnchor.y + popoverAnchor.h + 6,
      w: 220,
      h: 96,
      title: "Popover",
      open: popoverOpen,
    });
    if (popoverOpen) {
      UI.col(
        { x: popoverAnchor.x + 12, y: popoverAnchor.y + popoverAnchor.h + 42, w: 196, gap: 8 },
        () => {
          UI.text("A floating anchored panel.", { color: "dim", size: 12 });
          if (UI.button({ id: uiId("pop-close"), label: "Close", w: 196 })) popoverOpen = false;
        },
      );
    }

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
