// A full GUI screen built from the immediate-mode UI kit — the kind of menu a
// multiplayer game puts in front of Net.connect. Everything redraws every
// frame; there is no widget tree and no DOM.
// Demonstrates: UI.panel / tabs / toggle / row / scrollbar (wheel + thumb
// drag + track paging via Pointer.wheel/framePressed) / button (incl.
// disabled) / float, plus Clock.after driving a fake refresh and join.
// The server list is mock data — swap fetchServers() for a real request.
import { Minimotor } from "minimotor";

const { Keys, Mathf, Clock, UI } = Minimotor;

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));

// ---- mock data -------------------------------------------------------------

const ADJ = ["Neon", "Rusty", "Turbo", "Cozy", "Midnight", "Pixel", "Mega", "Sneaky"];
const NOUN = ["Arena", "Garage", "Basement", "Castle", "Speedway", "Lounge", "Fortress", "Attic"];
const MODES = ["Coop", "PvP", "Race"];
const REGIONS = ["EU", "NA", "AS", "SA"];

function fetchServers() {
  // Stand-in for a master-server request.
  const list = [];
  for (let i = 0; i < 42; i++) {
    const max = Mathf.randItem([4, 8, 12, 16]);
    list.push({
      name: `${Mathf.randItem(ADJ)} ${Mathf.randItem(NOUN)} #${Mathf.randInt(1, 99)}`,
      mode: Mathf.randItem(MODES),
      region: Mathf.randItem(REGIONS),
      players: Mathf.randInt(0, max),
      max,
      ping: Mathf.randInt(9, 240),
    });
  }
  return list;
}

let servers = fetchServers();

// ---- GUI state -------------------------------------------------------------

let tab = 0; // 0 = All, then MODES
let hideFull = false;
let hideEmpty = false;
let maxPing = 250; // 250 = no limit
let search = "";
let region = "ALL";
let sort = { key: "ping", dir: 1 }; // UI.table sort state (column key + direction)
let scroll = 0;
let selected = null; // a server object (survives re-sorting), not an index
let refreshing = false;
let status = "";
let filtersOpen = false; // the FILTERS popover
let confirming = null; // server awaiting the join-confirm modal
let altTheme = false;
const uiId = UI.ids("server-browser");

// A second look for the whole kit — one setTheme call restyles every widget.
// Also shows off the metric knobs: rounded corners and a thicker border.
const AMBER = {
  font: "Verdana, sans-serif",
  fontSize: 12,
  accent: "#ffb454",
  accentSoft: "#9a6b2f",
  text: "#f4ecd8",
  textDim: "#a08e6e",
  bg: "#3a2f1d",
  bgHover: "#4a3c24",
  bgActive: "#2a2214",
  border: "#5a4a2e",
  panelBg: "rgba(24,18,8,0.94)",
  primary: "#ffb454",
  danger: "#e8663d",
  radius: 8,
  borderWidth: 3,
};

function visibleServers() {
  let list = servers;
  if (tab > 0) list = list.filter((s) => s.mode === MODES[tab - 1]);
  if (hideFull) list = list.filter((s) => s.players < s.max);
  if (hideEmpty) list = list.filter((s) => s.players > 0);
  if (maxPing < 250) list = list.filter((s) => s.ping <= maxPing);
  if (region !== "ALL") list = list.filter((s) => s.region === region);
  if (search.trim()) {
    const needle = search.trim().toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(needle));
  }
  return list; // UI.table sorts by the active column
}

function refresh() {
  if (refreshing) return;
  refreshing = true;
  status = "";
  Clock.after(700, () => {
    servers = fetchServers();
    selected = null;
    refreshing = false;
  });
}

function join(server) {
  status = `Connecting to ${server.name}…`;
  Clock.after(900, () => {
    status = Math.random() < 0.8 ? `Connected to ${server.name}!` : "Connection failed (mock)";
  });
}

// ---- layout ----------------------------------------------------------------

const ROW_H = 30;

// Recomputed every frame from the live viewport, so resize comes free. The
// structure is expressed with the callback layout API: a column below the
// panel's 30px title strip hands out controls / headers / list / footer, the
// list `fill`s the leftover height, and the header is a nested row whose NAME
// column fills while the rest are fixed. No arithmetic, no flex spec.
const FOOTER_H = 40;

function layout() {
  const w = Math.max(560, Math.min(760, vp.w - 40));
  const h = Math.max(320, Math.min(560, vp.h - 40));
  const x = Math.round((vp.w - w) / 2);
  const y = Math.round((vp.h - h) / 2);
  const L = { x, y, w, h };

  UI.col({ x, y: y + 30, w, h: h - 30, pad: 12, gap: 8 }, (body) => {
    L.controls = body.next(undefined, 30);
    // One block for UI.table: its 20px header strip + the row list, filling the
    // space above the footer (which occupies the column's bottom padding).
    L.table = body.fill(FOOTER_H + 8);
    const footer = body.next(undefined, FOOTER_H);
    // Let the footer occupy the column's bottom padding so the action row
    // visually anchors to the panel edge instead of floating above it.
    L.footer = { ...footer, y: footer.y + 8 };
  });

  return L;
}

const pingColor = (ping) => (ping < 60 ? "#6bff9e" : ping < 130 ? "#ffd43b" : "#ff6b6b");

Minimotor.Loop.run({
  update() {
    if (Keys.pressed("KeyR")) refresh();
    if (Keys.pressed("Escape")) {
      confirming = null;
      filtersOpen = false;
    }
  },

  draw(ctx) {
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, vp.w, vp.h);

    const L = layout();
    UI.panel({ x: L.x, y: L.y, w: L.w, h: L.h, title: "SERVER BROWSER" });

    // ---- control bar: two closure rows over the same slot — the left one
    // flows from the left, the right one (align:"end") grows from the right.
    // Widgets inside auto-flow and auto-size; no rects threaded by hand.
    const nFilters = (hideFull ? 1 : 0) + (hideEmpty ? 1 : 0) + (maxPing < 250 ? 1 : 0) + (search ? 1 : 0) + (region !== "ALL" ? 1 : 0);
    let filterBtn;
    UI.row({ ...L.controls, gap: 10 }, (bar) => {
      tab = UI.tabs({ id: uiId("mode-tabs"), tabIndex: 10, items: ["All", ...MODES], active: tab });
      if (
        UI.button({
          id: uiId("filters-button"),
          tabIndex: 20,
          label: `FILTERS${nFilters ? ` (${nFilters})` : ""}`,
          tooltip: "Hide full/empty servers, cap the ping",
        })
      ) {
        filtersOpen = !filtersOpen;
      }
      filterBtn = bar.last; // the popover anchors under this
    });

    UI.row({ ...L.controls, gap: 10, align: "end" }, (bar) => {
      if (
        UI.button({
          id: uiId("refresh-button"),
          tabIndex: 40,
          label: refreshing ? "…" : "REFRESH",
          disabled: refreshing,
          tooltip: "Re-query the master server (R)",
        })
      ) {
        refresh();
      }
      if (
        UI.button({
          id: uiId("theme-button"),
          tabIndex: 30,
          label: "THEME",
          tooltip: "Swap the whole UI kit's theme",
        })
      ) {
        altTheme = !altTheme;
        UI.setTheme(altTheme ? AMBER : {});
      }
      // Busy arc while the mock request is in flight, left of the buttons.
      if (refreshing) UI.spinner(bar.extent.x - 18, L.controls.y + 15);
    });

    // ---- the server table: sortable headers over a windowed, selectable row
    // list, all in one call. UI.table sorts the filtered rows by the active
    // column, owns the scroll + selection, and reports the state back.
    const list = visibleServers();
    const res = UI.table({
      ...L.table,
      rowH: ROW_H,
      headerH: 20,
      id: uiId("servers"),
      rows: list,
      sort,
      offset: scroll,
      selected, // an open popover blocks row clicks automatically
      columns: [
        {
          key: "name",
          label: "NAME",
          value: (s) => s.name,
          cell: (s, r) => UI.text(s.name, { x: r.x + 4, y: r.y, w: r.w - 14, h: r.h }),
        },
        {
          key: "mode",
          label: "MODE",
          width: 70,
          value: (s) => s.mode,
          cell: (s, r) => UI.text(s.mode, { ...r, color: "dim" }),
        },
        {
          key: "region",
          label: "REG",
          width: 56,
          value: (s) => s.region,
          cell: (s, r) => UI.text(s.region, { ...r, color: "dim" }),
        },
        {
          key: "players",
          label: "PLAYERS",
          width: 80,
          value: (s) => s.players,
          cell: (s, r) =>
            UI.text(`${s.players}/${s.max}`, { ...r, color: s.players >= s.max ? "#ff6b6b" : "dim" }),
        },
        {
          key: "ping",
          label: "PING",
          width: 74,
          value: (s) => s.ping,
          cell: (s, r) => UI.text(`${s.ping}`, { ...r, color: pingColor(s.ping) }),
        },
      ],
    });
    sort = res.sort;
    scroll = res.offset;
    selected = res.selected;
    if (list.length === 0) {
      UI.text("no servers match the filters", {
        x: L.table.x,
        y: L.table.y + 44,
        w: L.table.w,
        align: "center",
        color: "dim",
      });
    }

    // ---- footer: count, status, JOIN ----
    // The join status takes the counter's spot while it's showing.
    const footerTextH = 18;
    const footText = {
      x: L.footer.x,
      y: L.y + L.h - 8 - footerTextH,
      w: L.footer.w - 130,
      h: footerTextH,
      size: 12,
    };
    if (status) {
      UI.text(status, { ...footText, color: status.startsWith("Connected") ? "#6bff9e" : "#ffd43b" });
    } else {
      UI.text(`${list.length}/${servers.length} servers · R to refresh`, {
        ...footText,
        color: "dim",
      });
    }
    const footBtns = UI.stack({
      x: L.footer.x + L.footer.w,
      y: L.footer.y + (L.footer.h - 34) / 2,
      h: 34,
      align: "end",
    });
    if (
      UI.button({
        at: footBtns,
        id: uiId("join-button"),
        tabIndex: 50,
        label: "JOIN",
        variant: "primary", // the call to action
        disabled: !selected || refreshing,
        tooltip: selected ? `Join ${selected.name}` : "Select a server first",
      })
    ) {
      confirming = selected;
    }

    // ---- the filters popover, floating over the list ----
    const pop = { x: filterBtn.x, y: filterBtn.y + 36, w: 300, h: 250, title: "FILTERS" };
    filtersOpen = UI.popover({ ...pop, open: filtersOpen });
    if (filtersOpen) {
      UI.idScope("server-browser:filters", () => {
        UI.col({ x: pop.x + 14, y: pop.y + 38, w: pop.w - 28, h: pop.h - 50, gap: 8 }, () => {
        search = UI.textInput({
          tabIndex: 10,
          value: search,
          h: 30,
          placeholder: "Search server names…",
          ariaLabel: "Search servers",
        }).value;
        region = UI.select({
          tabIndex: 20,
          value: region,
          h: 30,
          maxVisible: 4,
          options: ["ALL", ...REGIONS].map((value) => ({
            label: value === "ALL" ? "All regions" : value,
            value,
          })),
          ariaLabel: "Server region",
        }).value;
        UI.row({ h: 30, gap: 24 }, () => {
          hideFull = UI.toggle({
            tabIndex: 30,
            label: "Hide full",
            on: hideFull,
          });
          hideEmpty = UI.toggle({
            tabIndex: 40,
            label: "Hide empty",
            on: hideEmpty,
          });
        });
        maxPing = UI.slider({
          tabIndex: 50,
          w: 180,
          min: 20,
          max: 250,
          step: 10,
          value: maxPing,
          label: "ping",
          format: (v) => (v >= 250 ? "any" : `≤${v}`),
          });
        });
      });
    }

    // ---- join confirmation: one declarative call — sized to its content,
    // blocks everything behind it, returns the clicked button.
    if (confirming) {
      const hit = UI.confirm({
        title: "JOIN SERVER",
        lines: [
          confirming.name,
          `${confirming.mode} · ${confirming.region} · ${confirming.players}/${confirming.max} players · ${confirming.ping}ms`,
        ],
        buttons: ["CANCEL", "JOIN"],
      });
      if (hit === "JOIN") join(confirming);
      if (hit) confirming = null;
    }

    UI.drawFloats();
    UI.drawTips(); // tooltips on the very top
  },
});
