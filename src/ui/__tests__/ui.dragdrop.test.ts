// A drag-and-drop payload owns the pointer while it is in flight. These tests
// pin the two consequences that are easy to regress: a widget under the pointer
// must stop LOOKING interactive while something is carried over it, and it must
// keep clicking normally the moment nothing is.
//
// `hoverCursor` is the observable: `button` asks for the hand cursor when and
// only when it considers itself hovered, so the recorded cursor requests are a
// faithful read of a state the widget otherwise only paints.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, button, dragSource, dropIndicator, dropTarget } from "@src/ui/api.js";
import { registerUiApp, selectUiApp } from "@src/ui/core/state.js";
import type { App } from "@src/engine/index.js";

function mockCtx() {
  return {
    canvas: {
      width: 800,
      height: 600,
      style: {},
      hasAttribute: () => true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      focus: vi.fn(),
    },
    font: "13px monospace",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "left" as CanvasTextAlign,
    fillStyle: "#fff",
    strokeStyle: "#fff",
    lineWidth: 1,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (str: string) =>
      ({
        width: str.length * 8,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3,
      }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

const SOURCE = { x: 0, y: 0, w: 100, h: 30 };
const BIN = { x: 200, y: 0, w: 100, h: 100 };

function testApp(ctx: CanvasRenderingContext2D) {
  const frameHooks: (() => void)[] = [];
  const cursors: string[] = [];
  const noop = (): void => {};
  const unsubscribe = (): void => {};
  const pointer = {
    x: -1,
    y: -1,
    inside: true,
    down: false,
    pressed: false,
    released: false,
    doublePressed: false,
    framePressed: false,
    frameReleased: false,
    frameDoublePressed: false,
    wheel: 0,
  };
  const app = {
    ctx,
    viewport: { canvas: ctx.canvas, ctx, w: 800, h: 600, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 },
    Pointer: pointer,
    Loop: { step: 1000 / 60, steps: 0, onStep: () => unsubscribe, onFrame: () => unsubscribe },
    resetTransform: noop,
    setCursor: (cursor: string) => cursors.push(cursor),
    onStep: () => unsubscribe,
    onFrame: (fn: () => void) => {
      frameHooks.push(fn);
      return unsubscribe;
    },
  } as unknown as App;
  return {
    app: registerUiApp(app),
    ctx,
    pointer,
    cursors,
    endFrame: () => frameHooks.forEach((fn) => fn()),
  };
}

let fixture: ReturnType<typeof testApp>;

interface FrameResult {
  sourceClicked: boolean;
  binClicked: boolean;
  target: ReturnType<typeof dropTarget>;
  cursors: string[];
}

/** One complete frame: the source's own button, the source, a drop target, and
 *  a second button inside that target — the control a carried payload passes
 *  over. `accepts` is threaded so a test can make the target refuse. */
function frame(accepts?: () => boolean): FrameResult {
  fixture.cursors.length = 0;
  const sourceClicked = button({ id: "src", label: "Sword", ...SOURCE });
  dragSource({ id: "item:sword", ...SOURCE, payload: { item: "Sword" } });
  const target = dropTarget({ id: "bin", ...BIN, accepts });
  const binClicked = button({ id: "in-bin", label: "Potion", x: 200, y: 0, w: 100, h: 30 });
  const cursors = [...fixture.cursors];
  fixture.endFrame();
  selectUiApp(fixture.app);
  return { sourceClicked, binClicked, target, cursors };
}

beforeEach(() => {
  _reset();
  fixture = testApp(mockCtx());
  selectUiApp(fixture.app);
});

function press(x: number, y: number) {
  Object.assign(fixture.pointer, { x, y, down: true, framePressed: true, frameReleased: false });
}
function move(x: number, y: number) {
  Object.assign(fixture.pointer, { x, y, down: true, framePressed: false, frameReleased: false });
}
function release(x: number, y: number) {
  Object.assign(fixture.pointer, { x, y, down: false, framePressed: false, frameReleased: true });
}
function idle(x: number, y: number) {
  Object.assign(fixture.pointer, { x, y, down: false, framePressed: false, frameReleased: false });
}

describe("a carried payload suppresses hover on what it passes over", () => {
  it("a hovered button asks for the hand cursor when nothing is being dragged", () => {
    idle(250, 15); // over the button inside the bin
    expect(frame().cursors).toContain("pointer");
  });

  it("stops asking once a payload is in flight over it", () => {
    press(50, 15); // grab the source
    frame();
    move(250, 15); // carry it over the bin's button
    const carried = frame();
    expect(carried.cursors).not.toContain("pointer");
    // ...and the drag's own cursors are the ones that answer instead.
    expect(carried.cursors).toContain("copy");
  });

  it("gives hover straight back when the drag ends", () => {
    press(50, 15);
    frame();
    move(250, 15);
    frame();
    release(250, 15); // drops into the bin
    frame();
    idle(250, 15);
    expect(frame().cursors).toContain("pointer");
  });

  it("still clicks a source the pointer pressed and released without carrying", () => {
    idle(50, 15);
    frame();
    release(50, 15);
    expect(frame().sourceClicked).toBe(true);
  });
});

describe("the drop target reports what a release would do", () => {
  it("is hovered and droppable with the payload over it", () => {
    press(50, 15);
    frame();
    move(250, 15);
    const { target } = frame();
    expect(target.hovered).toBe(true);
    expect(target.canDrop).toBe(true);
  });

  it("is hovered but NOT droppable when `accepts` refuses", () => {
    press(50, 15);
    frame(() => false);
    move(250, 15);
    const { target, cursors } = frame(() => false);
    expect(target.hovered).toBe(true);
    expect(target.canDrop).toBe(false);
    expect(cursors).toContain("not-allowed");
  });

  it("reports nothing while no payload is in flight", () => {
    idle(250, 15);
    const { target } = frame();
    expect(target.hovered).toBe(false);
    expect(target.canDrop).toBe(false);
    expect(target.dropped).toBeNull();
  });
});

// ---------- dropIndicator ----------
// The caret's index is pure geometry — nearest insertion SEGMENT to the
// pointer — so these assert it directly rather than through what was painted.
// `moveTo` is the paint observable: nothing else in these frames strokes.

/** A column of three 100×30 rows stacked from the origin. */
const COLUMN = [
  { x: 0, y: 0, w: 100, h: 30 },
  { x: 0, y: 30, w: 100, h: 30 },
  { x: 0, y: 60, w: 100, h: 30 },
];

/** A row-major 4×2 of 40×40 cells — indices 0..3 on the top row, 4..7 below. */
const GRID = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  x: (i % 4) * 40,
  y: Math.floor(i / 4) * 40,
  w: 40,
  h: 40,
}));

/** Close the frame and open the next one. `uiPointer` caches its answer for
 *  the frame, so two reads either side of a `idle()` in ONE frame would both
 *  see the first position. */
function newFrame(): void {
  fixture.endFrame();
  selectUiApp(fixture.app);
}

function strokes(): number {
  return (fixture.ctx.moveTo as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
}

/** Grab SOURCE and carry the payload to (x, y), leaving it in flight. */
function carryTo(x: number, y: number): void {
  press(50, 15);
  dragSource({ id: "item:sword", ...SOURCE, payload: { item: "Sword" } });
  newFrame();
  move(x, y);
}

describe("dropIndicator picks the insertion point nearest the pointer", () => {
  it("reads a column from the leading edge of the row under the pointer", () => {
    idle(50, 2);
    expect(dropIndicator({ items: COLUMN, axis: "y" })).toBe(0);
    newFrame();
    idle(50, 34);
    expect(dropIndicator({ items: COLUMN, axis: "y" })).toBe(1);
  });

  it("offers the index PAST the last row at the bottom of the list", () => {
    idle(50, 88);
    expect(dropIndicator({ items: COLUMN, axis: "y" })).toBe(COLUMN.length);
  });

  it("does not confuse the end of a grid row with the start of the next", () => {
    // Right edge of cell 3 — the last cell of the top row. Comparing x alone
    // would put this at index 0 of the row below; the nearest SEGMENT is cell
    // 3's trailing edge, which is index 4.
    idle(158, 20);
    expect(dropIndicator({ items: GRID, axis: "x" })).toBe(4);
    // ...and the left edge of cell 4, one row down, is the same insertion
    // point reached from the other side of the wrap.
    newFrame();
    idle(2, 60);
    expect(dropIndicator({ items: GRID, axis: "x" })).toBe(4);
  });

  it("falls back to the `empty` box when there is nothing to sit between", () => {
    idle(50, 50);
    expect(dropIndicator({ items: [], empty: { x: 0, y: 0, w: 100, h: 0 } })).toBe(0);
    expect(dropIndicator({ items: [] })).toBe(0);
  });
});

describe("dropIndicator draws only while a payload is in flight", () => {
  it("stays invisible when nothing is being dragged", () => {
    idle(50, 34);
    dropIndicator({ items: COLUMN, axis: "y" });
    expect(strokes()).toBe(0);
  });

  it("draws the caret once a payload is carried over the list", () => {
    carryTo(50, 34);
    dropIndicator({ items: COLUMN, axis: "y" });
    expect(strokes()).toBe(1);
  });

  it("honours `silent` so only the hovered list of several shows a caret", () => {
    carryTo(50, 34);
    dropIndicator({ items: COLUMN, axis: "y", silent: true });
    expect(strokes()).toBe(0);
  });

  it("still reports the index on the release frame, after the drop cleared the drag", () => {
    // This is the whole reason the index is not gated on the drag: `dropTarget`
    // nulls the payload when it consumes the release, and the caller reads the
    // position from the SAME frame that hands it `dropped`.
    carryTo(50, 34);
    dropIndicator({ items: COLUMN, axis: "y" });
    newFrame();
    release(50, 34);
    const target = dropTarget({ id: "list", x: 0, y: 0, w: 100, h: 90 });
    expect(target.dropped).not.toBeNull();
    expect(dropIndicator({ items: COLUMN, axis: "y" })).toBe(1);
  });
});
