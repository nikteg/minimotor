// A drag-and-drop payload owns the pointer while it is in flight. These tests
// pin the two consequences that are easy to regress: a widget under the pointer
// must stop LOOKING interactive while something is carried over it, and it must
// keep clicking normally the moment nothing is.
//
// `hoverCursor` is the observable: `button` asks for the hand cursor when and
// only when it considers itself hovered, so the recorded cursor requests are a
// faithful read of a state the widget otherwise only paints.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, button, dragSource, dropTarget } from "@src/ui/api.js";
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
