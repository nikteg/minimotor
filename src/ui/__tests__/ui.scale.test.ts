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
import { createApp, type App } from "@src/engine/index.js";
import { selectUiApp } from "@src/ui/core/state.js";
import {
  _reset,
  bar,
  button,
  clip,
  col,
  drawFloatText,
  floatText,
  focusedId,
  fromScreen,
  height,
  layoutCapture,
  layoutIssues,
  layoutTree,
  modal,
  panel,
  row,
  scaled,
  scrollbar,
  select,
  setBaseSize,
  setScale,
  slider,
  text,
  toScreen,
  vh,
  vw,
  width,
} from "@src/ui/api.js";

let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

interface CtxCalls {
  /** fillText in DEVICE coords: [text, x, y]. */
  fillText: [string, number, number][];
  /** The device scale in force at each `fillText`, index-aligned with it — how
   *  big the glyphs actually came out. */
  textScale: number[];
  /** fillRect / path-rect in DEVICE coords: [x, y, w, h]. */
  rects: [number, number, number, number][];
}

// A 2D mock with a live (scale + translate) transform, so recorded draw calls
// land in DEVICE coords like a real canvas.
function makeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D & { _calls: CtxCalls } {
  const calls: CtxCalls = { fillText: [], textScale: [], rects: [] };
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
    fillText: (t: string, x: number, y: number) => {
      calls.fillText.push([t, m.sx * x + m.tx, m.sy * y + m.ty]);
      calls.textScale.push(m.sx);
    },
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

// The app build() made, so assertions outside the draw callback can select it.
let selectedApp: App;

function build(draw: (game: App) => void): {
  game: App;
  canvas: HTMLCanvasElement;
} {
  const canvas = document.createElement("canvas");
  canvas.id = "game";
  document.body.appendChild(canvas);
  const game = createApp(canvas, { fullscreen: false });
  // Raw widget API instead of createUI, so select the app each frame.
  selectedApp = game;
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
      selectUiApp(selectedApp);
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

// Auto-sized containers size from LAST frame's measurement, so a nest of them
// needs a frame per level to converge — settle before asserting on boxes.
function settle(frames = 6): void {
  for (let i = 0; i < frames; i++) tick();
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
  it("shows useful decimals for a default unit-range slider", () => {
    const { game } = build(() => {
      slider({ x: 20, y: 20, w: 200, value: 0.5, label: "Music", id: "music" });
    });
    tick();
    expect(ctxCalls(game).fillText.some(([text]) => text === "0.50")).toBe(true);
  });

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
    expect(scale).toBe(1.5); // track press jumps the value
    moveTo(180, 35);
    tick();
    expect(scale).toBe(2); // ...and the DRAG follows
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

describe("UI.setScale + the no-arg UI.scaled block", () => {
  it("the block applies the global scale; nothing outside it is scaled", () => {
    setScale(1.5);
    const { game } = build(() => {
      bar({ x: 10, y: 10, w: 100, h: 10, value: 1 }); // outside — native
      scaled(() => {
        bar({ x: 10, y: 40, w: 100, h: 10, value: 1 }); // inside — zoomed
      });
    });
    tick();
    const calls = ctxCalls(game);
    expect(calls.rects).toContainEqual([10, 10, 100, 10]);
    expect(calls.rects).toContainEqual([15, 60, 150, 15]);
  });

  it("UI.fromScreen is the inverse of UI.toScreen inside the block", () => {
    setScale(2);
    let round: { x: number; y: number } | null = null;
    let out: { x: number; y: number } | null = null;
    build(() => {
      scaled(() => {
        out = { ...toScreen(30, 40) };
        round = { ...fromScreen(out.x, out.y) };
      });
    });
    tick();
    expect(out).toEqual({ x: 60, y: 80 });
    expect(round).toEqual({ x: 30, y: 40 });
  });
});

describe("overlays under UI.scaled", () => {
  it("a modal drawn inside the block is centered and sized in REFERENCE units", () => {
    // The overlay scales because of the block it's drawn in — nothing ambient.
    // The 1024×768 viewport reads as 512×384 inside scaled(2), so a 100×40
    // dialog centers at reference (206, 172) → screen (412, 344) at double
    // size, and the dim backdrop covers the whole reference box — which maps
    // back to the entire screen, not a quarter of it.
    const { game } = build(() => {
      scaled(2, () => {
        modal({ w: 100, h: 40, title: "T" });
      });
    });
    tick();
    const calls = ctxCalls(game);
    expect(calls.rects).toContainEqual([0, 0, 1024, 768]); // backdrop, full screen
    expect(calls.rects).toContainEqual([412, 344, 200, 80]); // dialog, ×2
  });

  it("the children form auto-sizes to its content and returns the callback's value", () => {
    let ret: string | null = null;
    let boxes: [number, number, number, number][] = [];
    const { game } = build(() => {
      ret = modal({ w: 120, title: "T", id: "m" }, () => {
        button({ id: "ok", label: "OK", h: 30 });
        return "picked";
      });
    });
    tick();
    tick(); // second frame: the auto-sized panel has settled on its content
    boxes = ctxCalls(game).rects;
    expect(ret).toBe("picked");
    // NO height was given: the dialog wrapped its content (title strip + pad +
    // a 30-high button) snugly instead of falling back to a fixed box.
    const dialogBox = boxes.find(([x, , w]) => w === 120 && x === (1024 - 120) / 2);
    expect(dialogBox).toBeDefined();
    expect(dialogBox![3]).toBeGreaterThan(32); // taller than the bare title strip
    expect(dialogBox![3]).toBeLessThan(120); // ...but shrink-wrapped, not the viewport
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
    // Menu backdrop, in the control's OWN (reference) space: under the control
    // at y = 10+32+2 = 44, and 2 options × 30 + 2×2 pad = 64 tall — then ×2 to
    // device: (20, 88, 200, 128). The unscaled-anchor bug put it at (10,44,…);
    // the unscaled-CONTENT bug drew a 64px-tall menu at the scaled anchor.
    expect(calls.rects).toContainEqual([20, 88, 200, 128]);
    expect(calls.rects).not.toContainEqual([10, 44, 100, 64]);
    expect(calls.rects).not.toContainEqual([20, 86, 200, 64]);
  });

  it("the open control still hit-tests at its ON-SCREEN position (click to close)", () => {
    // With its own menu open the select reads an ungated pointer — which used
    // to be the RAW (screen) one, compared against a REFERENCE-space rect: at
    // any scale ≠ 1 clicking the control missed it, so it could not be closed
    // by clicking it again, and clicking the empty space `rect / scale` away
    // toggled it instead.
    let value = "a";
    let open = false;
    const { canvas } = build(() => {
      scaled(2, () => {
        const res = select({
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
        });
        value = res.value;
        open = res.open;
      });
    });
    tick();
    const click = (x: number, y: number) => {
      downAt(canvas, x, y);
      tick();
      upAt(x, y);
      tick();
    };
    click(120, 52); // screen center of the control: reference (60, 26) × 2
    expect(open).toBe(true);
    click(120, 52); // clicking it again closes it
    expect(open).toBe(false);
    click(120, 52);
    expect(open).toBe(true);
    // ...and the OPTIONS hit-test where they're drawn: the menu body starts at
    // reference y = 44 + 2 pad, so option B's row is 76..106 → screen 152..212.
    click(120, 182);
    tick(); // the pick commits in the overlay pass; `select` reads it next frame
    expect(value).toBe("b");
    expect(open).toBe(false);
  });
});

describe("layoutIssues (the overlap detector)", () => {
  it("is empty for a layout whose containers all fit their content", () => {
    layoutCapture(true);
    const { game } = build(() => {
      panel({ x: 10, y: 10, w: 300, title: "OUTER" }, () => {
        panel({ title: "INNER" }, () => {
          button({ label: "A", id: "a", h: 30 });
          button({ label: "B", id: "b", h: 30 });
        });
        row({ gap: 8 }, () => {
          button({ label: "C", id: "c", h: 30 });
          button({ label: "D", id: "d", h: 30 });
        });
      });
    });
    settle();
    selectUiApp(selectedApp);
    expect(layoutIssues()).toEqual([]);
  });

  it("reports a child that spills out of its container", () => {
    // A container pinned SHORTER than its content: the children run past the
    // bottom edge and would paint over whatever is drawn under it.
    layoutCapture(true);
    const { game } = build(() => {
      col({ x: 10, y: 10, w: 200, h: 40, id: "squeezed" }, () => {
        button({ label: "A", id: "a", h: 30 });
        button({ label: "B", id: "b", h: 30 });
        button({ label: "C", id: "c", h: 30 });
      });
    });
    settle();
    selectUiApp(selectedApp);
    const issues = layoutIssues();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.child.id)).toContain("c");
    expect(issues[0].parent.id).toBe("squeezed");
    expect(issues.at(-1)!.overflow.bottom).toBeGreaterThan(0);
  });

  it("stays quiet about clipped content and hand-positioned rects", () => {
    layoutCapture(true);
    const { game } = build(() => {
      // A scroll region whose content is taller than its box — overflowing is
      // exactly what it is for.
      col({ x: 10, y: 10, w: 200, h: 60, overflow: "auto", id: "scroll" }, () => {
        for (let i = 0; i < 8; i++) button({ label: `B${i}`, id: `b${i}`, h: 30 });
      });
      // …and a widget the caller placed by hand, outside the panel that happens
      // to enclose the call.
      panel({ x: 10, y: 200, w: 100, h: 40, id: "p" }, () => {
        text("far away", { x: 400, y: 400 });
      });
    });
    settle();
    selectUiApp(selectedApp);
    expect(layoutIssues()).toEqual([]);
  });
});

describe("nested containers without an id", () => {
  it("auto-sizes to its content instead of collapsing onto the next sibling", () => {
    // The synth-sample bug: a `panel` nested in a `panel`, neither carrying an
    // `id` nor sitting in an `idScope`, had no auto-size cache key at all — so
    // it could not measure its content, kept the fallback height, and its
    // children painted straight over the widgets that flowed after it.
    layoutCapture(true);
    const { game } = build(() => {
      panel({ x: 10, y: 10, w: 300, title: "OUTER" }, () => {
        panel({ title: "INNER" }, () => {
          button({ label: "A", id: "inner-a", h: 30 });
          button({ label: "B", id: "inner-b", h: 30 });
        });
        button({ label: "AFTER", id: "after", h: 30 });
      });
    });
    tick();
    tick(); // the auto-sized containers settle on last frame's measurement
    selectUiApp(selectedApp);
    const tree = layoutTree();
    const inner = tree.filter((e) => e.kind === "panel")[1]!;
    const a = tree.find((e) => e.id === "inner-a")!;
    const b = tree.find((e) => e.id === "inner-b")!;
    const after = tree.find((e) => e.id === "after")!;
    // The inner panel wraps both of its buttons…
    expect(inner.rect.h).toBeGreaterThan(a.rect.h + b.rect.h);
    expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(inner.rect.y + inner.rect.h);
    // …and the sibling after it starts BELOW it, not on top of its children.
    expect(after.rect.y).toBeGreaterThanOrEqual(inner.rect.y + inner.rect.h);
  });
});

describe("keyboard focus in a scroll region", () => {
  it("scrolls a focused widget that is out of view into view", () => {
    // Tab can reach a widget scrolled past the clip — a focus ring nobody can
    // see is a dead end, so the region follows the focus.
    layoutCapture(true);
    const { game, canvas } = build(() => {
      col({ x: 0, y: 0, w: 200, h: 100, overflow: "auto", id: "scroller" }, () => {
        for (let i = 0; i < 12; i++) button({ label: `B${i}`, id: `b${i}`, h: 30 });
      });
    });
    tick();
    tick();
    const tab = () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      tick();
      tick(); // the reveal lands on the frame after the focus moves
    };
    // Tab down past the visible window (100px tall ≈ 3 rows of 30 + gaps).
    for (let i = 0; i < 8; i++) tab();
    selectUiApp(selectedApp); // focus + layout live on the app's UI state
    expect(focusedId()).toBe("b7");
    const b7 = layoutTree().find((e) => e.id === "b7")!;
    // Before the fix the region never moved, so b7 drew far below the clip.
    expect(b7.screenRect.y).toBeGreaterThanOrEqual(0);
    expect(b7.screenRect.y + b7.screenRect.h).toBeLessThanOrEqual(100);
  });
});

describe("layoutCapture", () => {
  it("records nothing while disabled", () => {
    const { game } = build(() => {
      button({ x: 10, y: 10, w: 80, h: 30, label: "T", id: "t" });
    });
    tick();
    tick();
    selectUiApp(selectedApp); // the tree lives on the app's UI state
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
    selectUiApp(selectedApp); // the tree lives on the app's UI state
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

  it("auto-sizes wrapped text through row and column gaps", () => {
    layoutCapture(true);
    const { game } = build(() => {
      col({ x: 10, y: 10, w: 160, gap: 6, id: "features" }, () => {
        row({ gap: 4, id: "feature" }, () => {
          text("HEAD");
          text("one two three four five six seven", { wrap: true });
        });
        button({ label: "NEXT", id: "next" });
      });
    });
    settle(4); // nested row, then column, settle their measured heights
    selectUiApp(selectedApp);
    const tree = layoutTree();
    const feature = tree.find((e) => e.id === "feature")!;
    const next = tree.find((e) => e.id === "next")!;
    const labels = tree.filter((e) => e.kind === "text");
    const description = labels[1];

    expect(description.rect.h).toBeGreaterThan(20);
    expect(description.rect.x + description.rect.w).toBeLessThanOrEqual(
      feature.rect.x + feature.rect.w,
    );
    expect(next.rect.y).toBeGreaterThanOrEqual(feature.rect.y + feature.rect.h + 6);
  });

  it("turning capture off clears the tree", () => {
    layoutCapture(true);
    const { game } = build(() => {
      button({ x: 10, y: 10, w: 80, h: 30, label: "T", id: "t" });
    });
    tick();
    selectUiApp(selectedApp); // the tree lives on the app's UI state
    expect(layoutTree().length).toBeGreaterThan(0);
    layoutCapture(false);
    expect(layoutTree()).toEqual([]);
  });
});

describe("the UI.scaled forms", () => {
  it("fits an explicit reference box, and UI.width/height report reference units", () => {
    // Viewport 1024×768, reference 640×360 → fit = min(1.6, 2.133) = 1.6,
    // letterboxed vertically: ox = 0, oy = (768 - 576) / 2 = 96.
    layoutCapture(true);
    let space = { w: 0, h: 0, halfW: 0, halfH: 0 };
    const { game } = build(() => {
      scaled({ w: 640, h: 360 }, () => {
        space = { w: width(), h: height(), halfW: vw(50), halfH: vh(50, { max: 150 }) };
        button({ x: 0, y: 0, w: 100, h: 40, label: "GO", id: "go" });
      });
    });
    settle(2);
    selectUiApp(selectedApp);
    expect(space).toEqual({ w: 640, h: 360, halfW: 320, halfH: 150 });
    const go = layoutTree().find((e) => e.id === "go")!;
    expect(go.scale).toBe(1.6);
    expect(go.screenRect).toEqual({ x: 0, y: 96, w: 160, h: 64 });
  });

  it("honours the fit form's scale multiplier and top-left align", () => {
    layoutCapture(true);
    const { game } = build(() => {
      scaled({ w: 640, h: 360, scale: 0.5, align: "top-left" }, () => {
        button({ x: 0, y: 0, w: 100, h: 40, label: "GO", id: "go" });
      });
    });
    settle(2);
    selectUiApp(selectedApp);
    const go = layoutTree().find((e) => e.id === "go")!;
    expect(go.scale).toBeCloseTo(0.8, 5);
    expect(go.screenRect).toEqual({ x: 0, y: 0, w: 80, h: 32 });
  });

  it("the no-arg form fits UI.setBaseSize times UI.setScale", () => {
    layoutCapture(true);
    const { game } = build(() => {
      setBaseSize({ w: 640, h: 360 });
      setScale(0.5);
      scaled(() => {
        button({ x: 0, y: 0, w: 100, h: 40, label: "GO", id: "go" });
      });
    });
    settle(2);
    selectUiApp(selectedApp);
    const go = layoutTree().find((e) => e.id === "go")!;
    // fit 1.6 × the 0.5 setting = 0.8, centred: ox = (1024 - 512) / 2 = 256,
    // oy = (768 - 288) / 2 = 240.
    expect(go.scale).toBeCloseTo(0.8, 5);
    expect(go.screenRect).toEqual({ x: 256, y: 240, w: 80, h: 32 });
  });

  it("with no base size, the no-arg form is just the UI.setScale factor", () => {
    layoutCapture(true);
    let space = { w: 0, h: 0 };
    const { game } = build(() => {
      setScale(2);
      scaled(() => {
        space = { w: width(), h: height() };
        button({ x: 10, y: 10, w: 100, h: 40, label: "GO", id: "go" });
      });
    });
    settle(2);
    selectUiApp(selectedApp);
    // The scale zooms the whole UI, so the reference space HALVES.
    expect(space).toEqual({ w: 512, h: 384 });
    const go = layoutTree().find((e) => e.id === "go")!;
    expect(go.scale).toBe(2);
    expect(go.screenRect).toEqual({ x: 20, y: 20, w: 200, h: 80 });
  });

  it("nests: the inner block composes with the outer one, pointer mapping too", () => {
    layoutCapture(true);
    let round = { x: 0, y: 0 };
    const { game } = build(() => {
      scaled(2, () => {
        scaled(3, () => {
          button({ x: 10, y: 10, w: 20, h: 10, label: "N", id: "n" });
          const s = toScreen(10, 10);
          round = fromScreen(s.x, s.y);
        });
      });
    });
    settle(2);
    selectUiApp(selectedApp);
    const n = layoutTree().find((e) => e.id === "n")!;
    expect(n.scale).toBe(6);
    expect(n.screenRect).toEqual({ x: 60, y: 60, w: 120, h: 60 });
    expect(round).toEqual({ x: 10, y: 10 });
  });

  it("anchored text measures the REFERENCE box, not the device viewport", () => {
    // `anchorViewport` inside a scaled block must use UI.width/height — a
    // bottom-right anchor belongs at the reference corner, not the screen one.
    const { game } = build(() => {
      scaled({ w: 640, h: 360 }, () => {
        text("BR", { anchor: "bottomRight" });
      });
    });
    tick();
    const br = ctxCalls(game).fillText.find(([t]) => t === "BR")!;
    expect(br).toBeDefined();
    // Reference (640, 360) → device (0 + 640 × 1.6, 96 + 360 × 1.6) = (1024, 672).
    expect(br[1]).toBeLessThanOrEqual(1024);
    expect(br[1]).toBeGreaterThan(940);
    expect(br[2]).toBeLessThanOrEqual(672);
    expect(br[2]).toBeGreaterThan(620);
  });

  it("float text spawned inside a scaled block keeps that block's scale", () => {
    // `drawFloatText` runs after every transform is popped, so the spawn has to
    // capture the scale — otherwise the pop draws at native size.
    let spawned = false;
    const { game } = build(() => {
      scaled(2, () => {
        if (!spawned) floatText("+10", 50, 60);
        spawned = true;
      });
      drawFloatText();
    });
    tick();
    const calls = ctxCalls(game);
    const i = calls.fillText.findIndex(([t]) => t === "+10");
    expect(i).toBeGreaterThanOrEqual(0);
    // Spawn point (50, 60) × 2 = device (100, 120) — the reference point mapped
    // out to screen, not left at its unscaled (50, 60).
    expect(calls.fillText[i][1]).toBe(100);
    expect(calls.fillText[i][2]).toBe(120);
    // …and the glyphs come out at the spawning block's scale, not native size.
    expect(calls.textScale[i]).toBe(2);
  });
});
