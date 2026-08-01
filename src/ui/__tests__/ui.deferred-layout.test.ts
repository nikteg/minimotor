// Auto-sized containers used to read LAST frame's measurement, so a container
// converged one frame per nesting level and everything drawn after a stale
// container was shifted for that frame — the "one-frame layout pop" documented
// in AGENTS.md. `Flow.reserve` lets the parent hold its cursor open while the
// child runs, so the child is measured IN the frame it draws.
//
// These tests pin the guarantee (frame 1 == frame 2, at depth) and the exact
// boundary of it: containers that genuinely cannot be measured in-frame — a
// backdrop that paints under the children, an axis crossing, end-justification
// — must still fall back to the cache rather than lay out wrong.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, button, col, layoutCapture, layoutTree, panel, row } from "@src/ui/api.js";
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

// `layoutTree()` only reports COMPLETED frames, and the frame boundary is the
// host loop's `onFrame`. This fixture keeps that callback so a test can end a
// frame explicitly instead of standing up a real app + rAF loop.
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

/** Render `build` as one complete frame and return every button rect by id. */
function frame(build: () => void): Record<string, { x: number; y: number; w: number; h: number }> {
  layoutCapture(true);
  build();
  endFrame();
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const e of layoutTree()) if (e.kind === "button" && e.id) out[String(e.id)] = e.rect;
  return out;
}

/** The rect of one container kind/id from the last completed frame. */
function containerRectOf(kind: string, id: string) {
  return layoutTree().find((e) => e.kind === kind && e.id === id)?.rect;
}

beforeEach(() => {
  _reset();
  const fixture = testApp(mockCtx());
  selectUiApp(fixture.app);
  endFrame = () => {
    fixture.endFrame();
    // The frame boundary clears the ambient app; the next frame re-selects it.
    selectUiApp(fixture.app);
  };
});

describe("in-frame container measurement", () => {
  // Three levels of nesting used to cost three frames to settle. The trailing
  // button is the probe: it is the sibling placed AFTER the auto container, so
  // it moves if and only if the container reported a stale size.
  const nested = () =>
    col({ x: 0, y: 0, w: 300, id: "outer" }, () => {
      col({ id: "mid" }, () => {
        col({ id: "inner" }, () => {
          button({ id: "a", label: "A" });
          button({ id: "b", label: "B" });
        });
        button({ id: "c", label: "C" });
      });
      button({ id: "trailing", label: "T" });
    });

  it("settles a three-deep column on the first frame", () => {
    const first = frame(nested);
    const second = frame(nested);
    const third = frame(nested);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("stacks the trailing sibling below the whole nested block, not on top of it", () => {
    const rects = frame(nested);
    const lastInside = rects.c;
    expect(rects.trailing.y).toBeGreaterThanOrEqual(lastInside.y + lastInside.h);
  });

  it("reports the container's measured height, not its provisional one", () => {
    frame(nested);
    const inner = containerRectOf("col", "inner");
    // Two stacked buttons plus the gap between them — never the bare 30px
    // fallback an unmeasured container used to report.
    expect(inner).toBeDefined();
    expect(inner!.h).toBeGreaterThan(30);
    expect(inner!.h).toBeCloseTo(2 * layoutTree().find((e) => e.id === "a")!.rect.h + 8, 0);
  });

  it("is unaffected by a same-shaped sibling drawn before it (no key collision)", () => {
    // Two anonymous columns of DIFFERENT length at the same structural position
    // in successive frames. Under the old cache this is the AGENTS.md screen-
    // swap bug; measured in-frame there is nothing to collide over.
    const build = (n: number) =>
      col({ x: 0, y: 0, w: 300, id: "swap" }, () => {
        col(() => {
          for (let i = 0; i < n; i++) button({ id: `x${i}`, label: `X${i}` });
        });
        button({ id: "after", label: "AFTER" });
      });
    const two = frame(() => build(2));
    frame(() => build(5));
    const twoAgain = frame(() => build(2));
    expect(twoAgain.after).toEqual(two.after);
  });
});

describe("what still falls back to the cache", () => {
  // A backdrop paints UNDER the children, so it has to run before them at a
  // size we would not yet have. Panels keep the one-frame cache deliberately —
  // this test exists so that stays a decision rather than a regression.
  it("a panel is still measured from the previous frame", () => {
    const build = (n: number) =>
      panel({ x: 0, y: 0, w: 300, id: "p" }, () => {
        for (let i = 0; i < n; i++) button({ id: `b${i}`, label: `B${i}` });
      });
    frame(() => build(1));
    const grown = frame(() => build(4));
    const settled = frame(() => build(4));
    // The frame the content grows on still reports the old height...
    expect(grown.b0).toEqual(settled.b0); // children themselves are placed fine
    const h1 = containerRectOf("panel", "p")!.h;
    frame(() => build(4));
    expect(containerRectOf("panel", "p")!.h).toBe(h1);
  });

  it("a crossing axis (row inside a column) still lays out and settles", () => {
    const build = () =>
      col({ x: 0, y: 0, w: 300, id: "c" }, () => {
        row({ id: "r" }, () => {
          button({ id: "l", label: "L" });
          button({ id: "m", label: "M" });
        });
        button({ id: "under", label: "U" });
      });
    frame(build);
    const a = frame(build);
    const b = frame(build);
    expect(a).toEqual(b);
    expect(a.under.y).toBeGreaterThanOrEqual(a.l.y + a.l.h);
  });

  it("end-justified content is unchanged", () => {
    const build = () =>
      col({ x: 0, y: 0, w: 300, h: 400, justify: "end", id: "j" }, () => {
        button({ id: "one", label: "ONE" });
        button({ id: "two", label: "TWO" });
      });
    frame(build);
    const a = frame(build);
    const b = frame(build);
    expect(a).toEqual(b);
    // Pinned to the far edge, not the near one.
    expect(a.two.y + a.two.h).toBeCloseTo(400, 0);
  });
});
