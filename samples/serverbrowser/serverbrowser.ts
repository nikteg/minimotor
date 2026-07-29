// A full GUI screen built from the immediate-mode UI kit — the kind of menu a
// multiplayer game puts in front of Net.connect. Everything redraws every
// frame; there is no widget tree and no DOM.
// Demonstrates: UI.panel / tabs / toggle / row / scrollbar (wheel + thumb
// drag + track paging via Pointer.wheel/framePressed) / button (incl.
// disabled) / float, plus Clock.ui.after driving a fake refresh and join.
// The server list is mock data — swap fetchServers() for a real request.
import { Clock, Keys, Loop, Mathf, Perf, App, UI } from "minimotor";
import type { TableSort, Theme } from "minimotor";
import "../shared/layout-probe.ts"; // e2e layout-invariant hook (window.__uiProbe)

interface Server {
  name: string;
  mode: string;
  region: string;
  players: number;
  max: number;
  ping: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The stage viewport is LIVE (mutated on resize); the UI.panel self-centers in it
// via anchor:"center", so no viewport handle is needed here.
App.init("game", {
  background: "#0b0e14",
  plugins: [Perf.plugin()],
  preventNavigation: true,
});

// ---- mock data -------------------------------------------------------------

const ADJ = ["Neon", "Rusty", "Turbo", "Cozy", "Midnight", "Pixel", "Mega", "Sneaky"];
const NOUN = ["Arena", "Garage", "Basement", "Castle", "Speedway", "Lounge", "Fortress", "Attic"];
const MODES = ["Coop", "PvP", "Race"];
const REGIONS = ["EU", "NA", "AS", "SA"];

function fetchServers(): Server[] {
  // Stand-in for a master-server request.
  const list: Server[] = [];
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
let sort: TableSort = { key: "ping", dir: 1 }; // UI.table sort state (column key + direction)
let scroll = 0;
let selected: Server | null = null; // a server object (survives re-sorting), not an index
let refreshing = false;
let status = "";
let filtersOpen = false; // the FILTERS popover
let confirming: Server | null = null; // server awaiting the join-confirm modal
let altTheme = false;
const uiId = UI.ids("server-browser");

// A second look for the whole kit — one setTheme call restyles every widget.
// Also shows off the metric knobs: rounded corners and a thicker border.
const AMBER: Partial<Theme> = {
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

function visibleServers(): Server[] {
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
  Clock.ui.after(700, () => {
    servers = fetchServers();
    selected = null;
    refreshing = false;
  });
}

function join(server: Server) {
  status = `Connecting to ${server.name}…`;
  Clock.ui.after(900, () => {
    status = Math.random() < 0.8 ? `Connected to ${server.name}!` : "Connection failed (mock)";
  });
}

// ---- layout ----------------------------------------------------------------

const ROW_H = 30;

const FOOTER_H = 40;

const pingColor = (ping: number) => (ping < 60 ? "#6bff9e" : ping < 130 ? "#ffd43b" : "#ff6b6b");

Loop.run({
  update() {
    if (Keys.pressed("KeyR")) refresh();
    if (Keys.pressed("Escape")) {
      confirming = null;
      filtersOpen = false;
    }
  },

  draw() {
    const nFilters =
      (hideFull ? 1 : 0) +
      (hideEmpty ? 1 : 0) +
      (maxPing < 250 ? 1 : 0) +
      (search ? 1 : 0) +
      (region !== "ALL" ? 1 : 0);
    let filterBtn: Rect = { x: 0, y: 0, w: 0, h: 0 };

    // The whole frame is a titled UI.panel, self-centered in the viewport (no
    // hand-rolled rect): 760×560 preferred, clamped to the viewport minus a 12px
    // margin. Its body cursor carves the control bar; the table AUTO-FLOWS to
    // fill the rest (reserving the footer), and the footer takes the last slot.
    UI.panel(
      {
        id: uiId("frame"),
        anchor: "center",
        w: 760,
        h: 560,
        margin: 12,
        title: "SERVER BROWSER",
        pad: 12,
        gap: 8,
      },
      (body) => {
        const controls = body.next(undefined, 30);

        // Two closure rows over the same control slot: the left one flows from
        // the left, the right one (justify:"end", reverse:true) grows from the right.
        UI.row({ ...controls, gap: 10 }, (bar) => {
          tab = UI.tabs({
            id: uiId("mode-tabs"),
            tabIndex: 10,
            items: ["All", ...MODES],
            active: tab,
          });
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
          filterBtn = bar.last ?? filterBtn; // the popover anchors under this
        });

        UI.row({ ...controls, gap: 10, justify: "end", reverse: true }, (bar) => {
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
          if (refreshing) UI.spinner({ x: bar.extent.x - 18, y: controls.y + 15 });
        });

        // ---- the server table: sortable headers over a windowed, selectable row
        // list, all in one call. UI.table sorts the filtered rows by the active
        // column, owns the scroll + selection, and reports the state back.
        const list = visibleServers();
        // Auto-flows: fills the panel body below the controls, leaving the footer
        // slot (FOOTER_H + 8) for the row after it. No rect passed in.
        const res = UI.table<Server>({
          reserve: FOOTER_H + 8,
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
                UI.text(`${s.players}/${s.max}`, {
                  ...r,
                  color: s.players >= s.max ? "#ff6b6b" : "dim",
                }),
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
            x: res.rect.x,
            y: res.rect.y + 44,
            w: res.rect.w,
            align: "center",
            color: "dim",
          });
        }

        // ---- footer: count, status, JOIN — the last body slot ----
        const footSlot = body.next(undefined, FOOTER_H);
        const footer = { ...footSlot, y: footSlot.y + 8 };
        // The join status takes the counter's spot while it's showing.
        const footerTextH = 18;
        const footText = {
          x: footer.x,
          y: footer.y + (footer.h - footerTextH) / 2,
          w: footer.w - 130,
          h: footerTextH,
          size: 12,
        };
        if (status) {
          UI.text(status, {
            ...footText,
            color: status.startsWith("Connected") ? "#6bff9e" : "#ffd43b",
          });
        } else {
          UI.text(`${list.length}/${servers.length} servers · R to refresh`, {
            ...footText,
            color: "dim",
          });
        }
        const footBtns = UI.flow({
          x: footer.x + footer.w,
          y: footer.y + (footer.h - 34) / 2,
          h: 34,
          align: "end",
        });
        if (
          UI.button({
            at: footBtns,
            // tabIndex 0 (not a positive value): positive tab stops sort BEFORE the
            // tabIndex-0 rows, which would put JOIN ahead of the list. At 0 it joins
            // the document-order group and — drawn after the list — lands right
            // AFTER the rows, so forward-Tab down the list reaches it.
            id: uiId("join-button"),
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
      },
    );

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

    UI.drawFloatText();
    UI.drawTips(); // tooltips on the very top
  },
});
