// Equal-fill: several `flex: "fill"` children share leftover main-axis space
// without a caller-supplied count. The split uses last frame's fill-call count
// (1 when missing), so a lone fill still takes everything on frame one and a
// count change settles on the next frame.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, button, layoutCapture, layoutTree, row } from "@src/ui/api.js";
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

function testApp(ctx: CanvasRenderingContext2D) {
  const frameHooks: (() => void)[] = [];
  const noop = (): void => {};
  const unsubscribe = (): void => {};
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
    Loop: { step: 1000 / 60, steps: 0, onStep: () => unsubscribe, onFrame: () => unsubscribe },
    resetTransform: noop,
    setCursor: noop,
    onStep: () => unsubscribe,
    onFrame: (fn: () => void) => {
      frameHooks.push(fn);
      return unsubscribe;
    },
  } as unknown as App;
  return { app: registerUiApp(app), endFrame: () => frameHooks.forEach((fn) => fn()) };
}

let endFrame: () => void;

function frame(build: () => void): Record<string, { x: number; y: number; w: number; h: number }> {
  layoutCapture(true);
  build();
  endFrame();
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const e of layoutTree()) if (e.kind === "button" && e.id) out[String(e.id)] = e.rect;
  return out;
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

const ROW = { x: 0, y: 0, w: 300, gap: 10, pad: 0, id: "fills" } as const;

function fillRow(n: number) {
  row({ ...ROW }, () => {
    for (let i = 0; i < n; i++) button({ id: `f${i}`, label: `${i}`, flex: "fill" });
  });
}

function expectEqualFills(
  rects: Record<string, { x: number; y: number; w: number; h: number }>,
  n: number,
) {
  const gap = ROW.gap * (n - 1);
  const share = (ROW.w - gap) / n;
  let x = ROW.x;
  for (let i = 0; i < n; i++) {
    expect(rects[`f${i}`].w).toBeCloseTo(share, 5);
    expect(rects[`f${i}`].x).toBeCloseTo(x, 5);
    x += share + ROW.gap;
  }
  const last = rects[`f${n - 1}`];
  expect(last.x + last.w).toBeCloseTo(ROW.w, 5);
}

describe("automatic equal-fill", () => {
  it("splits a known-width row equally after two frames, with no fillChildren", () => {
    const build = () => fillRow(2);
    frame(build);
    const settled = frame(build);
    expectEqualFills(settled, 2);
  });

  it("re-equalizes on the second frame after a fill child is added", () => {
    frame(() => fillRow(2));
    frame(() => fillRow(2));
    frame(() => fillRow(3));
    const settled = frame(() => fillRow(3));
    expectEqualFills(settled, 3);
  });

  it("re-equalizes on the second frame after a fill child is removed", () => {
    frame(() => fillRow(3));
    frame(() => fillRow(3));
    frame(() => fillRow(2));
    const settled = frame(() => fillRow(2));
    expectEqualFills(settled, 2);
  });

  it("lets a single fill() take the remaining space on the first frame", () => {
    const rects = frame(() =>
      row({ ...ROW }, () => {
        button({ id: "fixed", label: "F", w: 50 });
        button({ id: "fill", label: "X", flex: "fill" });
      }),
    );
    expect(rects.fixed.w).toBe(50);
    expect(rects.fill.w).toBe(ROW.w - 50 - ROW.gap);
    expect(rects.fill.x).toBe(50 + ROW.gap);
  });
});
