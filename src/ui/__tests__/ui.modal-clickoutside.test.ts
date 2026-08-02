// `modal({ onClickOutside })` — the click-away gesture.
//
// The pointer edge these tests set is `frameReleased`, not `released`: an
// overlay decides during the DRAW phase, and `released` is the fixed-step edge
// that a stepless frame never sees.
//
// The thing worth pinning is that the test uses the dialog's COMMITTED rect,
// not the width it was asked for. An auto-sized dialog does not know its height
// until its children have run, so a naive implementation reads a stale or
// fallback height and then disagrees with the pixels about where "outside"
// starts — the click 20px under a shrink-wrapped dialog either closes nothing
// or closes it from inside the frame the player can see.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, modal, text } from "@src/ui/api.js";
import { lastContainerRect } from "@src/ui/core/index.js";
import { registerUiApp, selectUiApp } from "@src/ui/core/state.js";
import type { App } from "@src/engine/index.js";

function mockCtx() {
  return {
    canvas: { width: 800, height: 600, style: {}, hasAttribute: () => true, focus: vi.fn() },
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
    arc: vi.fn(),
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

function testApp() {
  const ctx = mockCtx();
  const frameHooks: (() => void)[] = [];
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
    setCursor: noop,
    onStep: () => unsubscribe,
    onFrame: (fn: () => void) => {
      frameHooks.push(fn);
      return unsubscribe;
    },
  } as unknown as App;
  const registered = registerUiApp(app);
  selectUiApp(registered);
  return {
    pointer,
    // The frame-end hooks deselect the app, so every frame re-selects it —
    // the engine does the same thing at the top of its draw.
    beginFrame: () => selectUiApp(registered),
    endFrame: () => frameHooks.forEach((fn) => fn()),
  };
}

let fx: ReturnType<typeof testApp>;
let outside: number;
/** The dialog's rect as the last frame actually committed it. */
let dialog: { x: number; y: number; w: number; h: number };

beforeEach(() => {
  _reset();
  fx = testApp();
  outside = 0;
  dialog = { x: 0, y: 0, w: 0, h: 0 };
});

/** One frame of a modal with three lines of body text. */
function frame(opts: { lines?: number; onClickOutside?: boolean } = {}): void {
  fx.beginFrame();
  modal(
    {
      w: 360,
      title: "PAUSED",
      ...(opts.onClickOutside === false ? {} : { onClickOutside: () => outside++ }),
    },
    () => {
      for (let i = 0; i < (opts.lines ?? 3); i++) text(`line ${i}`);
    },
  );
  // Read the committed rect through the same accessor the widget uses, so the
  // test measures what the implementation measured rather than re-deriving it.
  // It has to be read INSIDE the frame — the slot is per-app and the frame-end
  // hooks deselect the app.
  dialog = lastContainerRect() ?? dialog;
  fx.endFrame();
}

/** Settle the auto-size cache, then release the pointer at (x, y). */
function releaseAt(x: number, y: number): void {
  frame();
  frame();
  expect(dialog.h, "the dialog must have committed a rect").toBeGreaterThan(0);
  fx.pointer.x = x;
  fx.pointer.y = y;
  fx.pointer.down = false;
  fx.pointer.frameReleased = true;
  frame();
}

describe("modal onClickOutside", () => {
  it("fires when the release lands on the backdrop", () => {
    releaseAt(20, 20);
    expect(outside).toBe(1);
  });

  it("does not fire when the release lands on the dialog", () => {
    frame();
    frame();
    fx.pointer.x = dialog.x + dialog.w / 2;
    fx.pointer.y = dialog.y + dialog.h / 2;
    fx.pointer.frameReleased = true;
    frame();
    expect(outside).toBe(0);
  });

  it("ignores the release on the very first frame — that click opened it", () => {
    fx.pointer.x = 20;
    fx.pointer.y = 20;
    fx.pointer.frameReleased = true;
    frame();
    expect(outside).toBe(0);
  });

  it("does nothing when no handler is given", () => {
    frame({ onClickOutside: false });
    frame({ onClickOutside: false });
    fx.pointer.x = 20;
    fx.pointer.y = 20;
    fx.pointer.frameReleased = true;
    expect(() => frame({ onClickOutside: false })).not.toThrow();
    expect(outside).toBe(0);
  });

  it("does not fire while the pointer is merely held down outside", () => {
    frame();
    frame();
    fx.pointer.x = 20;
    fx.pointer.y = 20;
    fx.pointer.down = true;
    fx.pointer.frameReleased = false;
    frame();
    expect(outside).toBe(0);
  });

  // The regression that motivates `lastContainerRect`: a tall dialog and a
  // short one put "outside" in different places, and only the committed rect
  // knows which. With a stale or default height these two assertions cannot
  // both hold.
  it("measures outside against the dialog's own auto-sized height", () => {
    // A tall dialog: a point low on the screen is INSIDE it.
    frame({ lines: 14 });
    frame({ lines: 14 });
    const tall = { ...dialog };
    expect(tall.h).toBeGreaterThan(200);
    fx.pointer.x = tall.x + 10;
    fx.pointer.y = tall.y + tall.h - 5;
    fx.pointer.frameReleased = true;
    frame({ lines: 14 });
    expect(outside, "a point inside a tall dialog is not outside").toBe(0);

    // The SAME point, with a dialog shrink-wrapped to one line, is outside it.
    _reset();
    fx = testApp();
    outside = 0;
    frame({ lines: 1 });
    frame({ lines: 1 });
    const short = { ...dialog };
    expect(short.h).toBeLessThan(tall.h);
    fx.pointer.x = tall.x + 10;
    fx.pointer.y = tall.y + tall.h - 5;
    fx.pointer.frameReleased = true;
    frame({ lines: 1 });
    expect(outside, "the same point past a short dialog is outside").toBe(1);
  });

  it("works in the value form, which has an explicit height", () => {
    const draw = (): void => {
      fx.beginFrame();
      const r = modal({ w: 300, h: 200, title: "V", onClickOutside: () => outside++ });
      dialog = r;
      fx.endFrame();
    };
    draw();
    fx.pointer.x = dialog.x + 5;
    fx.pointer.y = dialog.y + 5;
    fx.pointer.frameReleased = true;
    draw();
    expect(outside, "inside the dialog").toBe(0);

    fx.pointer.x = 5;
    fx.pointer.y = 5;
    fx.pointer.frameReleased = true;
    draw();
    expect(outside, "on the backdrop").toBe(1);
  });
});
