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
let sortKey = "ping";
let sortDir = 1;
let scroll = 0;
let selected = null; // a server object (survives re-sorting), not an index
let refreshing = false;
let spin = 0; // spinner angle while refreshing
let status = "";

function visibleServers() {
  let list = servers;
  if (tab > 0) list = list.filter((s) => s.mode === MODES[tab - 1]);
  if (hideFull) list = list.filter((s) => s.players < s.max);
  if (hideEmpty) list = list.filter((s) => s.players > 0);
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

function layout() {
  const w = Math.min(760, vp.w - 40);
  const h = Math.min(560, vp.h - 40);
  const x = (vp.w - w) / 2;
  const y = (vp.h - h) / 2;
  // Columns: name flexes, the rest are fixed.
  const cols = { mode: 70, region: 56, players: 80, ping: 60 };
  const nameW = w - 24 - cols.mode - cols.region - cols.players - cols.ping - 14;
  return { x, y, w, h, cols, nameW, listY: y + 128, listH: h - 128 - 64 };
}

const pingColor = (ping) => (ping < 60 ? "#6bff9e" : ping < 130 ? "#ffd43b" : "#ff6b6b");

Minimotor.Loop.run({
  update(stepMs) {
    if (Keys.pressed("KeyR")) refresh();
    if (refreshing) spin += stepMs * 0.012;
  },

  draw(ctx) {
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, vp.w, vp.h);

    const L = layout();
    UI.panel(ctx, { x: L.x, y: L.y, w: L.w, h: L.h, title: "SERVER BROWSER" });

    // ---- filter bar: tabs + toggles + refresh ----
    tab = UI.tabs(ctx, {
      x: L.x + 12,
      y: L.y + 42,
      w: Math.min(320, L.w - 140),
      items: ["All", ...MODES],
      active: tab,
    });
    if (
      UI.button(ctx, {
        x: L.x + L.w - 116,
        y: L.y + 42,
        w: 104,
        h: 30,
        label: refreshing ? "…" : "REFRESH",
        disabled: refreshing,
      })
    ) {
      refresh();
    }
    if (refreshing) {
      // Tiny spinner next to the button while the mock request is in flight.
      ctx.save();
      ctx.strokeStyle = "#4ecdc4";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(L.x + L.w - 134, L.y + 57, 8, spin, spin + Math.PI * 1.4);
      ctx.stroke();
      ctx.restore();
    }
    hideFull = UI.toggle(ctx, { x: L.x + 12, y: L.y + 84, label: "Hide full", on: hideFull });
    hideEmpty = UI.toggle(ctx, { x: L.x + 122, y: L.y + 84, label: "Hide empty", on: hideEmpty });

    // ---- column headers (click to sort) ----
    const list = visibleServers();
    const headY = L.listY - 22;
    const headers = [
      { key: "name", label: "NAME", x: L.x + 12, w: L.nameW },
      { key: "mode", label: "MODE", x: L.x + 12 + L.nameW, w: L.cols.mode },
      { key: "region", label: "REG", x: L.x + 12 + L.nameW + L.cols.mode, w: L.cols.region },
      {
        key: "players",
        label: "PLAYERS",
        x: L.x + 12 + L.nameW + L.cols.mode + L.cols.region,
        w: L.cols.players,
      },
      {
        key: "ping",
        label: "PING",
        x: L.x + 12 + L.nameW + L.cols.mode + L.cols.region + L.cols.players,
        w: L.cols.ping,
      },
    ];
    ctx.font = "bold 12px monospace";
    ctx.textBaseline = "middle";
    for (const hd of headers) {
      if (UI.row(ctx, { x: hd.x, y: headY, w: hd.w - 6, h: 18 })) {
        if (sortKey === hd.key) sortDir = -sortDir;
        else {
          sortKey = hd.key;
          sortDir = 1;
        }
      }
      ctx.fillStyle = sortKey === hd.key ? "#4ecdc4" : "#7d8894";
      ctx.textAlign = "left";
      const arrow = sortKey === hd.key ? (sortDir === 1 ? " ▲" : " ▼") : "";
      ctx.fillText(hd.label + arrow, hd.x, headY + 9);
    }

    // ---- the list: clipped rows + scrollbar ----
    const content = list.length * ROW_H;
    scroll = UI.scrollbar(ctx, {
      x: L.x + L.w - 14,
      y: L.listY,
      h: L.listH,
      view: L.listH,
      content,
      offset: scroll,
      wheelArea: { x: L.x, y: L.listY, w: L.w, h: L.listH },
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x + 2, L.listY, L.w - 4, L.listH);
    ctx.clip();

    const first = Math.floor(scroll / ROW_H);
    const last = Math.min(list.length - 1, Math.ceil((scroll + L.listH) / ROW_H));
    for (let i = first; i <= last; i++) {
      const s = list[i];
      const ry = L.listY + i * ROW_H - scroll;
      if (UI.row(ctx, { x: L.x + 2, y: ry, w: L.w - 18, h: ROW_H, selected: s === selected })) {
        selected = s;
      }
      ctx.font = "13px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "#e8f0f4";
      ctx.fillText(s.name, headers[0].x, ry + ROW_H / 2, L.nameW - 10);
      ctx.fillStyle = "#9aa7b0";
      ctx.fillText(s.mode, headers[1].x, ry + ROW_H / 2);
      ctx.fillText(s.region, headers[2].x, ry + ROW_H / 2);
      ctx.fillStyle = s.players >= s.max ? "#ff6b6b" : "#9aa7b0";
      ctx.fillText(`${s.players}/${s.max}`, headers[3].x, ry + ROW_H / 2);
      ctx.fillStyle = pingColor(s.ping);
      ctx.fillText(`${s.ping}`, headers[4].x, ry + ROW_H / 2);
    }
    if (list.length === 0) {
      ctx.fillStyle = "#5a6a75";
      ctx.textAlign = "center";
      ctx.fillText("no servers match the filters", L.x + L.w / 2, L.listY + 40);
    }
    ctx.restore();

    // ---- footer: count, status, JOIN ----
    const footY = L.y + L.h - 52;
    ctx.strokeStyle = "#2a3a48";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L.x + 2, footY);
    ctx.lineTo(L.x + L.w - 2, footY);
    ctx.stroke();
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#7d8894";
    // The join status takes the counter's spot while it's showing.
    if (status) {
      ctx.fillStyle = status.startsWith("Connected") ? "#6bff9e" : "#ffd43b";
      ctx.fillText(status, L.x + 12, footY + 26);
    } else {
      ctx.fillText(`${list.length}/${servers.length} servers · R to refresh`, L.x + 12, footY + 26);
    }
    if (
      UI.button(ctx, {
        x: L.x + L.w - 116,
        y: footY + 8,
        w: 104,
        h: 34,
        label: "JOIN",
        disabled: !selected || refreshing,
      })
    ) {
      join(selected);
      UI.float("JOIN", L.x + L.w - 64, footY, { color: "#4ecdc4", life: 600 });
    }

    UI.drawFloats(ctx);
  },
});
