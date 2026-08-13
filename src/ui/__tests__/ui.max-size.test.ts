// `maxH` / `maxW`: shrink-wrap first, clip only once the content passes the cap.
//
// `h` on a scroll region pins it to that height whether the content needs it or
// not, so a dialog whose contents fit gets a box of empty space and a scrollbar
// it never uses; the only alternative was to leave the height off, and then a
// NESTED region has no main size of its own and takes whatever slot its parent
// hands it. `maxH` is the third answer, and this pins both of its halves.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, col, layoutCapture, layoutTree, panel, row, text } from "@src/ui/api.js";
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

/** Three frames: an auto-sized container has no measurement at all on its first,
 *  and a capped one settles on the second. */
function settle(build: () => void) {
  frame(build);
  frame(build);
  return frame(build);
}

const LINE = 20;

beforeEach(() => {
  _reset();
  const fixture = testApp(mockCtx());
  selectUiApp(fixture.app);
  endFrame = () => {
    fixture.endFrame();
    selectUiApp(fixture.app);
  };
});

describe("maxH on a scrolling container", () => {
  /** `lines` rows of 20 inside a capped scroll region, nested in a panel so the
   *  region has a parent whose slot it would otherwise be given. */
  const capped = (lines: number, maxH?: number) => () =>
    panel({ x: 0, y: 0, w: 200, title: "BOX", id: "frame" }, () => {
      col({ overflow: "auto", gap: 0, maxH, id: "region" }, () => {
        for (let i = 0; i < lines; i += 1) text(`line ${i}`, { id: `line${i}`, h: LINE } as never);
      });
    });

  it("takes the content's own height while the content fits", () => {
    const out = settle(capped(3, 200));
    expect(out.region.h).toBe(3 * LINE);
  });

  it("stops at the cap once the content passes it", () => {
    const out = settle(capped(20, 200));
    expect(out.region.h).toBe(200);
  });

  it("lets the panel around it shrink-wrap the smaller of the two", () => {
    const short = settle(capped(3, 200)).frame.h;
    const tall = settle(capped(20, 200)).frame.h;
    // The frame grows with its content up to the cap and no further, which is
    // the whole difference from an explicit `h`: with `h: 200` the short case
    // would be exactly as tall as the long one.
    expect(short).toBeLessThan(tall);
    expect(tall - short).toBeGreaterThan(100);
  });

  it("is a ceiling and not a floor — minH still wins a contradiction", () => {
    const out = settle(() =>
      panel({ x: 0, y: 0, w: 200, title: "BOX", id: "frame" }, () => {
        col({ overflow: "auto", gap: 0, maxH: 30, minH: 90, id: "region" }, () => {
          for (let i = 0; i < 20; i += 1) text(`line ${i}`, { id: `line${i}`, h: LINE } as never);
        });
      }),
    );
    expect(out.region.h).toBe(90);
  });
});

describe("maxW, the horizontal twin", () => {
  /** A scrolling ROW is bounded on its width the way a scrolling col is on its
   *  height, and reads `maxW` for the same reason. */
  const strip = (cells: number, maxW: number) => () =>
    panel({ x: 0, y: 0, h: 80, title: "BOX", id: "frame" }, () => {
      row({ overflow: "auto", gap: 0, maxW, id: "region" }, () => {
        for (let i = 0; i < cells; i += 1) text(`c${i}`, { id: `c${i}`, w: 40 } as never);
      });
    });

  it("takes the content's own width while the content fits", () => {
    expect(settle(strip(3, 300)).region.w).toBe(3 * 40);
  });

  it("stops at the cap once the content passes it", () => {
    expect(settle(strip(20, 300)).region.w).toBe(300);
  });
});
