// `LayoutEntry.paintedRect`: the rect a container's own frame went down at,
// when that is not the rect the capture ends the frame reporting.
//
// The gap these are about. A container in a DEFERRED SLOT (`Flow.reserve`) is
// measured in the frame it draws, but its backdrop has to paint UNDER its
// children — so `autoContainer` calls `cfg.box` first, at the provisional size,
// and only `slot.commit`, after the children, knows the real one.
// `refreshLayoutRect` then reports the committed rect, which is right for every
// question about placement and wrong for the one question that is about pixels.
// `layoutLag` cannot see it either: a deferred container's lag is zero by
// construction, because the committed size IS its content.
//
// So the capture records both. Everything here is measured against the CANVAS —
// the geometry the fill path was actually issued at — rather than against
// another field of the same capture, because a capture agreeing with itself is
// exactly what this item found could be false.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reset,
  button,
  col,
  layoutCapture,
  layoutLag,
  layoutTree,
  paintIssues,
  panel,
  setTheme,
  text,
} from "@src/ui/api.js";
import { registerUiApp, selectUiApp } from "@src/ui/core/state.js";
import type { App } from "@src/engine/index.js";

/** Every rectangle the kit put on the canvas this frame, in issue order.
 *
 * `drawBox` fills through `roundRectPath`, which degenerates to a single
 * `ctx.rect(x, y, w, h)` once the radius is zero — so with `setTheme({ radius:
 * 0 })` below, the FIRST `rect` call after a panel's `drawBox` is that panel's
 * frame, at the coordinates the frame art really occupies. That is the only
 * witness in these tests that is not the capture itself. */
type Painted = { x: number; y: number; w: number; h: number };

function mockCtx(boxes: Painted[]) {
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
    rect: (x: number, y: number, w: number, h: number) => boxes.push({ x, y, w, h }),
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
let boxes: Painted[];

beforeEach(() => {
  _reset();
  boxes = [];
  const fixture = testApp(mockCtx(boxes));
  selectUiApp(fixture.app);
  // Square corners, so the fill path IS `ctx.rect` and the canvas can be read
  // back as rectangles. Nothing else in these tests depends on the radius.
  setTheme({ radius: 0 });
  endFrame = () => {
    fixture.endFrame();
    selectUiApp(fixture.app);
  };
});

/** Render one complete frame, and hand back the rectangles it painted. */
function frame(build: () => void): Painted[] {
  boxes.length = 0;
  layoutCapture(true);
  build();
  endFrame();
  return [...boxes];
}

const entry = (kind: string, id: string) =>
  layoutTree().find((e) => e.kind === kind && e.id === id);

/** The rectangle a named panel's own frame was painted at: the first box the
 *  canvas received whose top-left is the panel's, which `paintFrame` issues
 *  before anything inside it. */
const paintedFrameOf = (painted: Painted[], at: { x: number; y: number }): Painted | undefined =>
  painted.find((b) => Math.abs(b.x - at.x) <= 0.5 && Math.abs(b.y - at.y) <= 0.5);

/** A column holding a deferred panel whose body is `rows` buttons tall, then a
 *  sibling below it. The panel takes a slot from the column, so it is measured
 *  in-frame — and paints its backdrop before it knows the measurement. */
const screen = (rows: number) => () => {
  col({ x: 40, y: 40, w: 300, id: "root" }, () => {
    // Width stated, height not: the height is the axis the column's cursor is
    // waiting on and therefore the only one that can be deferred. It also keeps
    // `layoutLag` out of the width, which a shrink-wrapped cross axis in a
    // wider column would otherwise fill up with an unrelated finding.
    panel({ id: "card", w: 260 }, () => {
      for (let i = 0; i < rows; i++) button({ id: `row${i}`, label: `row ${i}` });
    });
    button({ id: "below", label: "below" });
  });
};

describe("a deferred container's painted rect", () => {
  it("is absent while the container's content is not changing", () => {
    frame(screen(3));
    const painted = frame(screen(3));
    const card = entry("panel", "card")!;
    expect(card.paintedRect).toBeUndefined();
    // ...and the settled `rect` really is the pixels, which is the claim the
    // absent field is making.
    expect(paintedFrameOf(painted, card.rect)).toEqual(card.rect);
  });

  /** THE ITEM. The frame the content shrinks, the panel's backdrop goes down at
   * the size it had last frame and the slot commits to the new one. Both are
   * true; the capture used to report only the second. */
  it("is the rect the canvas received, on the frame the content changes", () => {
    frame(screen(3));
    const painted = frame(screen(1));
    const card = entry("panel", "card")!;

    // The two rects disagree, which is the precondition — without it the
    // assertions below would hold for a capture that never recorded anything.
    expect(card.paintedRect).toBeDefined();
    expect(card.paintedRect!.h).toBeGreaterThan(card.rect.h);

    // MEASURED AGAINST THE CANVAS, not against another captured field: the
    // panel frame really was issued at `paintedRect`...
    expect(paintedFrameOf(painted, card.paintedRect!)).toEqual(card.paintedRect);
    // ...and was never issued at `rect`, the value the capture reports.
    expect(painted).not.toContainEqual(card.rect);

    // And the committed rect is still the placement truth: the sibling below
    // starts where the panel ended, not where it was drawn to.
    const below = entry("button", "below")!;
    expect(below.rect.y).toBeGreaterThanOrEqual(card.rect.y + card.rect.h);
    expect(below.rect.y).toBeLessThan(card.paintedRect!.y + card.paintedRect!.h);
  });

  it("is recorded when the content grows as well as when it shrinks", () => {
    frame(screen(1));
    const painted = frame(screen(3));
    const card = entry("panel", "card")!;
    expect(card.paintedRect!.h).toBeLessThan(card.rect.h);
    expect(paintedFrameOf(painted, card.paintedRect!)).toEqual(card.paintedRect);
  });

  /** WHY THE FIELD HAD TO EXIST rather than the existing one being read harder.
   * `layoutLag` is the capture's other admission that a box and its content
   * disagree, and it is silent here by construction: it compares the COMMITTED
   * rect against the measured content, and for a deferred container those are
   * the same number. Nothing else in the capture was going to say this. */
  it("is invisible to layoutLag, which is why it is its own field", () => {
    frame(screen(3));
    frame(screen(1));
    const card = entry("panel", "card")!;
    // The height is off by two rows on the canvas...
    expect(Math.abs(card.paintedRect!.h - card.rect.h)).toBeGreaterThan(40);
    // ...and `lag` says the height is exactly right, because it is: the
    // committed height IS the measured content. Both statements are true of the
    // same frame, which is the whole reason this needed a field of its own.
    expect(card.lag?.h ?? 0).toBe(0);
    expect(layoutLag().map((f) => f.entry.id)).not.toContain("card");
  });

  /** Never for a container that put no pixels down. A bare `col` has no
   * backdrop, so it has no second rect to be honest about however far its slot
   * moved — the same rule `LayoutEntry.paint` follows. */
  it("is never set on a container that painted nothing", () => {
    const inner = (rows: number) => () => {
      col({ x: 40, y: 40, w: 300 }, () => {
        col({ id: "bare" }, () => {
          for (let i = 0; i < rows; i++) text(`line ${i}`);
        });
      });
    };
    frame(inner(3));
    frame(inner(1));
    const bare = entry("col", "bare")!;
    expect(bare.paint).toBeUndefined();
    expect(bare.paintedRect).toBeUndefined();
  });
});

describe("paintIssues reads the painted rect", () => {
  /** The consequence the painted rect was added for. A box sitting in the band the
   * panel painted over but no longer occupies is an overlap on the CANVAS and
   * not in the committed geometry — so the occlusion check has to be looking at
   * the pixels to see it. */
  const overlapping = (rows: number, probe: { y: number; h: number }) => () => {
    col({ x: 40, y: 40, w: 300, id: "root" }, () => {
      panel({ id: "card" }, () => {
        for (let i = 0; i < rows; i++) button({ id: `row${i}`, label: `row ${i}` });
      });
    });
    // Pinned, so it is nobody's child and the ancestor exemption cannot excuse
    // the pair, and drawn after the panel so it is the one on top.
    panel({ id: "probe", x: 60, y: probe.y, w: 100, h: probe.h }, () => {});
  };

  it("reports a rect that only meets the panel where the panel was drawn", () => {
    // The panel's painted band on the changing frame, taken from the capture of
    // a settled three-row frame — real geometry, the way the overlay ordinal
    // sourced its popover rect.
    frame(overlapping(3, { y: 500, h: 20 }));
    const tall = entry("panel", "card")!.rect;
    const probe = { y: tall.y + tall.h - 12, h: 20 };

    // Settled at one row the probe sits clear of the panel entirely...
    frame(overlapping(1, probe));
    frame(overlapping(1, probe));
    expect(entry("panel", "card")!.paintedRect).toBeUndefined();
    expect(paintPairs()).not.toContain("card < probe");

    // ...and on the frame the panel shrinks from three rows to one, the frame
    // art is still down there and the probe is over it.
    frame(overlapping(3, probe));
    const painted = frame(overlapping(1, probe));
    const card = entry("panel", "card")!;
    expect(card.paintedRect).toBeDefined();
    expect(paintedFrameOf(painted, card.paintedRect!)).toEqual(card.paintedRect);
    expect(paintPairs()).toContain("card < probe");
  });
});

const paintPairs = (): string[] =>
  paintIssues().map((i) => `${i.under.id ?? i.under.kind} < ${i.over.id ?? i.over.kind}`);

describe("the paint ordinal is unchanged by any of this", () => {
  /** The reason the fix is a field and not a reordering. The alternative shape
   * — move `cfg.box` after `slot.commit` — would paint a panel's backdrop after
   * its own children, which is both wrong on the canvas and would invert the
   * paint ordinal: the panel's own draw would land after every child's
   * instead of before. This is that ordering, asserted, so the alternative
   * cannot be taken by accident. */
  it("still stamps a panel's frame before the widgets inside it", () => {
    frame(screen(3));
    frame(screen(1));
    const card = entry("panel", "card")!;
    const first = entry("button", "row0")!;
    expect(card.paint).toBeDefined();
    expect(first.paint).toBeDefined();
    expect(card.paint!).toBeLessThan(first.paint!);
  });
});
