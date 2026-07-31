// Pointer-gesture behaviors that need a REAL game loop: momentum flings,
// widget drags claiming the pointer away from body scroll, scroll-end not
// closing overlays, mid-gesture chaining to an enclosing region, and the
// native press listener that opens the mobile keyboard synchronously.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../engine/index.js";
import { createUiRuntime, switchRuntime } from "../core/runtime.js";
import {
  _reset,
  button,
  dragScroll,
  drawFloatText,
  floatText,
  lastRect,
  popover,
  slider,
  textInput,
} from "../api.js";

// jsdom canvas support + a controllable requestAnimationFrame (same pattern as
// the engine tests) — plus a fuller 2D mock so widgets can draw.
let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

interface CtxCalls {
  fillText: [string, number, number][];
  rects: [number, number, number, number][];
}

function makeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D & { _calls: CtxCalls } {
  const calls: CtxCalls = { fillText: [], rects: [] };
  return {
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
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
    setTransform: vi.fn(),
    strokeRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    rect: (x: number, y: number, w: number, h: number) => calls.rects.push([x, y, w, h]),
    fillRect: (x: number, y: number, w: number, h: number) => calls.rects.push([x, y, w, h]),
    fillText: (t: string, x: number, y: number) => calls.fillText.push([t, x, y]),
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

function build(draw: (game: App) => void): {
  game: App;
  canvas: HTMLCanvasElement;
} {
  const canvas = document.createElement("canvas");
  canvas.id = "game";
  document.body.appendChild(canvas);
  const game = createApp(canvas, { fullscreen: false });
  // Raw widget API instead of createUI, so this harness does what createUI
  // does: build the runtime for this app and select it each frame.
  const rt = createUiRuntime(game.ctx, game);
  // jsdom reports a zero-sized rect, which maps every pointer event to (0,0) —
  // pretend the canvas fills the window so client coords pass through 1:1.
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
  game.Loop.run({
    update: () => {},
    draw: () => {
      switchRuntime(rt);
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

describe("momentum scrolling", () => {
  it("a fast swipe keeps scrolling after release, decaying to a stop", () => {
    let offset = 0;
    const { canvas } = build(() => {
      offset = dragScroll("m", { x: 0, y: 0, w: 300, h: 400 }, "y", offset, 1000);
    });
    tick(); // prime
    downAt(canvas, 150, 300);
    tick();
    for (const y of [280, 260, 240]) {
      moveTo(150, y);
      tick();
    }
    expect(offset).toBeGreaterThan(0); // dragged ~60px minus nothing (threshold spent within)
    upAt(150, 240);
    tick(); // release frame — fling launches
    const atRelease = offset;
    tick();
    expect(offset).toBeGreaterThan(atRelease); // coasting after the finger lifted
    for (let i = 0; i < 200; i++) tick();
    const settled = offset;
    tick();
    expect(offset).toBe(settled); // decayed to a stop
  });

  it("a pointercancel ends the drag and the next swipe still scrolls", () => {
    // iOS fires pointercancel (never pointerup) when the system claims a
    // gesture mid-drag. The drag must end — not stick "down" forever — and a
    // fresh swipe afterwards must scroll normally.
    let offset = 0;
    const { canvas } = build(() => {
      offset = dragScroll("pc", { x: 0, y: 0, w: 300, h: 400 }, "y", offset, 1000);
    });
    tick();
    downAt(canvas, 150, 300);
    tick();
    moveTo(150, 290); // slow drag: past the 6px threshold, below fling speed
    tick();
    moveTo(150, 288);
    tick();
    expect(offset).toBeGreaterThan(0);
    window.dispatchEvent(new Event("pointercancel"));
    for (let i = 0; i < 10; i++) tick(); // any residual coast dies out
    const settled = offset;
    moveTo(150, 200); // moves after the cancel must NOT scroll (down ended)
    tick();
    moveTo(150, 100);
    tick();
    expect(offset).toBe(settled);
    downAt(canvas, 150, 300); // a fresh swipe works
    tick();
    moveTo(150, 250);
    tick();
    expect(offset).toBeGreaterThan(settled);
    upAt(150, 250);
    tick();
  });

  it("a press inside the region catches (stops) a running fling", () => {
    let offset = 0;
    const { canvas } = build(() => {
      offset = dragScroll("m2", { x: 0, y: 0, w: 300, h: 400 }, "y", offset, 1000);
    });
    tick();
    downAt(canvas, 150, 300);
    tick();
    for (const y of [280, 260, 240]) {
      moveTo(150, y);
      tick();
    }
    upAt(150, 240);
    tick();
    tick(); // coasting
    const coasting = offset;
    expect(coasting).toBeGreaterThan(0);
    downAt(canvas, 150, 200); // catch
    tick();
    const caught = offset;
    upAt(150, 200);
    for (let i = 0; i < 5; i++) tick();
    expect(offset).toBe(caught); // no further coast after the catch
  });
});

describe("widget drags claim the pointer away from body scroll", () => {
  it("dragging a slider inside a scroll region does not scroll the region", () => {
    let offset = 0;
    let value = 50;
    const { canvas } = build(() => {
      offset = dragScroll("region", { x: 0, y: 0, w: 300, h: 400 }, "y", offset, 500);
      value = slider({ x: 20, y: 90, w: 200, value, min: 0, max: 100, id: "s" });
    });
    tick();
    // Press ON the slider track (y ≈ 105 center), then drag diagonally far
    // enough that body scroll would normally engage.
    downAt(canvas, 120, 105);
    tick();
    for (const [x, y] of [
      [140, 130],
      [160, 160],
      [180, 200],
    ] as const) {
      moveTo(x, y);
      tick();
    }
    expect(value).not.toBe(50); // the slider followed the pointer x
    expect(offset).toBe(0); // ...and the region never scrolled
    upAt(180, 200);
    tick();
  });
});

describe("overlay close vs scroll gestures", () => {
  it("a swipe that starts inside a popover and ends outside does not close it", () => {
    let open = true;
    let offset = 0;
    const { canvas } = build(() => {
      open = popover({ x: 0, y: 0, w: 200, h: 150, open, id: "p" });
      if (open) {
        offset = dragScroll("inner", { x: 10, y: 10, w: 150, h: 100 }, "y", offset, 300);
      }
    });
    tick();
    tick(); // popover marks itself open (wasOpen) before any close can fire
    downAt(canvas, 50, 80);
    tick();
    moveTo(60, 40); // an active drag (>6px)
    tick();
    moveTo(80, 300); // finger wanders OUTSIDE the popover mid-gesture
    tick();
    upAt(80, 300); // ...and lifts outside
    tick();
    tick();
    expect(open).toBe(true); // scroll-end is not a click-outside

    // A real click outside still closes it.
    downAt(canvas, 250, 300);
    tick();
    upAt(250, 300);
    tick();
    expect(open).toBe(false);
  });
});

describe("mid-gesture scroll chaining", () => {
  it("an inner region pinned at its end hands the drag to the enclosing region", () => {
    let outer = 0;
    let inner = 0;
    const { canvas } = build(() => {
      // Parents draw first — same order the real containers run in.
      outer = dragScroll("outer", { x: 0, y: 0, w: 300, h: 400 }, "y", outer, 500);
      inner = dragScroll("inner", { x: 50, y: 50, w: 200, h: 100 }, "y", inner, 40);
    });
    tick();
    downAt(canvas, 150, 140); // inside BOTH; innermost claims
    tick();
    let y = 140;
    // Keep pulling up well past the inner region's 40px of scroll.
    for (let i = 0; i < 8; i++) {
      y -= 16;
      moveTo(150, y);
      tick();
    }
    expect(inner).toBe(40); // pinned at its end
    expect(outer).toBeGreaterThan(0); // ...and the surplus moved the outer region
    upAt(150, y);
    tick();
  });
});

describe("mobile text input", () => {
  it("a native pointerdown on the field focuses the hidden input synchronously", () => {
    let value = "";
    const { canvas } = build(() => {
      const r = textInput({ id: "chat", value, x: 20, y: 20, w: 180, h: 32 });
      value = r.value;
    });
    tick();
    tick(); // publish this frame's press targets for the native listener
    expect(document.querySelector("input")).toBeNull(); // no editor yet
    downAt(canvas, 60, 36); // inside the field — the LISTENER opens the editor
    const input = document.querySelector("input");
    expect(input).not.toBeNull(); // created synchronously, inside the gesture
    expect(document.activeElement).toBe(input);
    upAt(60, 36);
    tick();
  });

  it("a pointerdown outside every field opens nothing", () => {
    const { canvas } = build(() => {
      textInput({ id: "chat", value: "", x: 20, y: 20, w: 180, h: 32 });
    });
    tick();
    tick();
    downAt(canvas, 400, 300);
    expect(document.querySelector("input")).toBeNull();
    upAt(400, 300);
  });
});

describe("anchored floaters (flow-aware x/y-less API)", () => {
  it("lastRect() reports the most recently placed widget", () => {
    build(() => {
      button({ x: 10, y: 10, w: 100, h: 30, label: "T" });
      expect(lastRect()).toEqual({ x: 10, y: 10, w: 100, h: 30 });
    });
    tick();
    tick();
  });

  it("floatText without x/y rises from the last widget's top-center", () => {
    let spawned = false;
    const { game } = build(() => {
      button({ x: 10, y: 10, w: 100, h: 30, label: "T" });
      if (!spawned) {
        spawned = true;
        floatText("+1", { life: 10_000 });
      }
      drawFloatText();
    });
    tick();
    tick();
    const calls = (game.ctx as unknown as { _calls: CtxCalls })._calls;
    const pop = calls.fillText.find(([t]) => t === "+1");
    expect(pop).toBeDefined();
    expect(pop![1]).toBe(60); // 10 + 100/2
    expect(pop![2]).toBeLessThanOrEqual(6); // 10 - 4, minus a step of rise
  });

  it("popover without x/y opens under the last widget", () => {
    const { game } = build(() => {
      button({ x: 10, y: 10, w: 100, h: 30, label: "T" });
      popover({ w: 200, h: 120, open: true, id: "a" });
    });
    tick();
    const calls = (game.ctx as unknown as { _calls: CtxCalls })._calls;
    // The popover frame paints at the anchor: x=10, y=10+30+4=44.
    expect(calls.rects.some(([x, y]) => x === 10 && y === 44)).toBe(true);
  });
});
