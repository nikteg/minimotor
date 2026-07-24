import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createApp,
  Stage,
  Loop,
  Keys,
  Pointer,
  Mouse,
  Draw,
  type App,
  type AppCallbacks,
} from "../index.js";

// jsdom canvas support + a controllable requestAnimationFrame.
let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    return {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      canvas: this,
    } as unknown as CanvasRenderingContext2D;
  };
  rafCallback = null;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

function build(canvasId = "game"): { game: App; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.id = canvasId;
  document.body.appendChild(canvas);
  const game = createApp({ canvas: canvasId });
  return { game, canvas };
}

/** Drive one animation frame at the given timestamp. */
function tick(time: number): void {
  const cb = rafCallback;
  rafCallback = null;
  cb?.(time);
}

describe("createApp", () => {
  it("resolves canvas by id and exposes a viewport", () => {
    const { game, canvas } = build();
    expect(game.canvas).toBe(canvas);
    expect(game.ctx).toBeDefined();
    expect(game.viewport.canvas).toBe(canvas);
  });

  it("accepts a canvas element directly", () => {
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas });
    expect(game.canvas).toBe(canvas);
  });

  it("throws for a missing canvas id", () => {
    expect(() => createApp({ canvas: "nope" })).toThrow(/not found/);
  });

  it("accepts plugins via options and registers late ones via game.use()", () => {
    const canvas = document.createElement("canvas");
    const early = vi.fn();
    const late = vi.fn();
    const game = createApp({ canvas, plugins: [{ name: "early", onInit: early }] });
    expect(early).toHaveBeenCalledTimes(1);
    game.use({ name: "late", onInit: late });
    expect(late).toHaveBeenCalledTimes(1);
  });
});

describe("run / loop", () => {
  function withCallbacks(cb: Partial<AppCallbacks> = {}): {
    game: App;
    update: ReturnType<typeof vi.fn>;
    draw: ReturnType<typeof vi.fn>;
  } {
    const { game } = build();
    const update = vi.fn();
    const draw = vi.fn();
    game.run({ update, draw, ...cb });
    return { game, update, draw };
  }

  it("calls update with no arguments (the step IS the time unit) and passes ctx to draw", () => {
    const { game } = build();
    const update = vi.fn();
    const draw = vi.fn();
    game.run({ update, draw });
    tick(16);
    tick(36); // 20ms → one step
    expect(update).toHaveBeenCalledWith();
    expect(draw).toHaveBeenCalledWith(game.ctx);
  });

  it("measures per-frame update/draw cost in game.timings", () => {
    const { game } = build();
    game.run({ update: () => {}, draw: () => {} });
    tick(16);
    tick(36); // 20ms → one step
    expect(game.timings.steps).toBe(1);
    expect(game.timings.updateMs).toBeGreaterThanOrEqual(0);
    expect(game.timings.drawMs).toBeGreaterThanOrEqual(0);
  });

  it("runs draw but not update while paused", () => {
    const { game, update, draw } = withCallbacks();
    tick(16); // primes lastTime
    game.pause();
    tick(32);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("caps catch-up at 5 steps per frame and drops the backlog", () => {
    const { update } = withCallbacks();
    tick(16);
    tick(1016); // a full second behind
    expect(update).toHaveBeenCalledTimes(5); // spiral-of-death guard
    tick(1024); // 8ms later: backlog was dropped, <1 step accumulated
    expect(update).toHaveBeenCalledTimes(5);
  });

  it("draws without updating when less than one step elapses", () => {
    const { update, draw } = withCallbacks();
    tick(16);
    tick(26); // 10ms < 16.67
    expect(draw).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("accumulates leftover time across frames", () => {
    const { update } = withCallbacks();
    tick(16);
    tick(26); // 10ms accumulated
    expect(update).not.toHaveBeenCalled();
    tick(40); // +14 = 24 → one step
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("runs multiple update steps in a busy frame", () => {
    const { update } = withCallbacks();
    tick(16);
    tick(66); // 50ms → 2 steps
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("stop() halts the loop", () => {
    const { game, draw } = withCallbacks();
    tick(16);
    game.stop();
    tick(32);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("restarts with a fresh clock after stop() — no catch-up burst", () => {
    const { game, update, draw } = withCallbacks();
    tick(16);
    game.stop();
    game.run({ update, draw });
    tick(5000); // long wall-clock gap while stopped: must only prime the clock
    expect(update).not.toHaveBeenCalled();
    tick(5017);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("drops edge input that arrives while paused", () => {
    const { game } = build();
    const seen: boolean[] = [];
    game.run({ update: () => seen.push(game.keys.pressed("Space")), draw: vi.fn() });
    tick(16);
    game.pause();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(32); // paused frame clears the stale edge
    game.resume();
    tick(64); // steps run again
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(true);
  });

  it("runs onStepStart before update and onStep after, every step", () => {
    const { game } = build();
    const order: string[] = [];
    game.onStepStart(() => order.push("start"));
    game.onStep(() => order.push("end"));
    game.run({ update: () => order.push("update"), draw: vi.fn() });
    tick(16);
    tick(66); // ~50ms → 3 steps in one frame
    expect(order.slice(0, 3)).toEqual(["start", "update", "end"]);
    expect(order.length % 3).toBe(0); // the trio holds for every step
    for (let i = 0; i < order.length; i += 3) {
      expect(order.slice(i, i + 3)).toEqual(["start", "update", "end"]);
    }
  });

  it("exposes alpha as the unsimulated fraction of a step", () => {
    const { game } = withCallbacks();
    tick(16);
    tick(40); // 24ms → one step consumed, ~7.33ms remains
    const step = 1000 / 60;
    expect(game.alpha).toBeCloseTo((24 - step) / step, 2);
  });
});

describe("destroy", () => {
  it("stops the loop, removes listeners and refuses to run again", () => {
    const { game } = build();
    const draw = vi.fn();
    game.run({ update: vi.fn(), draw });
    tick(16);
    game.destroy();
    tick(32);
    expect(draw).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    expect(game.keys.down("KeyQ")).toBe(false);
    expect(() => game.run({ update: vi.fn(), draw })).toThrow(/destroyed/);
  });
});

describe("input", () => {
  it("tracks held keys via down()", () => {
    const { game } = build();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    expect(game.keys.down("ArrowLeft")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
    expect(game.keys.down("ArrowLeft")).toBe(false);
    expect(game.keys.released("ArrowLeft")).toBe(true);
  });

  it("pressed() is edge-triggered and observed by update, then cleared", () => {
    const { game } = build();
    const seen: boolean[] = [];
    game.run({ update: () => seen.push(game.keys.pressed("Space")), draw: vi.fn() });

    tick(16); // prime lastTime
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(34); // one update step observes the press
    expect(seen).toContain(true);

    // Auto-repeat keydown while held must not re-trigger pressed().
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(52);
    expect(game.keys.pressed("Space")).toBe(false);
  });

  it("does not clear edges on a render-only frame", () => {
    const { game } = build();
    game.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" }));
    tick(24); // <1 step: draw only, no update → press must survive
    expect(game.keys.pressed("KeyR")).toBe(true);
  });

  it("frameReleased survives the steps into draw, then clears at frame end", () => {
    const { game, canvas } = build();
    const inDraw: boolean[] = [];
    const inUpdate: boolean[] = [];
    game.run({
      update: () => inUpdate.push(game.pointer.released),
      draw: () => inDraw.push(game.pointer.frameReleased),
    });

    tick(16); // prime lastTime
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5 }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 5, clientY: 5 }));
    tick(34); // one step consumes released; draw still sees frameReleased
    expect(inUpdate).toContain(true);
    expect(inDraw.at(-1)).toBe(true);

    tick(52); // next frame: the click is spent
    expect(inDraw.at(-1)).toBe(false);
  });

  it("normalizes window mouse movement through a CSS-scaled canvas rect", () => {
    const { game } = build();
    vi.spyOn(game.canvas, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: game.viewport.w / 2,
      height: game.viewport.h / 2,
      right: 10 + game.viewport.w / 2,
      bottom: 20 + game.viewport.h / 2,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });

    window.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX: 10 + game.viewport.w / 4,
        clientY: 20 + game.viewport.h / 4,
      }),
    );
    expect(game.pointer.x).toBe(game.viewport.w / 2);
    expect(game.pointer.y).toBe(game.viewport.h / 2);
    expect(game.pointer.inside).toBe(true);

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 0 }));
    expect(game.pointer.inside).toBe(false);
  });

  it("framePressed and wheel are frame-scoped and cleared at frame end", () => {
    const { game } = build();
    const seen: { pressed: boolean; wheel: number }[] = [];
    game.run({
      update: () => {},
      draw: () => seen.push({ pressed: game.pointer.framePressed, wheel: game.pointer.wheel }),
    });

    tick(16);
    game.canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5 }));
    game.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 }));
    game.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 25 }));
    tick(34);
    expect(seen.at(-1)).toEqual({ pressed: true, wheel: 65 }); // accumulated

    tick(52); // next frame: spent
    expect(seen.at(-1)).toEqual({ pressed: false, wheel: 0 });
  });

  it("setCursor applies for one frame and onFrame runs each rendered frame", () => {
    const { game } = build();
    let frames = 0;
    game.onFrame(() => frames++);
    game.run({
      update: () => {},
      draw: () => game.setCursor("pointer"),
    });
    tick(16);
    expect(frames).toBe(1);
    expect(game.canvas.style.cursor).toBe("pointer");

    game.run({ update: () => {}, draw: () => {} }); // stop requesting
    tick(32);
    expect(frames).toBe(2);
    expect(game.canvas.style.cursor).toBe(""); // reset itself
  });

  it("pressed() fires for exactly one step even when a frame runs several", () => {
    const { game } = build();
    let firedInPressedState = 0;
    game.run({
      update: () => {
        if (game.keys.pressed("Space")) firedInPressedState++;
      },
      draw: vi.fn(),
    });
    tick(16); // prime
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(66); // ~50ms → 3 update steps in one frame
    expect(firedInPressedState).toBe(1);
  });

  it("prevents default on Space", () => {
    build();
    const e = new KeyboardEvent("keydown", { code: "Space", cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("prevents default on arrow keys by default (page must not scroll)", () => {
    build();
    const e = new KeyboardEvent("keydown", { code: "ArrowDown", cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves native text/select editing keys alone", () => {
    const { game } = build();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const space = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
    input.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    expect(game.keys.down("Space")).toBe(false);

    const select = document.createElement("select");
    document.body.appendChild(select);
    const arrow = new KeyboardEvent("keydown", {
      code: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    select.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(game.keys.down("ArrowDown")).toBe(false);
  });

  it("honors a custom preventKeys set", () => {
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas, preventKeys: ["KeyZ"] });
    const ez = new KeyboardEvent("keydown", { code: "KeyZ", cancelable: true });
    window.dispatchEvent(ez);
    expect(ez.defaultPrevented).toBe(true);
    const ex = new KeyboardEvent("keydown", { code: "KeyX", cancelable: true });
    window.dispatchEvent(ex);
    expect(ex.defaultPrevented).toBe(false);
    game.destroy();
  });
});

describe("live viewport & background", () => {
  it("keeps viewport identity across resize, mutating fields in place", () => {
    const { game } = build();
    const vp = game.viewport;
    Object.defineProperty(window, "innerWidth", { value: 999, configurable: true });
    window.dispatchEvent(new Event("resize"));
    tick(0); // resize is coalesced — applied at most once per animation frame
    expect(game.viewport).toBe(vp); // same object — holders never go stale
    expect(vp.w).toBe(999);
  });

  it("fills the configured background at the start of every frame", () => {
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas, background: "#123456" });
    const ctx = game.ctx as unknown as { fillRect: ReturnType<typeof vi.fn>; fillStyle?: string };
    game.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, game.viewport.w, game.viewport.h);
    expect(ctx.fillStyle).toBe("#123456");
  });

  it("letterboxes a fixed resolution: logical viewport size + centered fit", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas, resolution: { w: 200, h: 200 } });
    const vp = game.viewport;
    expect(vp.w).toBe(200); // logical size, not the window
    expect(vp.h).toBe(200);
    expect(vp.scale).toBe(3); // min(800/200, 600/200) = 3
    expect(vp.offsetX).toBe((800 - 600) / 2); // pillarbox on the wide axis
    expect(vp.offsetY).toBe(0);
  });

  it("maps the pointer into logical coordinates under letterbox", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const game = createApp({ canvas, resolution: { w: 200, h: 200 } });
    // Window center (400,300) → logical center (100,100).
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 300 }));
    expect(game.pointer.x).toBeCloseTo(100);
    expect(game.pointer.y).toBeCloseTo(100);
    // A point inside the left pillar bar is outside the logical area.
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 300 }));
    expect(game.pointer.inside).toBe(false);
  });

  it("does not clear when no background is configured", () => {
    const { game } = build();
    const ctx = game.ctx as unknown as { fillRect: ReturnType<typeof vi.fn> };
    game.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("clips the draw to the logical viewport when letterboxed (no spill into the bars)", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const log: string[] = [];
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type !== "2d") return origGc.call(this, type);
      return {
        setTransform: vi.fn(),
        fillRect: vi.fn(),
        save: () => log.push("save"),
        restore: () => log.push("restore"),
        beginPath: () => log.push("beginPath"),
        rect: (x: number, y: number, w: number, h: number) => log.push(`rect ${x},${y},${w},${h}`),
        clip: () => log.push("clip"),
        canvas: this,
      } as unknown as CanvasRenderingContext2D;
    };
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas, resolution: { w: 200, h: 200 } });
    game.run({ update: vi.fn(), draw: () => log.push("draw") });
    tick(16);
    // The draw runs inside clip(rect 0,0,200,200), then the clip is restored.
    expect(log).toContain("rect 0,0,200,200");
    const clip = log.indexOf("clip");
    const draw = log.indexOf("draw");
    expect(clip).toBeGreaterThanOrEqual(0);
    expect(draw).toBeGreaterThan(clip);
    expect(log.lastIndexOf("restore")).toBeGreaterThan(draw);
    game.destroy();
  });
});

describe("plugins", () => {
  it("invokes lifecycle hooks around update and draw", () => {
    const canvas = document.createElement("canvas");
    const calls: string[] = [];
    const hook = (name: string) => () => calls.push(name);
    const game = createApp({
      canvas,
      plugins: [
        {
          name: "spy",
          onInit: hook("init"),
          beforeUpdate: hook("beforeUpdate"),
          afterUpdate: hook("afterUpdate"),
          beforeDraw: hook("beforeDraw"),
          afterDraw: hook("afterDraw"),
        },
      ],
    });
    game.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    tick(48); // enough for one update step

    expect(calls[0]).toBe("init");
    expect(calls).toContain("beforeUpdate");
    expect(calls.indexOf("beforeUpdate")).toBeLessThan(calls.indexOf("beforeDraw"));
    expect(calls.indexOf("beforeDraw")).toBeLessThan(calls.indexOf("afterDraw"));
  });
});

describe("pauseOnPortrait", () => {
  it("pauses when the media query matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
    );
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas, pauseOnPortrait: true });
    expect(game.paused).toBe(true);
  });

  it("does not pause when the media query does not match", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
    );
    const canvas = document.createElement("canvas");
    const game = createApp({ canvas, pauseOnPortrait: true });
    expect(game.paused).toBe(false);
  });
});

// NOTE: this block must stay LAST — it initialises the module-global default
// game via Stage.init(); no earlier test touches it, so the "before init" case
// still observes the null default.
describe("global facade (Stage / Loop / Keys / Pointer / Draw)", () => {
  it("throws when a namespace is used before Stage.init", () => {
    expect(() => Keys.down("Space")).toThrow(/Stage\.init/);
    expect(() => Loop.run({ update: vi.fn(), draw: vi.fn() })).toThrow(/Stage\.init/);
    expect(() => Draw.ctx).toThrow(/Stage\.init/);
  });

  it("Stage.init builds the default app and the namespaces delegate to it", () => {
    const canvas = document.createElement("canvas");
    canvas.id = "facade";
    document.body.appendChild(canvas);

    const vp = Stage.init("facade");
    expect(vp.canvas).toBe(canvas);
    expect(Stage.viewport).toBe(vp);
    expect(Stage.canvas).toBe(canvas);
    expect(Draw.ctx).toBeDefined();

    const drawn = vi.fn();
    Loop.run({ update: vi.fn(), draw: drawn });
    tick(16);
    expect(drawn).toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    expect(Keys.down("ArrowUp")).toBe(true);
    expect(Pointer.x).toBe(-1);
    expect(Mouse.x).toBe(Pointer.x);
    expect(Mouse.inside).toBe(false);
  });

  it("passes plugins from Stage.init options through to the default app", () => {
    const canvas = document.createElement("canvas");
    const onInit = vi.fn();
    Stage.init(canvas, { plugins: [{ name: "spy", onInit }] });
    expect(onInit).toHaveBeenCalledTimes(1);
  });
});
