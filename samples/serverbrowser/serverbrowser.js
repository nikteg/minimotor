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
let sortKey = "ping";
let sortDir = 1;
let scroll = 0;
let selected = null; // a server object (survives re-sorting), not an index
let refreshing = false;
let status = "";
let filtersOpen = false; // the FILTERS popover
let confirming = null; // server awaiting the join-confirm modal
let altTheme = false;

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
  const dir = sortDir;
  return [...list].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * dir;
  });
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

// Recomputed every frame from the live viewport, so resize comes free: the
// panel re-centers, fixed rows keep their height, the list flexes to fill.
function layout() {
  const w = Math.max(560, Math.min(760, vp.w - 40));
  const h = Math.max(320, Math.min(560, vp.h - 40));
  const x = Math.round((vp.w - w) / 2);
  const y = Math.round((vp.h - h) / 2);
  // Below the panel's 30px title strip, one flex column: controls, column
  // headers (a nested row — NAME flexes, the rest are fixed), the list
  // (rows + scrollbar side by side), footer.
  const L = UI.flex(
    { x, y: y + 30, w, h: h - 30 },
    {
      dir: "col",
      pad: 12,
      gap: 8,
      children: {
        controls: { h: 30 },
        head: {
          h: 20,
          dir: "row",
          children: {
            name: { flex: 1 },
            mode: { w: 70 },
            reg: { w: 56 },
            players: { w: 80 },
            ping: { w: 74 },
          },
        },
        list: { flex: 1, dir: "row", gap: 4, children: { rows: { flex: 1 }, scroll: { w: 10 } } },
        footer: { h: 40 },
      },
    },
  );
  return { x, y, w, h, ...L };
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
    const nFilters = (hideFull ? 1 : 0) + (hideEmpty ? 1 : 0) + (maxPing < 250 ? 1 : 0);
    let filterBtn;
    UI.row({ ...L.controls, gap: 10 }, (bar) => {
      tab = UI.tabs({ items: ["All", ...MODES], active: tab });
      if (
        UI.button({
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
          label: refreshing ? "…" : "REFRESH",
          disabled: refreshing,
          tooltip: "Re-query the master server (R)",
        })
      ) {
        refresh();
      }
      if (UI.button({ label: "THEME", tooltip: "Swap the whole UI kit's theme" })) {
        altTheme = !altTheme;
        UI.setTheme(altTheme ? AMBER : {});
      }
      // Busy arc while the mock request is in flight, left of the buttons.
      if (refreshing) UI.spinner(bar.extent.x - 18, L.controls.y + 15);
    });

    // ---- column headers (click to sort) — rects straight from the flex ----
    const list = visibleServers();
    const headers = [
      { key: "name", label: "NAME", rect: L.name },
      { key: "mode", label: "MODE", rect: L.mode },
      { key: "region", label: "REG", rect: L.reg },
      { key: "players", label: "PLAYERS", rect: L.players },
      { key: "ping", label: "PING", rect: L.ping },
    ];
    for (const hd of headers) {
      if (UI.listItem({ ...hd.rect, w: hd.rect.w - 6 })) {
        if (sortKey === hd.key) sortDir = -sortDir;
        else {
          sortKey = hd.key;
          sortDir = 1;
        }
      }
      const arrow = sortKey === hd.key ? (sortDir === 1 ? " ▲" : " ▼") : "";
      UI.text(hd.label + arrow, {
        ...hd.rect,
        size: 12,
        bold: true,
        color: sortKey === hd.key ? "accent" : "dim",
      });
    }

    // ---- the list: clipped rows + scrollbar, filling the flexed space ----
    const content = list.length * ROW_H;
    scroll = UI.scrollbar({
      x: L.scroll.x,
      y: L.scroll.y,
      h: L.scroll.h,
      view: L.list.h,
      content,
      offset: scroll,
      wheelArea: L.list,
    });

    UI.clip(L.rows, () => {
      const first = Math.floor(scroll / ROW_H);
      const last = Math.min(list.length - 1, Math.ceil((scroll + L.rows.h) / ROW_H));
      for (let i = first; i <= last; i++) {
        const s = list[i];
        const ry = L.rows.y + i * ROW_H - scroll;
        if (UI.listItem({ x: L.rows.x, y: ry, w: L.rows.w, h: ROW_H, selected: s === selected })) {
          selected = s; // an open popover blocks this automatically
        }
        UI.text(s.name, { x: L.name.x + 4, y: ry, w: L.name.w - 14, h: ROW_H });
        UI.text(s.mode, { x: L.mode.x, y: ry, h: ROW_H, color: "dim" });
        UI.text(s.region, { x: L.reg.x, y: ry, h: ROW_H, color: "dim" });
        UI.text(`${s.players}/${s.max}`, {
          x: L.players.x,
          y: ry,
          h: ROW_H,
          color: s.players >= s.max ? "#ff6b6b" : "dim",
        });
        UI.text(`${s.ping}`, { x: L.ping.x, y: ry, h: ROW_H, color: pingColor(s.ping) });
      }
      if (list.length === 0) {
        UI.text("no servers match the filters", {
          x: L.rows.x,
          y: L.rows.y + 24,
          w: L.rows.w,
          align: "center",
          color: "dim",
        });
      }
    });

    // ---- footer: count, status, JOIN ----
    // The join status takes the counter's spot while it's showing.
    const footText = { x: L.footer.x, y: L.footer.y, w: L.footer.w - 130, h: L.footer.h, size: 12 };
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
      y: L.footer.y + (L.footer.h - 34) / 2 + 2,
      h: 34,
      align: "end",
    });
    if (
      UI.button({
        at: footBtns,
        label: "JOIN",
        variant: "primary", // the call to action
        disabled: !selected || refreshing,
        tooltip: selected ? `Join ${selected.name}` : "Select a server first",
      })
    ) {
      confirming = selected;
    }

    // ---- the filters popover, floating over the list ----
    const pop = { x: filterBtn.x, y: filterBtn.y + 36, w: 300, h: 128, title: "FILTERS" };
    filtersOpen = UI.popover({ ...pop, open: filtersOpen });
    if (filtersOpen) {
      hideFull = UI.toggle({ x: pop.x + 14, y: pop.y + 44, label: "Hide full", on: hideFull });
      hideEmpty = UI.toggle({
        x: pop.x + 150,
        y: pop.y + 44,
        label: "Hide empty",
        on: hideEmpty,
      });
      maxPing = UI.slider({
        x: pop.x + 80,
        y: pop.y + 92,
        w: 130,
        min: 20,
        max: 250,
        step: 10,
        value: maxPing,
        label: "ping",
        format: (v) => (v >= 250 ? "any" : `≤${v}`),
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
