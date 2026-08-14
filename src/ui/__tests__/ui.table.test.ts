import { describe, expect, it, beforeEach } from "vitest";
import { _reset, table, type TableColumn, type TableOptions } from "@src/ui/api.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp } from "./app-fixture.js";

// A mock 2D context that records fillText and answers measureText, enough for
// UI.text / list / listItem / scrollbar to run headless.
function mockCtx() {
  const fillText: [string, number, number][] = [];
  // Minimal canvas so the focus wiring (listItem ids) runs headless.
  const canvas = {
    hasAttribute: () => true,
    tabIndex: 0,
    style: {} as Record<string, string>,
    addEventListener: () => {},
  };
  const ctx = {
    canvas,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    rect() {},
    fill() {},
    clip() {},
    stroke() {},
    strokeRect() {},
    fillRect() {},
    fillText: (t: string, x: number, y: number) => fillText.push([t, x, y]),
    measureText: (t: string) => ({ width: t.length * 7 }),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillText };
}

interface Server {
  name: string;
  ping: number;
}
const servers = (): Server[] => [
  { name: "Cee", ping: 30 },
  { name: "Aay", ping: 10 },
  { name: "Bee", ping: 20 },
];

// Capture the row order the cell callback sees for a given column.
function renderOrder(opts: {
  rows: Server[];
  sort: { key: string; dir: 1 | -1 };
  columns?: TableColumn<Server>[];
  w?: number;
  h?: number;
  cellPadding?: { x?: number; y?: number };
}): { order: Server[]; cellRects: Record<string, { x: number; w: number }[]> } {
  const order: Server[] = [];
  const cellRects: Record<string, { x: number; w: number }[]> = {};
  const columns: TableColumn<Server>[] = opts.columns ?? [
    {
      key: "name",
      label: "NAME",
      value: (s) => s.name,
      cell: (s, r) => {
        (cellRects.name ??= []).push({ x: r.x, w: r.w });
      },
    },
    {
      key: "ping",
      label: "PING",
      width: 70,
      align: "right",
      value: (s) => s.ping,
      cell: (s, r) => {
        order.push(s);
        (cellRects.ping ??= []).push({ x: r.x, w: r.w });
      },
    },
  ];
  table<Server>({
    x: 0,
    y: 0,
    w: opts.w ?? 200,
    h: opts.h ?? 300,
    rowHeight: 20,
    columns,
    rows: opts.rows,
    sort: opts.sort,
    offset: 0,
    cellPadding: opts.cellPadding ?? { x: 0, y: 0 },
    id: "t",
  });
  return { order, cellRects };
}

describe("UI.table", () => {
  beforeEach(() => {
    _reset();
    selectUiApp(createTestUiApp(mockCtx().ctx));
  });

  it("sorts rows by the active column ascending", () => {
    const { order } = renderOrder({ rows: servers(), sort: { key: "ping", dir: 1 } });
    expect(order.map((s) => s.ping)).toEqual([10, 20, 30]);
  });

  it("sorts descending when dir is -1", () => {
    const { order } = renderOrder({ rows: servers(), sort: { key: "ping", dir: -1 } });
    expect(order.map((s) => s.ping)).toEqual([30, 20, 10]);
  });

  it("sorts string columns lexically", () => {
    const { order } = renderOrder({ rows: servers(), sort: { key: "name", dir: 1 } });
    expect(order.map((s) => s.name)).toEqual(["Aay", "Bee", "Cee"]);
  });

  it("leaves the input rows array untouched (sorts a copy)", () => {
    const rows = servers();
    renderOrder({ rows, sort: { key: "ping", dir: 1 } });
    expect(rows.map((s) => s.ping)).toEqual([30, 10, 20]);
  });

  it("lays out fixed + flex columns across the width", () => {
    const { cellRects } = renderOrder({ rows: servers(), sort: { key: "ping", dir: 1 }, w: 200 });
    // Few rows → no scrollbar gutter → full 200px. ping is fixed 70, name flexes to 130.
    expect(cellRects.name[0]).toEqual({ x: 0, w: 130 });
    expect(cellRects.ping[0]).toEqual({ x: 130, w: 70 });
  });

  it("reserves a scrollbar gutter when rows overflow, shrinking the flex column", () => {
    // 40 rows × 20px = 800 > listH (300 - 24 header) → 14px gutter reserved.
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `S${i}`, ping: i }));
    const { cellRects } = renderOrder({ rows: many, sort: { key: "ping", dir: 1 }, w: 200 });
    // contentW = 200 - 14 = 186; ping fixed 70 → name flexes to 116.
    expect(cellRects.name[0].w).toBe(116);
    expect(cellRects.ping[0].x).toBe(116);
  });

  it("insets header and cell content without changing column layout", () => {
    const { cellRects } = renderOrder({
      rows: servers(),
      sort: { key: "ping", dir: 1 },
      w: 200,
      cellPadding: { x: 8, y: 2 },
    });
    expect(cellRects.name[0]).toEqual({ x: 8, w: 114 });
    expect(cellRects.ping[0]).toEqual({ x: 138, w: 54 });
  });

  it("accepts independent cell-padding edges", () => {
    const { cellRects } = renderOrder({
      rows: servers(),
      sort: { key: "ping", dir: 1 },
      w: 200,
      cellPadding: { left: 4, right: 10, top: 1, bottom: 3 },
    });
    expect(cellRects.name[0]).toEqual({ x: 4, w: 116 });
    expect(cellRects.ping[0]).toEqual({ x: 134, w: 56 });
  });

  it("draws each header label with a sort arrow on the active column only", () => {
    const { ctx, fillText } = mockCtx();
    selectUiApp(createTestUiApp(ctx));
    table<Server>({
      x: 0,
      y: 0,
      w: 200,
      h: 300,
      rowHeight: 20,
      rows: servers(),
      sort: { key: "ping", dir: 1 },
      offset: 0,
      columns: [
        { key: "name", label: "NAME", value: (s) => s.name },
        { key: "ping", label: "PING", width: 70, value: (s) => s.ping },
      ],
    });
    const labels = fillText.map((f) => f[0]);
    expect(labels).toContain("NAME");
    expect(labels).toContain("PING ▲"); // active column, ascending
    expect(labels).not.toContain("NAME ▲");
  });

  it("returns the sort/offset/selected unchanged without pointer interaction", () => {
    const rows = servers();
    const res = table<Server>({
      x: 0,
      y: 0,
      w: 200,
      h: 300,
      rowHeight: 20,
      rows,
      sort: { key: "ping", dir: -1 },
      offset: 0,
      selected: rows[1],
      columns: [{ key: "ping", label: "PING", value: (s) => s.ping }],
    });
    expect(res.sort).toEqual({ key: "ping", dir: -1 });
    expect(res.offset).toBe(0);
    expect(res.selected).toBe(rows[1]);
  });
});

// PLAN item 172. A table with no rows used to leave callers with one option:
// skip `UI.table` and draw a sentence instead — which takes the HEADER away
// with the data, so the block changes shape rather than contents and anything
// centred around it moves. `empty` is the option that keeps the table.
describe("UI.table empty state", () => {
  let painted: [string, number, number][];

  beforeEach(() => {
    _reset();
    const made = mockCtx();
    painted = made.fillText;
    selectUiApp(createTestUiApp(made.ctx));
  });

  const columns: TableColumn<Server>[] = [
    { key: "name", label: "NAME", value: (s) => s.name },
    { key: "ping", label: "PING", width: 70, align: "right", value: (s) => s.ping },
  ];

  function render(rows: Server[], empty?: TableOptions<Server>["empty"]) {
    painted.length = 0;
    const result = table<Server>({
      x: 0,
      y: 0,
      w: 200,
      h: 300,
      rowHeight: 20,
      headerHeight: 24,
      columns,
      rows,
      sort: { key: "ping", dir: 1 },
      offset: 0,
      cellPadding: { x: 0, y: 0 },
      empty,
      id: "t",
    });
    return { result, painted: [...painted] };
  }

  it("draws the message, and still draws the header above it", () => {
    const { painted } = render([], "Nobody has a party open.");
    const said = painted.map(([t]) => t);
    expect(said).toContain("Nobody has a party open.");
    // The whole point: the columns do not vanish with the data.
    expect(said).toContain("NAME");
    expect(said.some((t) => t.startsWith("PING"))).toBe(true);
  });

  it("puts the message BELOW the header, not over it", () => {
    const { painted } = render([], "Nothing here");
    const y = (label: string) => painted.find(([t]) => t.startsWith(label))![2];
    expect(y("Nothing here")).toBeGreaterThan(y("NAME"));
  });

  it("says nothing at all when the caller passed no empty", () => {
    // Opt-in: a rowless table without `empty` draws exactly what it always did.
    const { painted } = render([]);
    expect(painted.map(([t]) => t)).toEqual(["NAME", "PING ▲"]);
  });

  it("does not draw the message once there is a row to show", () => {
    const { painted } = render([{ name: "Aay", ping: 10 }], "Nobody has a party open.");
    const said = painted.map(([t]) => t);
    expect(said).not.toContain("Nobody has a party open.");
    expect(said).toContain("Aay");
  });

  it("hands a callback the body rect, under the header and inside the padding", () => {
    let got: { x: number; y: number; w: number; h: number } | null = null;
    table<Server>({
      x: 10,
      y: 20,
      w: 200,
      h: 300,
      rowHeight: 20,
      headerHeight: 24,
      columns,
      rows: [],
      sort: { key: "ping", dir: 1 },
      offset: 0,
      cellPadding: { x: 4, y: 2 },
      empty: (rect) => {
        got = rect;
      },
      id: "t",
    });
    // x/y inset by the cell padding, y also past the header strip; the width is
    // the full table width less the padding, because a rowless table overflows
    // nothing and so reserves no scrollbar gutter.
    expect(got).toEqual({ x: 14, y: 46, w: 192, h: 272 });
  });

  it("leaves the table's own rect alone, so the overlay recipe still works", () => {
    const bare = render([]).result.rect;
    const withEmpty = render([], "Nothing here").result.rect;
    expect(withEmpty).toEqual(bare);
    expect(withEmpty).toEqual({ x: 0, y: 0, w: 200, h: 300 });
  });

  it("keeps the header sortable while the table is empty", () => {
    // Deliberate: the arrow answers "what will this be sorted by when rows
    // arrive", and a header that stopped responding when the data ran out
    // would be the same shape-changing surprise in another form.
    const { result } = render([], "Nothing here");
    expect(result.sort).toEqual({ key: "ping", dir: 1 });
    expect(result.offset).toBe(0);
    expect(result.selected).toBe(null);
  });
});
