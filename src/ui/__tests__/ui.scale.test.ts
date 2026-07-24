// UI-scale verification, with a REAL app loop + dispatched pointer events (the
// ui.mobile harness pattern): under `UI.scaled`/`setScale`, widget boxes AND
// text must land at the scaled screen positions, hit-testing must match what's
// drawn, sliders must stay draggable when other sliders sit behind a clip
// (the ui-gallery scale-slider bug), and the deferred select menu must anchor
// at the control's on-screen position. Also exercises the `layoutCapture`
// harness those assertions ride on.
//
// The 2D mock here TRACKS the canvas transform (save/restore/translate/scale/
// setTransform) and records fillRect/fillText in DEVICE coords — so a widget
// that draws at reference coords under a wiped transform (the "text doesn't
// reposition" bug) is caught, not hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../engine/index.js";
import {
  _reset,
  bar,
  begin,
  button,
  clip,
  col,
  layoutCapture,
  layoutTree,
  scaled,
  scrollbar,
  select,
  slider,
  text,
} from "../index.js";

let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

interface CtxCalls {
  /** fillText in DEVICE coords: [text, x, y]. */
  fillText: [string, number, number][];
  /** fillRect / path-rect in DEVICE coords: [x, y, w, h]. */
  rects: [number, number, number, number][];
}

// A 2D mock with a live (scale + translate) transform, so recorded draw calls
// land in DEVICE coords like a real canvas.
function makeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D & { _calls: CtxCalls } {
  const calls: CtxCalls = { fillText: [], rects: [] };
  let m = { sx: 1, sy: 1, tx: 0, ty: 0 };
  const stack: (typeof m)[] = [];
  return {
    canvas,
    save: () => stack.push({ ...m }),
    restore: () => {
      m = stack.pop() ?? m;
    },
    setTransform: (a: number, _b: number, _c: number, d: number, e: number, f: number) => {
      m = { sx: a, sy: d, tx: e, ty: f };
    },
    translate: (dx: number, dy: number) => {
      m.tx += m.sx * dx;
      m.ty += m.sy * dy;
    },
    scale: (fx: number, fy: number) => {
      m.sx *= fx;
      m.sy *= fy;
    },
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    rect: (x: number, y: number, w: number, h: number) =>
      calls.rects.push([m.sx * x + m.tx, m.sy * y + m.ty, w * m.sx, h * m.sy]),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.rects.push([m.sx * x + m.tx, m.sy * y + m.ty, w * m.sx, h * m.sy]),
    fillText: (t: string, x: number, y: number) =>
      calls.fillText.push([t, m.sx * x + m.tx, m.sy * y + m.ty]),
    measureText: (t: string) => ({ width: t.length * 10 }),
    globalAlpha: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    _calls: calls,
  } as unknown as CanvasRenderingContext2D & { _calls: CtxCalls };
}

const games: App[] = [];

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    const holder = this as HTMLCanvasElement & { __ctx?: CanvasRenderingContext2D };
    holder.__ctx ??= makeCtx(this);
    return holder.__ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
  rafCallback = null;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  _reset();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = origGc;
});

function build(draw: (game: App) => void): { game: App; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.id = "game";
  document.body.appendChild(canvas);
  const game = createApp({ canvas });
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: game.viewport.w,
    height: game.viewport.h,
    right: game.viewport.w,
    bottom: game.viewport.h,
    toJSON: () => ({}),
  });
  games.push(game);
  game.run({
    update: () => {},
    draw: () => {
      begin(game.ctx);
      draw(game);
    },
  });
  return { game, canvas };
}

let now = 0;
function tick(ms = 16): void {
  now += ms;
  const cb = rafCallback;
  rafCallback = null;
  cb?.(now);
}

const downAt = (canvas: HTMLCanvasElement, x: number, y: number) =>
  canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y }));
const moveTo = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
const upAt = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));

const ctxCalls = (game: App): CtxCalls => (game.ctx as unknown as { _calls: CtxCalls })._calls;

describe("drawing under UI.scaled", () => {
  it("widget boxes AND text land at the scaled screen positions", () => {
    const { game } = build(() => {
      scaled(2, () => {
        bar({ x: 10, y: 20, w: 100, h: 10, value: 1 });
        text("HELLO", { x: 10, y: 40, w: 100, h: 20 });
      });
    });
    tick();
    const calls = ctxCalls(game);
    // The bar's fill rect: reference (10,20,100,10) × 2 → device (20,40,200,20).
    expect(calls.rects).toContainEqual([20, 40, 200, 20]);
    // The text glyphs: slot (10,40,100,20), left-aligned, vertically centered →
    // reference (10, 50) × 2 → device (20, 100). Before the fix, text() wiped
    // the scaled canvas transform and drew at (10, 50).
    const hello = calls.fillText.find(([t]) => t === "HELLO");
    expect(hello).toBeDefined();
    expect(hello![1]).toBe(20);
    expect(hello![2]).toBe(100);
  });
});

describe("hit-testing under UI.scaled", () => {
  it("a scaled button is pressed at its ON-SCREEN position, not its reference one", () => {
    let clicked = false;
    const { canvas } = build(() => {
      scaled(2, () => {
        if (button({ x: 40, y: 40, w: 100, h: 30, label: "GO", id: "go" })) clicked = true;
      });
    });
    tick();
    // Screen center of the drawn button: reference (90, 55) × 2 = (180, 110).
    downAt(canvas, 180, 110);
    tick();
    upAt(180, 110);
    tick();
    expect(clicked).toBe(true);

    // Clicking where the button would sit UNSCALED must miss.
    clicked = false;
    downAt(canvas, 90, 55);
    tick();
    upAt(90, 55);
    tick();
    expect(clicked).toBe(false);
  });
});

describe("slider drags vs clipped siblings (the ui-gallery scale slider)", () => {
  it("a native-space slider drags while other sliders sit inside a clipped scroll region", () => {
    // The gallery shape: a UI-scale slider in native space, driving a UI.scaled
    // board whose widgets (more sliders included) live inside a clipped scroll
    // column. Dragging the header slider used to drop instantly: the clipped
    // sliders saw a DEAD pointer and cleared the SHARED slider-drag slot.
    let scale = 1;
    let volume = 50;
    const { canvas } = build(() => {
      scale = slider({
        x: 20,
        y: 20,
        w: 200,
        value: scale,
        min: 0.75,
        max: 2,
        step: 0.25,
        id: "scale",
      });
      scaled(scale, () => {
        col({ x: 10, y: 40, w: 280, h: 130, overflow: "auto", id: "board" }, () => {
          volume = slider({ value: volume, min: 0, max: 100, id: "vol" });
          for (let i = 0; i < 10; i++) button({ label: `B${i}`, id: `b${i}` });
        });
      });
    });
    tick();
    // Press ON the header slider's track (sy = 35), then drag right.
    downAt(canvas, 100, 35);
    tick();
    expect(scale).toBe(1.25); // track press jumps the value
    moveTo(180, 35);
    tick();
    expect(scale).toBe(1.75); // ...and the DRAG follows (used to stay at 1.25)
    upAt(180, 35);
    tick();
    expect(volume).toBe(50); // the clipped slider never moved
  });

  it("a slider inside a clip keeps its drag when the finger leaves the clip region", () => {
    let v = 50;
    const { canvas } = build(() => {
      clip({ x: 0, y: 80, w: 300, h: 100 }, () => {
        v = slider({ x: 20, y: 100, w: 200, value: v, min: 0, max: 100, id: "s" });
      });
    });
    tick();
    downAt(canvas, 120, 115); // on the track (sy = 115), inside the clip
    tick();
    expect(v).toBeCloseTo((100 / 158) * 100, 1);
    moveTo(160, 40); // finger strays ABOVE the clip mid-drag
    tick();
    expect(v).toBeCloseTo((140 / 158) * 100, 1); // still tracking
    upAt(160, 40);
    tick();
    const settled = v;
    moveTo(200, 115); // after release, moving must not drag
    tick();
    expect(v).toBe(settled);
  });
});

describe("scrollbar under UI.scaled", () => {
  it("the thumb is grabbed and dragged at its on-screen position", () => {
    let off = 0;
    const { canvas } = build(() => {
      scaled(2, () => {
        off = scrollbar({ x: 100, y: 10, h: 100, view: 100, content: 400, offset: off, id: "sb" });
      });
    });
    tick();
    // Thumb: reference (100,10,10,25) → screen (200,20,20,50). Grab its middle.
    downAt(canvas, 210, 30);
    tick();
    moveTo(210, 90); // screen +60 → reference +30 of a 75px range → offset 120
    tick();
    expect(off).toBeCloseTo(120, 5);
    upAt(210, 90);
    tick();
  });
});

describe("select menu under UI.scaled", () => {
  it("the deferred drop menu opens at the control's ON-SCREEN position", () => {
    let value = "a";
    const { game, canvas } = build(() => {
      scaled(2, () => {
        value = select({
          id: "sel",
          x: 10,
          y: 10,
          w: 100,
          h: 32,
          value,
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        }).value;
      });
    });
    tick();
    // Click the control at its screen position: reference (60, 26) × 2.
    downAt(canvas, 120, 52);
    tick();
    upAt(120, 52);
    tick(); // the release opens the editor; the menu draws in this frame's overlay pass
    const calls = ctxCalls(game);
    // Menu backdrop: control screen rect (20,20,200,64) → menu at y = 20+64+2,
    // 2 options × 30 + 2×2 pad = 64 tall. Unscaled-anchor bug would put it at
    // (10, 44, 100, 64).
    expect(calls.rects).toContainEqual([20, 86, 200, 64]);
    expect(calls.rects).not.toContainEqual([10, 44, 100, 64]);
  });
});

describe("layoutCapture", () => {
  it("records nothing while disabled", () => {
    const { game } = build(() => {
      button({ x: 10, y: 10, w: 80, h: 30, label: "T", id: "t" });
    });
    tick();
    tick();
    begin(game.ctx); // the tree lives on the app's UI runtime
    expect(layoutTree()).toEqual([]);
  });

  it("captures kind/id, reference rect, screen rect and scale under UI.scaled", () => {
    layoutCapture(true);
    const { game } = build(() => {
      scaled(2, () => {
        col({ x: 10, y: 10, w: 120, gap: 8, id: "root" }, () => {
          button({ label: "GO", id: "go" });
          text("hi", {});
        });
      });
    });
    tick();
    tick(); // second frame: the auto-sized column has settled
    begin(game.ctx); // the tree lives on the app's UI runtime
    const tree = layoutTree();
    const root = tree.find((e) => e.id === "root")!;
    const btn = tree.find((e) => e.id === "go")!;
    const txt = tree.find((e) => e.kind === "text")!;
    expect(root.kind).toBe("col");
    expect(btn.kind).toBe("button");

    // Scale + screen mapping: everything inside scaled(2) doubles.
    for (const e of [root, btn, txt]) {
      expect(e.scale).toBe(2);
      expect(e.screenRect).toEqual({
        x: e.rect.x * 2,
        y: e.rect.y * 2,
        w: e.rect.w * 2,
        h: e.rect.h * 2,
      });
    }

    // Containment: children sit inside their container, on screen too.
    for (const e of [btn, txt]) {
      expect(e.screenRect.x).toBeGreaterThanOrEqual(root.screenRect.x);
      expect(e.screenRect.y).toBeGreaterThanOrEqual(root.screenRect.y);
      expect(e.screenRect.x + e.screenRect.w).toBeLessThanOrEqual(
        root.screenRect.x + root.screenRect.w,
      );
      expect(e.screenRect.y + e.screenRect.h).toBeLessThanOrEqual(
        root.screenRect.y + root.screenRect.h,
      );
    }
    // Siblings don't overlap: the text flows below the button.
    expect(txt.rect.y).toBeGreaterThanOrEqual(btn.rect.y + btn.rect.h);
  });

  it("turning capture off clears the tree", () => {
    layoutCapture(true);
    const { game } = build(() => {
      button({ x: 10, y: 10, w: 80, h: 30, label: "T", id: "t" });
    });
    tick();
    begin(game.ctx); // the tree lives on the app's UI runtime
    expect(layoutTree().length).toBeGreaterThan(0);
    layoutCapture(false);
    expect(layoutTree()).toEqual([]);
  });
});
