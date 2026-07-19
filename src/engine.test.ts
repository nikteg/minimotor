import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createGame,
  Stage,
  Loop,
  Keys,
  Pointer,
  Draw,
  type Game,
  type GameCallbacks,
} from "./engine.js";

// jsdom canvas support + a controllable requestAnimationFrame.
let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    return { setTransform: vi.fn(), canvas: this } as unknown as CanvasRenderingContext2D;
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

function build(canvasId = "game"): { game: Game; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.id = canvasId;
  document.body.appendChild(canvas);
  const game = createGame({ canvas: canvasId }).build();
  return { game, canvas };
}

/** Drive one animation frame at the given timestamp. */
function tick(time: number): void {
  const cb = rafCallback;
  rafCallback = null;
  cb?.(time);
}

describe("createGame", () => {
  it("resolves canvas by id and exposes a viewport", () => {
    const { game, canvas } = build();
    expect(game.canvas).toBe(canvas);
    expect(game.ctx).toBeDefined();
    expect(game.viewport.canvas).toBe(canvas);
  });

  it("accepts a canvas element directly", () => {
    const canvas = document.createElement("canvas");
    const game = createGame({ canvas }).build();
    expect(game.canvas).toBe(canvas);
  });

  it("throws for a missing canvas id", () => {
    expect(() => createGame({ canvas: "nope" }).build()).toThrow(/not found/);
  });

  it("returns the builder from use() and pauseOnPortrait() for chaining", () => {
    const canvas = document.createElement("canvas");
    const builder = createGame({ canvas });
    expect(builder.use({ name: "x" })).toBe(builder);
    expect(builder.pauseOnPortrait()).toBe(builder);
  });
});

describe("run / loop", () => {
  function withCallbacks(cb: Partial<GameCallbacks> = {}): {
    game: Game;
    update: ReturnType<typeof vi.fn>;
    draw: ReturnType<typeof vi.fn>;
  } {
    const { game } = build();
    const update = vi.fn();
    const draw = vi.fn();
    game.run({ update, draw, ...cb });
    return { game, update, draw };
  }

  it("runs draw but not update while paused", () => {
    const { game, update, draw } = withCallbacks();
    tick(16); // primes lastTime
    game.pause();
    tick(32);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("caps elapsed at 250ms of simulation", () => {
    const { update } = withCallbacks();
    tick(16);
    tick(1016);
    expect(update).toHaveBeenCalledTimes(15); // 250 / (1000/60)
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
});

describe("plugins", () => {
  it("invokes lifecycle hooks around update and draw", () => {
    const canvas = document.createElement("canvas");
    const calls: string[] = [];
    const hook = (name: string) => () => calls.push(name);
    const game = createGame({ canvas })
      .use({
        name: "spy",
        onInit: hook("init"),
        beforeUpdate: hook("beforeUpdate"),
        afterUpdate: hook("afterUpdate"),
        beforeDraw: hook("beforeDraw"),
        afterDraw: hook("afterDraw"),
      })
      .build();
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
    const game = createGame({ canvas }).pauseOnPortrait().build();
    expect(game.paused).toBe(true);
  });

  it("does not pause when the media query does not match", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
    );
    const canvas = document.createElement("canvas");
    const game = createGame({ canvas }).pauseOnPortrait().build();
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

  it("Stage.init builds the default game and the namespaces delegate to it", () => {
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
  });

  it("passes plugins from Stage.init options through to the default game", () => {
    const canvas = document.createElement("canvas");
    const onInit = vi.fn();
    Stage.init(canvas, { plugins: [{ name: "spy", onInit }] });
    expect(onInit).toHaveBeenCalledTimes(1);
  });
});
