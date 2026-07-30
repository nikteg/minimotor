// The select's drop menu must SCROLL — wheel and swipe/body-drag — including
// when the select sits inside an outer scroll region (the menu is a frame-end
// overlay; while it's open the outer region's pointer is dead and must not
// steal the wheel or the drag). Uses the real-app harness: real loop, real
// pointer events, assertions on the option labels the menu actually drew.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime, type Runtime } from "../../../engine/index.js";
import { _reset, begin, col, scaled, select, spacer } from "../api.js";

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
    resetTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
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

const games: Runtime[] = [];

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

function build(draw: (game: Runtime) => void): {
  game: Runtime;
  canvas: HTMLCanvasElement;
} {
  const canvas = document.createElement("canvas");
  canvas.id = "game";
  document.body.appendChild(canvas);
  const game = createRuntime({ canvas });
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
const wheelAt = (canvas: HTMLCanvasElement, x: number, y: number, dy: number) =>
  canvas.dispatchEvent(new WheelEvent("wheel", { clientX: x, clientY: y, deltaY: dy }));

const CITIES = [
  "Auckland",
  "Bangkok",
  "Berlin",
  "Cairo",
  "Chicago",
  "Dubai",
  "Helsinki",
  "Istanbul",
  "London",
  "Los Angeles",
  "Madrid",
  "Mumbai",
  "Nairobi",
  "New York",
  "Oslo",
  "Paris",
  "São Paulo",
  "Seoul",
  "Singapore",
  "Stockholm",
  "Sydney",
  "Tokyo",
  "Toronto",
  "Vancouver",
];

describe("select drop-menu scrolling", () => {
  // Mirror the gallery: the select flows inside a scaled, overflow-scrolling
  // column with content taller than the region (an outer body-scroll region).
  function buildSelect({ nested = false } = {}) {
    let city = "Auckland";
    const built = build(() => {
      const drawSelect = () => {
        city = select({
          id: "city",
          value: city,
          options: CITIES.map((c) => ({ label: c, value: c })),
          ...(nested ? {} : { x: 20, y: 20 }),
          w: 180,
          h: 32,
        }).value;
      };
      if (nested) {
        scaled(1, () => {
          col({ x: 20, y: 20, w: 260, h: 300, overflow: "auto", gap: 0, id: "scroll" }, () => {
            drawSelect();
            spacer(900); // force the outer column to scroll
          });
        });
      } else {
        drawSelect();
      }
    });
    return { ...built, city: () => city };
  }

  // Menu-row labels only: the closed control draws its own label near y≈36,
  // menu rows draw from y≈69 down.
  function visibleLabels(game: Runtime): string[] {
    const calls = (game.ctx as unknown as { _calls: CtxCalls })._calls;
    return calls.fillText.filter(([t, , y]) => CITIES.includes(t) && y > 56).map(([t]) => t);
  }
  function clearCalls(game: Runtime): void {
    const calls = (game.ctx as unknown as { _calls: CtxCalls })._calls;
    calls.fillText.length = 0;
    calls.rects.length = 0;
  }

  it("opens on click and shows the first rows", () => {
    const { game, canvas } = buildSelect();
    tick();
    downAt(canvas, 60, 36);
    tick();
    upAt(60, 36);
    tick();
    clearCalls(game);
    tick();
    const labels = visibleLabels(game);
    expect(labels).toContain("Bangkok");
  });

  for (const nested of [false, true]) {
    const suffix = nested ? " (inside an outer scroll column)" : "";

    it(`wheel over the open menu scrolls it${suffix}`, () => {
      const { game, canvas } = buildSelect({ nested });
      tick();
      downAt(canvas, 60, 36);
      tick();
      upAt(60, 36);
      tick();
      tick();
      moveTo(100, 150); // hover the open menu, like a real mouse would
      tick();
      wheelAt(canvas, 100, 150, 120);
      clearCalls(game);
      tick();
      clearCalls(game);
      tick();
      const labels = visibleLabels(game);
      expect(labels).not.toContain("Auckland");
      expect(labels.length).toBeGreaterThan(0); // the menu is still open
      // The wheel went to the MENU, not to an enclosing scroll region: the
      // select control itself didn't move (its own label still draws at the
      // control's y ≈ 36 — a background region stealing the wheel would have
      // scrolled the whole column, control included, out from under the menu).
      const calls = (game.ctx as unknown as { _calls: CtxCalls })._calls;
      const control = calls.fillText.find(([t, , y]) => t === "Auckland" && y > 30 && y < 45);
      expect(control).toBeDefined();
    });

    it(`swipe inside the open menu scrolls it${suffix}`, () => {
      const { game, canvas } = buildSelect({ nested });
      tick();
      downAt(canvas, 60, 36);
      tick();
      upAt(60, 36);
      tick();
      tick();
      downAt(canvas, 100, 250);
      tick();
      for (const y of [230, 200, 170, 140]) {
        moveTo(100, y);
        tick();
      }
      clearCalls(game);
      tick();
      const labels = visibleLabels(game);
      upAt(100, 140);
      tick();
      expect(labels).not.toContain("Auckland");
      expect(labels.length).toBeGreaterThan(0); // the menu is still open
    });
  }
});
