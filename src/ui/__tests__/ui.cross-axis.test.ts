// Cross-axis layout: `alignCross` (flexbox's `align-items`) and `fitCross`
// (hug the cross axis instead of stretching children across it).
//
// Before these existed, a compact line — an 8px colour swatch beside a label —
// could only be built by pinning the row's height to a magic number, because a
// child with no height of its own stretches to fill the row and a child with
// one sits at the row's top edge. `samples/netroom`'s player roster was exactly
// that, and is the case these tests are drawn from.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, bar, button, col, layoutCapture, layoutTree, row, text } from "@src/ui/api.js";
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

/** Settle, then return the frame after — what a player actually looks at. */
function settled(build: () => void, frames = 4) {
  let last = frame(build);
  for (let i = 1; i < frames; i++) last = frame(build);
  return last;
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

/** The netroom roster line: an 8px swatch and a label. */
const roster = (opts: Record<string, unknown>) =>
  col({ x: 0, y: 0, w: 260, id: "panel" }, () => {
    row({ id: "seat", gap: 8, ...opts }, () => {
      bar({ id: "swatch", value: 1, w: 8, h: 8, fill: "#f0f", bg: "#f0f" });
      text("P1 you", { id: "label", size: 11 } as never);
    });
    button({ id: "after", label: "AFTER" });
  });

describe("fitCross", () => {
  it("hugs the tallest child instead of the standard control height", () => {
    const stretched = settled(() => roster({}));
    _reset();
    const fixture = testApp(mockCtx());
    selectUiApp(fixture.app);
    endFrame = () => {
      fixture.endFrame();
      selectUiApp(fixture.app);
    };
    const hugged = settled(() => roster({ fitCross: true }));
    // The label's own line height, not the theme's button height.
    expect(hugged.seat.h).toBeLessThan(stretched.seat.h);
    expect(hugged.seat.h).toBe(hugged.label.h);
  });

  it("leaves the child's natural cross size alone", () => {
    const r = settled(() => roster({ fitCross: true }));
    expect(r.swatch.h).toBe(8);
    // Stretched, the label would be as tall as the row; hugging, the row is as
    // tall as the label.
    expect(r.label.h).toBe(r.seat.h);
  });
});

describe("alignCross", () => {
  it("centres a short child on the row's centre line", () => {
    const r = settled(() => roster({ fitCross: true, alignCross: "center" }));
    const swatchMid = r.swatch.y + r.swatch.h / 2;
    const rowMid = r.seat.y + r.seat.h / 2;
    expect(swatchMid).toBeCloseTo(rowMid, 1);
  });

  it("start (the default) keeps it on the leading edge", () => {
    const r = settled(() => roster({ fitCross: true }));
    expect(r.swatch.y).toBe(r.seat.y);
  });

  it("end puts it on the trailing edge", () => {
    const r = settled(() => roster({ fitCross: true, alignCross: "end" }));
    expect(r.swatch.y + r.swatch.h).toBeCloseTo(r.seat.y + r.seat.h, 1);
  });

  it("settles rather than oscillating — the offset must not feed its own input", () => {
    // The centred child's position derives from the row's cross size, which is
    // measured from the children. A naive implementation walks the row 1px
    // taller every frame; these must be equal.
    const build = () => roster({ fitCross: true, alignCross: "center" });
    settled(build, 6);
    const a = frame(build);
    const b = frame(build);
    const c = frame(build);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("does not move a child that fills the cross axis — it has no slack", () => {
    const r = settled(() => roster({ alignCross: "center" }));
    expect(r.label.y).toBe(r.seat.y);
    expect(r.label.h).toBe(r.seat.h);
  });

  it("works across a column's horizontal axis too", () => {
    const build = () =>
      col({ x: 0, y: 0, w: 300, id: "c", alignCross: "center" }, () => {
        button({ id: "narrow", label: "N", w: 60 });
      });
    const r = settled(build);
    expect(r.narrow.x + r.narrow.w / 2).toBeCloseTo(r.c.x + r.c.w / 2, 1);
  });
});
