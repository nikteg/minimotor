// Keyboard focus traversal, against a REAL app loop with dispatched key events
// (the ui.scale harness pattern) — Tab order, Shift+Tab, Enter activation, and
// the overlay trap that keeps Tab inside an open modal and hands focus back
// when it closes. All of it is per-frame state rebuilt from the draw calls, so
// it can only be verified by actually running frames.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../engine/index.js";
import { _reset, begin, button, col, focusedId, modal, text } from "../index.js";

let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

function makeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
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
    fillRect: vi.fn(),
    rect: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    measureText: (t: string) => ({ width: t.length * 10 }),
    globalAlpha: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
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

function build(draw: () => void): { game: App; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.id = "game";
  document.body.appendChild(canvas);
  const game = createApp({ canvas });
  games.push(game);
  game.run({
    update: () => {},
    draw: () => {
      begin(game.ctx);
      draw();
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

// Focus lives on the app's UI runtime — `begin` selects it before a read.
function focused(game: App): string | null {
  begin(game.ctx);
  return focusedId();
}

describe("Tab traversal", () => {
  it("walks the widgets in draw order, and Shift+Tab walks back", () => {
    const { game, canvas } = build(() => {
      col({ x: 0, y: 0, w: 200, gap: 4 }, () => {
        button({ label: "One", id: "one" });
        text("not focusable", {});
        button({ label: "Two", id: "two" });
        button({ label: "Three", id: "three" });
      });
    });
    tick();
    tick();
    const key = (shift = false) => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true }),
      );
      tick();
    };
    key();
    expect(focused(game)).toBe("one");
    key();
    expect(focused(game)).toBe("two"); // the text label is skipped
    key();
    expect(focused(game)).toBe("three");
    key(true);
    expect(focused(game)).toBe("two");
    key(true);
    expect(focused(game)).toBe("one");
  });

  it("activates the focused widget with Enter", () => {
    let hits = 0;
    const { canvas } = build(() => {
      col({ x: 0, y: 0, w: 200, gap: 4 }, () => {
        if (button({ label: "One", id: "one" })) hits++;
        button({ label: "Two", id: "two" });
      });
    });
    tick();
    tick();
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    tick();
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    tick();
    tick();
    expect(hits).toBe(1);
  });
});

describe("the overlay focus trap", () => {
  it("keeps Tab inside an open modal and restores focus when it closes", () => {
    let open = false;
    const { game, canvas } = build(() => {
      col({ x: 0, y: 0, w: 200, gap: 4 }, () => {
        if (button({ label: "Open", id: "open" })) open = true;
        button({ label: "Behind", id: "behind" });
      });
      if (open) {
        modal({ title: "Sure?", w: 200, id: "m" }, () => {
          if (button({ label: "Cancel", id: "cancel" })) open = false;
          button({ label: "OK", id: "ok" });
        });
      }
    });
    tick();
    tick();
    const tab = (shift = false) => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true }),
      );
      tick();
    };
    const enter = () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      tick();
      tick();
    };
    tab();
    expect(focused(game)).toBe("open");
    enter(); // opens the modal
    tick();

    // Focus jumped into the overlay, and Tab cannot walk out of it.
    for (let i = 0; i < 4; i++) {
      expect(["cancel", "ok"]).toContain(focused(game));
      tab();
    }

    // Cancel closes it; focus returns to the widget that opened it.
    while (focused(game) !== "cancel") tab();
    enter();
    tick();
    expect(open).toBe(false);
    expect(focused(game)).toBe("open");
  });
});
