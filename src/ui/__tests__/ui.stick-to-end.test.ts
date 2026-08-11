// `stickToEnd`: a scrolling region that follows its content's tail.
//
// A feed that is appended to — a chat, an event log, a console — is read at the
// bottom, and a scroll region that keeps its offset while the content grows puts
// every new line just below the fold. Following the tail unconditionally is the
// other failure: it snatches the view away from someone reading back through the
// history. So the follow is conditional on already being at the end, and this is
// the file that pins both halves of that.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, col, layoutCapture, layoutTree, text } from "@src/ui/api.js";
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
    arc: vi.fn(),
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
    measureText: (s: string) =>
      ({
        width: s.length * 8,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3,
      }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

let endFrame: () => void;

function testApp(ctx: CanvasRenderingContext2D) {
  const hooks: (() => void)[] = [];
  const noop = (): void => {};
  const un = (): void => {};
  const app = {
    ctx,
    viewport: {
      canvas: ctx.canvas,
      ctx,
      w: 800,
      h: 600,
      dpr: 1,
      safeLeft: 0,
      safeTop: 0,
      safeRight: 0,
      safeBottom: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    Pointer: { x: -1, y: -1, inside: false, down: false, pressed: false, released: false },
    Loop: { step: 1000 / 60, steps: 0, onStep: () => un, onFrame: () => un },
    resetTransform: noop,
    setCursor: noop,
    onStep: () => un,
    onFrame: (fn: () => void) => {
      hooks.push(fn);
      return un;
    },
  } as unknown as App;
  return { app: registerUiApp(app), endFrame: () => hooks.forEach((f) => f()) };
}

function frame(build: () => void) {
  layoutCapture(true);
  build();
  endFrame();
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const e of layoutTree()) if (e.id) out[String(e.id)] = e.rect;
  return out;
}

const BOX = { x: 0, y: 0, w: 200, h: 60 };
const LINE = 20;

/** A log of `count` lines in a 60px box — three lines visible, the rest above. */
const feed = (count: number, stick: boolean) => () =>
  col({ ...BOX, gap: 0, overflow: "auto", stickToEnd: stick, id: "feed" }, () => {
    for (let i = 0; i < count; i += 1) text(`line ${i}`, { id: `line${i}`, h: LINE } as never);
  });

/** Two frames per state: the first seeds the content-size cache the scroll math
 *  reads, the second lays out against it. */
function settle(build: () => void) {
  frame(build);
  return frame(build);
}

beforeEach(() => {
  _reset();
  const fixture = testApp(mockCtx());
  selectUiApp(fixture.app);
  endFrame = () => {
    fixture.endFrame();
    selectUiApp(fixture.app);
  };
});

describe("stickToEnd", () => {
  it("opens a region that is already overflowing on its newest content", () => {
    const rects = settle(feed(10, true));
    // The last line is inside the box; the first is scrolled off above it.
    expect(rects.line9.y + rects.line9.h).toBeLessThanOrEqual(BOX.y + BOX.h + 0.5);
    expect(rects.line9.y).toBeGreaterThanOrEqual(BOX.y - 0.5);
    expect(rects.line0.y).toBeLessThan(BOX.y);
  });

  it("keeps the newest line in view as the content grows", () => {
    settle(feed(6, true));
    // Appending must not push the tail below the fold: the same assertion as
    // above, one growth later, is the whole point of the flag.
    const rects = settle(feed(24, true));
    expect(rects.line23.y + rects.line23.h).toBeLessThanOrEqual(BOX.y + BOX.h + 0.5);
  });

  it("leaves the offset alone without the flag", () => {
    const rects = settle(feed(10, false));
    // Unpinned, the region stays at the top: the first line is visible and the
    // last is far below the box.
    expect(rects.line0.y).toBeCloseTo(BOX.y, 0);
    expect(rects.line9.y).toBeGreaterThan(BOX.y + BOX.h);
  });
});
