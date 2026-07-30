import { listItem } from "./lists.js";
import { Fillable, fillRect, text } from "../core/index.js";
import { list } from "./lists.js";

// Last sorted copy per input array (weak — dropped with the data). Re-sorts
// only when the caller passes a new array or the sort key/direction changes;
// see the `rows` doc on TableOptions.
const sortCache = new WeakMap<object, { key: string; dir: 1 | -1; sorted: unknown[] }>();

// ---------- Table ----------

/** One column of a `table`: a header, a width, and how to sort + render it. */
export interface TableColumn<Row> {
  /** Stable key — identifies the column for sorting and header ids. */
  key: string;
  /** Header label. */
  label: string;
  /** Fixed width in px. Omit to flex — the leftover width is shared equally
   *  among all flex columns. */
  width?: number;
  /** Header + cell text alignment. Default `"left"`. */
  align?: "left" | "center" | "right";
  /** Whether clicking the header sorts by this column. Defaults to true when a
   *  `value` accessor is given, false otherwise. */
  sortable?: boolean;
  /** The sortable value — also the default cell text when `cell` is omitted. */
  value?: (row: Row) => string | number;
  /** Custom cell renderer, drawn into the cell rect (e.g. a coloured number or
   *  a bar). Falls back to `value` rendered as themed text. */
  cell?: (row: Row, rect: { x: number; y: number; w: number; h: number }) => void;
}

/** Current sort: which column `key`, ascending (`1`) or descending (`-1`). */
export interface TableSort {
  /** `key` of the column currently sorted on. */
  key: string;
  /** Sort direction: `1` ascending, `-1` descending. */
  dir: 1 | -1;
}

/** Inputs to `table`: geometry, `columns`, `rows`, and the controlled
 *  sort/scroll/selection state. */
export interface TableOptions<Row> extends Fillable {
  /** Left edge in px. Omit (with `y`) to AUTO-FLOW: the table fills the current
   *  `row`/`col`/`panel` (or `at` flow), leaving `reserve` px for later siblings
   *  (a footer). Given explicitly, `w` includes the scrollbar gutter. */
  x?: number;
  /** Top edge in px (see `x`). */
  y?: number;
  /** Width in px (header strip + rows), including the scrollbar gutter. Ignored
   *  when auto-flowing (the container's cross axis sets it). */
  w?: number;
  /** Total height in px, header strip included. Ignored when auto-flowing. */
  h?: number;
  /** Column definitions, left to right. */
  columns: TableColumn<Row>[];
  /** The data rows; left untouched — the table sorts a copy. The sorted copy
   *  is cached by ARRAY IDENTITY + sort, so pass a fresh array (not an
   *  in-place mutation) when the data changes. */
  rows: Row[];
  /** Current sort — pass state in, assign the result's `sort` back. */
  sort: TableSort;
  /** Current scroll offset (px) — pass in, assign the result's `offset` back. */
  offset: number;
  /** Row height in px. */
  rowH: number;
  /** Header strip height in px. Default 24. */
  headerH?: number;
  /** Vertical gap between rows. Default 0. */
  gap?: number;
  /** The selected row (by identity) to highlight; assign the result's
   *  `selected` back. Omit the field for a non-selectable table. */
  selected?: Row | null;
  /** Scrollbar width when the list overflows. Default 10. */
  scrollW?: number;
  /** Stable prefix for the header, row, list and scrollbar widget ids. */
  id?: string;
}

/** What `table` returns this frame: the updated sort, scroll offset, and
 *  selection to assign back. */
export interface TableResult<Row> {
  /** Updated sort — a header click may have changed the key/direction. */
  sort: TableSort;
  /** Updated scroll offset. */
  offset: number;
  /** Updated selection — a row click may have changed it; null if none. */
  selected: Row | null;
  /** The rect the table occupied — handy for overlaying an empty-state message
   *  when auto-flowing (no rect was passed in). */
  rect: { x: number; y: number; w: number; h: number };
}

/** A sortable, scrollable data table: clickable column headers (with sort
 *  arrows) over a windowed, optionally-selectable row list. It sorts the rows
 *  itself from the active column's `value`, windows them through `list`, and
 *  reports the caller-owned sort / scroll / selection state back — the
 *  server-browser / leaderboard boilerplate in one call.
 *
 *    state = UI.table({
 *      x, y, w, h, rowH: 28, id: "servers",
 *      rows: servers, sort: state.sort, offset: state.offset, selected: state.selected,
 *      columns: [
 *        { key: "name", label: "NAME", value: (s) => s.name },   // flex
 *        { key: "ping", label: "PING", width: 70, align: "right", value: (s) => s.ping,
 *          cell: (s, r) => UI.text(`${s.ping}`, { ...r, align: "right", color: pingColor(s.ping) }) },
 *      ],
 *    }); */
export function table<Row>(opts: TableOptions<Row>): TableResult<Row> {
  // Explicit x/y place it by hand; otherwise auto-flow — fill the ambient (or
  // `at`) layout, leaving `reserve` px for siblings drawn after the table.
  const rect = fillRect(opts, "table");
  const headerH = opts.headerH ?? 24;
  const gap = opts.gap ?? 0;
  const rowH = opts.rowH;
  const scrollW = opts.scrollW ?? 10;

  // Does the list overflow → is a scrollbar gutter reserved? Match `list`'s own
  // formula so the header columns line up with the row cells (both drop it).
  const listH = rect.h - headerH;
  const content = opts.rows.length * (rowH + gap) - (opts.rows.length > 0 ? gap : 0);
  const barW = content > listH ? scrollW + 4 : 0;
  const contentW = rect.w - barW;

  // Column x-layout: fixed widths first, the remainder split among flex columns.
  const fixed = opts.columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const flexCount = opts.columns.filter((c) => c.width === undefined).length;
  const flexW = flexCount > 0 ? Math.max(0, (contentW - fixed) / flexCount) : 0;
  const rects: { x: number; w: number }[] = [];
  let cx = rect.x;
  for (const c of opts.columns) {
    const w = c.width ?? flexW;
    rects.push({ x: cx, w });
    cx += w;
  }

  // Sort a copy by the active column's value (input array untouched). Strings
  // compare lexically, everything else numerically; `dir` flips the result.
  // The copy is cached against the input array's identity + the sort, so an
  // unchanged table doesn't pay O(n log n) every frame.
  const active = opts.columns.find((c) => c.key === opts.sort.key);
  let rows = opts.rows;
  if (active?.value) {
    const cached = sortCache.get(opts.rows);
    if (cached && cached.key === opts.sort.key && cached.dir === opts.sort.dir) {
      rows = cached.sorted as Row[];
    } else {
      const value = active.value;
      rows = [...opts.rows].sort((a, b) => {
        const av = value(a);
        const bv = value(b);
        const d =
          typeof av === "string" && typeof bv === "string"
            ? av.localeCompare(bv)
            : Number(av) - Number(bv);
        return d * opts.sort.dir;
      });
      sortCache.set(opts.rows, { key: opts.sort.key, dir: opts.sort.dir, sorted: rows });
    }
  }

  // Header: a clickable label + sort arrow per sortable column.
  let sort = opts.sort;
  opts.columns.forEach((c, i) => {
    const r = rects[i];
    const sortable = c.sortable ?? c.value !== undefined;
    const activeCol = sort.key === c.key;
    if (sortable) {
      const hit = listItem({
        id: opts.id ? `${opts.id}:h:${c.key}` : undefined,
        // Sort headers are a POINTER affordance — keep them out of the
        // keyboard tab sequence (tabIndex < 0) so they don't grab the first
        // tab stops ahead of the primary controls above the table.
        tabIndex: -1,
        x: r.x,
        y: rect.y,
        w: r.w,
        h: headerH,
      });
      if (hit) {
        sort = activeCol ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 };
      }
    }
    const arrow = activeCol ? (sort.dir === 1 ? " ▲" : " ▼") : "";
    text(c.label + arrow, {
      x: r.x,
      y: rect.y,
      w: r.w,
      h: headerH,
      size: 12,
      bold: true,
      align: c.align ?? "left",
      color: activeCol ? "accent" : "dim",
    });
  });

  // Rows: windowed list; draw the selection highlight then each column's cell.
  let selected: Row | null = opts.selected ?? null;
  const offset = list(
    {
      x: rect.x,
      y: rect.y + headerH,
      w: rect.w,
      h: listH,
      rowH,
      gap,
      count: rows.length,
      offset: opts.offset,
      scrollW,
      id: opts.id ? `${opts.id}:list` : undefined,
      // Rows are keyboard-navigable: the list registers every row's id (so Tab
      // reaches all of them) and auto-scrolls to the focused one. The per-row
      // listItem below uses the SAME id but tabIndex:-1, so it draws the focus
      // ring + handles Enter without adding a duplicate tab stop.
      rowId: opts.id ? (i) => `${opts.id}:r:${i}` : undefined,
    },
    (i, rowRect) => {
      const rowData = rows[i];
      const isSel = opts.selected !== undefined && rowData === opts.selected;
      const clicked = listItem({
        id: opts.id ? `${opts.id}:r:${i}` : undefined,
        tabIndex: -1,
        x: rowRect.x,
        y: rowRect.y,
        w: rowRect.w,
        h: rowH,
        selected: isSel,
      });
      if (clicked) selected = rowData;
      opts.columns.forEach((c, ci) => {
        const cellRect = { x: rects[ci].x, y: rowRect.y, w: rects[ci].w, h: rowH };
        if (c.cell) c.cell(rowData, cellRect);
        else if (c.value) text(String(c.value(rowData)), { ...cellRect, align: c.align ?? "left" });
      });
    },
  );

  return { sort, offset, selected, rect };
}
