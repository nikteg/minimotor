import { Fillable, type UiPadding } from "../../ui/core/index.js";
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
    cell?: (row: Row, rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    }, cell: TableCell) => void;
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
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
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
export declare function table<Row>(opts: TableOptions<Row>): TableResult<Row>;
