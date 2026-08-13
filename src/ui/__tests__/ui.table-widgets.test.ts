// Interactive widgets INSIDE table cells — a JOIN button in the right-hand
// column of a party browser. Three things have to hold, and none of them is
// visible from the argument list: the press has to land on the widget in the
// cell it was drawn in (while the table is scrolled AND sorted), it must not
// also read as a press on the row behind it, and the widget's id has to belong
// to the ROW rather than to the slot the row currently occupies.
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "@src/engine/index.js";
import { _reset, button, focusedId, table, type TableColumn } from "@src/ui/api.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp, endTestFrame, stepTestApp } from "./app-fixture.js";

function mockCtx(): CanvasRenderingContext2D {
  const canvas = {
    hasAttribute: () => true,
    tabIndex: 0,
    style: {} as Record<string, string>,
    addEventListener: () => {},
    focus: () => {},
  };
  return {
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
    fillText() {},
    setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (t: string) => ({ width: t.length * 7 }),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

interface Party {
  code: string;
  name: string;
  players: number;
}

const parties = (): Party[] => [
  { code: "AAA", name: "Cee", players: 3 },
  { code: "BBB", name: "Aay", players: 1 },
  { code: "CCC", name: "Bee", players: 2 },
];

let app: App;
// `pressed` is the fixed-STEP edge the press origin is recorded from;
// `framePressed`/`frameReleased` are the per-FRAME edges the widgets read
// (see `rawPointer`). A test that sets only one of the two describes a press
// half the kernel never saw.
type Pointer = {
  x: number;
  y: number;
  down: boolean;
  pressed: boolean;
  framePressed: boolean;
  frameReleased: boolean;
};
const pointer = (): Pointer => app.Pointer as unknown as Pointer;

beforeEach(() => {
  _reset();
  app = createTestUiApp(mockCtx());
  selectUiApp(app);
});

/** Run one frame: the UI's per-frame state only resets at the frame boundary,
 *  so a test that draws twice without this is still inside frame one. */
function frame(draw: () => void): void {
  selectUiApp(app);
  draw();
  endTestFrame(app);
}

/** A full click at (x, y): the press edge (which records the press origin the
 *  click is gated on), then the release. */
function click(x: number, y: number, draw: () => void): void {
  const p = pointer();
  p.x = x;
  p.y = y;
  p.pressed = true;
  p.framePressed = true;
  p.down = true;
  stepTestApp(app);
  p.pressed = false;
  frame(draw);
  p.framePressed = false;
  p.down = false;
  p.frameReleased = true;
  frame(draw);
  p.frameReleased = false;
}

/** A party browser: name flexes, JOIN is a fixed interactive column. */
function browser(opts: {
  rows: Party[];
  sort?: { key: string; dir: 1 | -1 };
  offset?: number;
  joined: string[];
  ids?: string[];
  selected?: Party | null;
  onSelect?: (row: Party | null) => void;
}): () => void {
  const columns: TableColumn<Party>[] = [
    { key: "name", label: "PARTY", value: (p) => p.name },
    {
      key: "join",
      label: "",
      width: 60,
      sortable: false,
      interactive: true,
      cell: (p, rect, cell) => {
        opts.ids?.push(cell.id);
        if (button({ ...rect, id: cell.id, label: "JOIN" })) opts.joined.push(p.code);
      },
    },
  ];
  return () => {
    const r = table<Party>({
      x: 0,
      y: 0,
      w: 200,
      h: 300,
      rowHeight: 20,
      cellPadding: { x: 0, y: 0 },
      id: "parties",
      rowKey: (p) => p.code,
      columns,
      rows: opts.rows,
      sort: opts.sort ?? { key: "name", dir: 1 },
      offset: opts.offset ?? 0,
      selected: opts.selected ?? null,
    });
    opts.onSelect?.(r.selected);
  };
}

describe("UI.table with interactive cells", () => {
  it("a button in a cell takes its own press, in sorted row order", () => {
    const joined: string[] = [];
    // Sorted by name: Aay(BBB), Bee(CCC), Cee(AAA). Rows start under the 24px
    // header; row 1 is y 44..64, and the JOIN column is x 140..200.
    const draw = browser({ rows: parties(), joined });
    frame(draw);
    click(170, 54, draw);
    expect(joined).toEqual(["CCC"]);
  });

  it("...and in a table that has been scrolled", () => {
    const joined: string[] = [];
    // 40 rows overflow, so a 14px scrollbar gutter appears and JOIN sits at
    // x 126..186. offset 100 puts sorted row 5 at the top of the list body.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      code: `P${String(i).padStart(2, "0")}`,
      name: `Party ${String(i).padStart(2, "0")}`,
      players: i,
    }));
    const draw = browser({ rows, joined, offset: 100 });
    frame(draw);
    click(150, 34, draw);
    expect(joined).toEqual(["P05"]);
  });

  it("pressing the button does not also select the row behind it", () => {
    const joined: string[] = [];
    let selected: Party | null = null;
    const rows = parties();
    const draw = browser({ rows, joined, onSelect: (r) => (selected = r) });
    frame(draw);
    click(170, 54, draw);
    expect(joined).toEqual(["CCC"]);
    expect(selected).toBeNull();
  });

  it("a press on the rest of the row still selects it", () => {
    const joined: string[] = [];
    let selected: Party | null = null;
    const rows = parties();
    const draw = browser({ rows, joined, onSelect: (r) => (selected = r) });
    frame(draw);
    click(60, 54, draw);
    expect(joined).toEqual([]);
    expect(selected).toEqual({ code: "CCC", name: "Bee", players: 2 });
  });

  it("cell ids belong to the row, not to the slot it currently sits in", () => {
    const joined: string[] = [];
    const rows = parties();
    const ascending: string[] = [];
    const descending: string[] = [];
    frame(browser({ rows, joined, ids: ascending, sort: { key: "name", dir: 1 } }));
    frame(browser({ rows, joined, ids: descending, sort: { key: "name", dir: -1 } }));
    // Same three ids, in the opposite order — the id followed the party.
    expect(ascending).toHaveLength(3);
    expect(new Set(ascending)).toEqual(new Set(descending));
    expect(descending).toEqual([...ascending].reverse());
    expect(ascending[0]).toContain("BBB"); // Aay sorts first, and carries its code
  });

  it("keyboard focus follows the row through a re-sort", () => {
    const joined: string[] = [];
    const rows = parties();
    frame(browser({ rows, joined, sort: { key: "name", dir: 1 } }));
    // Focus the JOIN button of the first row (Aay / BBB) by pressing it.
    click(170, 34, browser({ rows, joined, sort: { key: "name", dir: 1 } }));
    selectUiApp(app); // reading kernel state outside a frame
    const focused = focusedId();
    expect(focused).toContain("BBB");
    // Re-sort: BBB is now last, and the focus is still on ITS button.
    frame(browser({ rows, joined, sort: { key: "name", dir: -1 } }));
    selectUiApp(app);
    expect(focusedId()).toBe(focused);
  });
});
