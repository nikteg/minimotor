// Keyboard focus traversal, against a REAL app loop with dispatched key events
// (the ui.scale harness pattern) — Tab order, Shift+Tab, Enter activation, and
// the overlay trap that keeps Tab inside an open modal and hands focus back
// when it closes. All of it is per-frame state rebuilt from the draw calls, so
// it can only be verified by actually running frames.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../engine/index.js";
import {
  _reset,
  begin,
  button,
  col,
  focus as focusWidget,
  focusedId,
  modal,
  setNavPad,
  slider,
  text,
} from "../index.js";
import { Buttons, type GamepadState } from "../../input/gamepad.js";

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
  it("leaves gameplay Space and arrows alone when no widget is focused", () => {
    let showButton = true;
    const { game, canvas } = build(() => {
      if (showButton) button({ label: "Play", id: "play" });
    });
    tick();
    tick();
    showButton = false;
    tick();
    expect(focused(game)).toBeNull();

    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", bubbles: true }),
    );
    expect(game.keys.down("Space")).toBe(true);
    expect(game.keys.down("ArrowLeft")).toBe(true);
  });

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
  it("focuses the first enabled modal control without a visible ring for idle input", () => {
    const { game } = build(() => {
      modal({ title: "Paused", id: "pause" }, () => {
        button({ label: "Disabled", id: "disabled", disabled: true });
        button({ label: "Resume", id: "resume" });
      });
    });
    tick();
    expect(focused(game)).toBe("resume");
    vi.mocked(game.ctx.setLineDash).mockClear();
    tick();
    expect(game.ctx.setLineDash).not.toHaveBeenCalled();
  });

  it("visibly focuses the first modal control when a gamepad opened it", () => {
    const pad: GamepadState = {
      connected: true,
      axis: () => 0,
      down: (button) => button === Buttons.Start,
      pressed: () => false,
      released: () => false,
    };
    const { game } = build(() => {
      modal({ title: "Paused", id: "pause" }, () => {
        button({ label: "Resume", id: "resume" });
      });
    });
    begin(game.ctx);
    setNavPad(pad);
    tick();
    vi.mocked(game.ctx.setLineDash).mockClear();
    tick();
    expect(focused(game)).toBe("resume");
    expect(game.ctx.setLineDash).toHaveBeenCalled();
  });

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

describe("gamepad navigation", () => {
  it("dismisses a modal with the semantic B action", () => {
    let open = true;
    let pressedB = false;
    const pad: GamepadState = {
      connected: true,
      axis: () => 0,
      down: () => false,
      pressed: (button) => button === Buttons.B && pressedB,
      released: () => false,
    };
    const { game } = build(() => {
      if (open) modal({ title: "Pause", onDismiss: () => (open = false) }, () => text("Paused"));
    });
    tick();
    tick();
    begin(game.ctx);
    setNavPad(pad);
    pressedB = true;
    tick();
    expect(open).toBe(false);
  });

  it("repeats a held direction after a delay to adjust sliders", () => {
    let volume = 0.5;
    const held = new Set<number>();
    const pad: GamepadState = {
      connected: true,
      axis: () => 0,
      down: (button) => held.has(button),
      pressed: () => false,
      released: () => false,
    };
    const { game } = build(() => {
      volume = slider({ x: 10, y: 10, w: 200, value: volume, id: "volume" });
    });
    tick(20);
    tick(20);
    begin(game.ctx);
    setNavPad(pad);
    focusWidget("volume");

    held.add(Buttons.DpadRight);
    tick(20);
    expect(volume).toBeCloseTo(0.51);
    for (let i = 0; i < 10; i++) tick(20);
    expect(volume).toBeCloseTo(0.51); // still inside the initial hold delay
    for (let i = 0; i < 10; i++) tick(20);
    expect(volume).toBeGreaterThan(0.51);
  });
});
