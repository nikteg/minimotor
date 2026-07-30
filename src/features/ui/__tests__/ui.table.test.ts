import { describe, expect, it, beforeEach } from "vitest";
import { _reset, begin, table, type TableColumn } from "../api.js";

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
    rowH: 20,
    columns,
    rows: opts.rows,
    sort: opts.sort,
    offset: 0,
    id: "t",
  });
  return { order, cellRects };
}

describe("UI.table", () => {
  beforeEach(() => {
    _reset();
    begin(mockCtx().ctx);
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

  it("draws each header label with a sort arrow on the active column only", () => {
    const { ctx, fillText } = mockCtx();
    begin(ctx);
    table<Server>({
      x: 0,
      y: 0,
      w: 200,
      h: 300,
      rowH: 20,
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
      rowH: 20,
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
