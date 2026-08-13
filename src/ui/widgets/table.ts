import { listItem } from "./lists.js";
import {
  Fillable,
  fillRect,
  resolveThemePadding,
  text,
  textWidth,
  theme,
  uiPointer,
  type UiPadding,
} from "@src/ui/core/index.js";
import { list } from "./lists.js";
import { pointInRect } from "@src/collision/index.js";

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
  /** This column hosts INTERACTIVE widgets — a JOIN button, a kick icon — not
   *  just drawing. The table then stops reading presses inside it as presses on
   *  the ROW, so the widget's click isn't also a row selection. Set it on the
   *  column, not per cell: the column's rect is what the row has to exclude,
   *  and it has to know before the cells draw. */
  interactive?: boolean;
  /** Custom cell renderer, drawn into the padded content rect (e.g. a coloured
   *  number, a bar, or a widget). Falls back to `value` rendered as themed
   *  text. `cell` carries the ids and row state a widget needs. */
  cell?: (row: Row, rect: { x: number; y: number; w: number; h: number }, cell: TableCell) => void;
}

/** What a cell renderer is told about the cell it is drawing into, beyond the
 *  rect: everything a WIDGET in that cell needs and cannot work out for
 *  itself. */
export interface TableCell {
  /** A stable widget id for this cell. Keyed by the ROW (via `rowKey`), not by
   *  the slot the row currently occupies, so sorting or scrolling the table
   *  doesn't move a widget's identity onto its neighbour — which would take
   *  the keyboard focus and the pressed state with it. Suffix it (`` `${id}:x` ``)
   *  when a cell holds more than one widget. */
  id: string;
  /** The row's position in the SORTED rows this frame. A position, not an
   *  identity — use `id` for anything that must survive a re-sort. */
  index: number;
  /** This row is the selected one. */
  selected: boolean;
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
  rowHeight: number;
  /** Header strip height in px. Default 24. */
  headerHeight?: number;
  /** Vertical gap between rows. Default 0. */
  rowGap?: number;
  /** Inset around header and cell content. Defaults to `{ x: spacing.sm,
   *  y: spacing.xs }`; explicit edges are supported. */
  cellPadding?: UiPadding;
  /** The selected row (by identity) to highlight; assign the result's
   *  `selected` back. Omit the field for a non-selectable table. */
  selected?: Row | null;
  /** Scrollbar width when the list overflows. Defaults to the theme scrollbar
   *  width. */
  scrollbarWidth?: number;
  /** Stable identity per row — a party code, a player id. Without it a row is
   *  identified by its POSITION, which moves the moment the table is re-sorted
   *  or a row arrives: the keyboard focus stays on the slot and lands on
   *  whatever slid into it, and a widget in a cell inherits the previous
   *  occupant's id. Give it for any table that sorts, streams, or holds
   *  widgets. */
  rowKey?: (row: Row) => string;
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
 *      x, y, w, h, rowHeight: 28, id: "servers",
 *      rows: servers, sort: state.sort, offset: state.offset, selected: state.selected,
 *      columns: [
 *        { key: "name", label: "NAME", value: (s) => s.name },   // flex
 *        { key: "ping", label: "PING", width: 70, align: "right", value: (s) => s.ping,
 *          cell: (s, r) => UI.text(`${s.ping}`, { ...r, align: "right", color: pingColor(s.ping) }) },
 *      ],
 *    });
 *
 *  A cell can hold a WIDGET, not just drawing — a JOIN button, a kick icon.
 *  Mark the column `interactive` and give the widget `cell.id`, and give the
 *  table a `rowKey`; the two together are what make the press belong to the
 *  widget instead of also selecting the row, and keep the widget's identity on
 *  its row through a sort or a scroll:
 *
 *      { key: "join", label: "", width: 80, sortable: false, interactive: true,
 *        cell: (p, r, cell) => {
 *          if (UI.button({ ...r, id: cell.id, label: "JOIN" })) join(p.code);
 *        } } */
export function table<Row>(opts: TableOptions<Row>): TableResult<Row> {
  const padding = resolveThemePadding(opts.cellPadding, {
    x: theme.spacing.sm,
    y: theme.spacing.xs,
  });
  const flexNatural = opts.columns
    .filter((c) => c.width === undefined)
    .map((c) => {
      const values = c.value ? opts.rows.map((row) => String(c.value!(row))) : [];
      const widest = Math.max(0, textWidth(c.label), ...values.map((value) => textWidth(value)));
      return Math.ceil(widest) + padding.left + padding.right;
    })
    .reduce((sum, width) => sum + width, 0);
  const intrinsicFixed = opts.columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const intrinsicW = intrinsicFixed + flexNatural;
  // Explicit x/y place it by hand; otherwise auto-flow — fill the ambient (or
  // `at`) layout, leaving `reserve` px for siblings drawn after the table.
  const rect = fillRect({ ...opts, minW: Math.max(opts.minW ?? 0, intrinsicW) }, "table");
  const headerHeight = opts.headerHeight ?? 24;
  const rowGap = opts.rowGap ?? 0;
  const left = Math.max(0, padding.left);
  const right = Math.max(0, padding.right);
  const top = Math.max(0, padding.top);
  const bottom = Math.max(0, padding.bottom);
  const rowHeight = opts.rowHeight;
  const scrollbarWidth = opts.scrollbarWidth ?? theme.scrollbarW;

  // Does the list overflow → is a scrollbar gutter reserved? Match `list`'s own
  // formula so the header columns line up with the row cells (both drop it).
  const listH = rect.h - headerHeight;
  const content = opts.rows.length * (rowHeight + rowGap) - (opts.rows.length > 0 ? rowGap : 0);
  const barW = content > listH ? scrollbarWidth + theme.scrollbarGap : 0;
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
        h: headerHeight,
      });
      if (hit) {
        sort = activeCol ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 };
      }
    }
    const arrow = activeCol ? (sort.dir === 1 ? " ▲" : " ▼") : "";
    text(c.label + arrow, {
      size: 12,
      bold: true,
      align: c.align ?? "left",
      color: activeCol ? "accent" : "dim",
      x: r.x + left,
      y: rect.y + top,
      w: Math.max(0, r.w - left - right),
      h: Math.max(0, headerHeight - top - bottom),
    });
  });

  // Row identity. `rowKey` names the ROW; without one a row is only its
  // position, which is what it has always been — keep that as the fallback so
  // existing ids don't move.
  const baseId = opts.id ?? `table@${rect.x}:${rect.y}`;
  const rowToken = (i: number): string => (opts.rowKey ? opts.rowKey(rows[i]) : String(i));
  const rowWidgetId = (i: number): string => `${opts.id}:r:${rowToken(i)}`;
  // Columns that host widgets, as x-spans. A press inside one belongs to the
  // widget, not to the row behind it: the row draws FIRST (it is the
  // background), so without this the JOIN button and the row selection both
  // take the same click. Empty for every table that only draws.
  const widgetSpans = opts.columns
    .map((c, i) => (c.interactive ? rects[i] : null))
    .filter((r): r is { x: number; w: number } => r !== null);

  // Rows: windowed list; draw the selection highlight then each column's cell.
  let selected: Row | null = opts.selected ?? null;
  const offset = list(
    {
      x: rect.x,
      y: rect.y + headerHeight,
      w: rect.w,
      h: listH,
      rowH: rowHeight,
      gap: rowGap,
      count: rows.length,
      offset: opts.offset,
      scrollW: scrollbarWidth,
      id: opts.id ? `${opts.id}:list` : undefined,
      // Rows are keyboard-navigable: the list registers every row's id (so Tab
      // reaches all of them) and auto-scrolls to the focused one. The per-row
      // listItem below uses the SAME id but tabIndex:-1, so it draws the focus
      // ring + handles Enter without adding a duplicate tab stop.
      rowId: opts.id ? rowWidgetId : undefined,
    },
    (i, rowRect) => {
      const rowData = rows[i];
      const isSel = opts.selected !== undefined && rowData === opts.selected;
      // Decided BEFORE the row's own hit test, because the widget that owns
      // this press hasn't drawn yet — the cells come after the background.
      const p = uiPointer();
      const overWidget = widgetSpans.some((span) =>
        pointInRect(p.x, p.y, { x: span.x, y: rowRect.y, w: span.w, h: rowHeight }),
      );
      const clicked = listItem({
        id: opts.id ? rowWidgetId(i) : undefined,
        tabIndex: -1,
        x: rowRect.x,
        y: rowRect.y,
        w: rowRect.w,
        h: rowHeight,
        selected: isSel,
      });
      if (clicked && !overWidget) selected = rowData;
      opts.columns.forEach((c, ci) => {
        const cellRect = {
          x: rects[ci].x + left,
          y: rowRect.y + top,
          w: Math.max(0, rects[ci].w - left - right),
          h: Math.max(0, rowHeight - top - bottom),
        };
        if (c.cell) {
          c.cell(rowData, cellRect, {
            id: `${baseId}:c:${rowToken(i)}:${c.key}`,
            index: i,
            selected: isSel,
          });
        } else if (c.value) {
          text(String(c.value(rowData)), { ...cellRect, align: c.align ?? "left" });
        }
      });
    },
  );

  return { sort, offset, selected, rect };
}
