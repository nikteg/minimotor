import { describe, it, expect, beforeEach, vi } from "vitest";
import { createApp, type App, type AppCallbacks } from "@src/engine/index.js";

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
  const game = createApp(canvasId, { fullscreen: false });
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
    const game = createApp(canvas, { fullscreen: false });
    expect(game.canvas).toBe(canvas);
  });

  it("creates an explicit game with bound core services", () => {
    const canvas = document.createElement("canvas");
    const game = createApp(canvas);
    expect(game.canvas).toBe(canvas);
    expect(game.Draw.ctx.canvas).toBe(canvas);
    expect(game.Loop).toBeDefined();
  });

  it("throws for a missing canvas id", () => {
    expect(() => createApp("nope", { fullscreen: false })).toThrow(/not found/);
  });

  // NOTE: createApp also marks the canvas as a gesture surface (touch-action:
  // none etc. — see buildApp); jsdom's CSS engine drops those properties, so
  // that behavior is pinned by e2e/select-menu.spec.ts against real computed
  // style instead of here.

  it("runs onDestroy handlers on destroy, and honors unsubscribe", () => {
    const canvas = document.createElement("canvas");
    const kept = vi.fn();
    const dropped = vi.fn();
    const game = createApp(canvas, { fullscreen: false });
    game.onDestroy(kept);
    const unsubscribe = game.onDestroy(dropped);
    unsubscribe();
    game.destroy();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });
});

describe("canvas gesture guards", () => {
  // iOS runs zoom/selection gestures even under touch-action:none; the app
  // swallows them ON ITS CANVAS (fullscreen adds page-wide versions).
  const touch = (type: string) =>
    Object.assign(new Event(type, { cancelable: true }), { touches: [{}] });

  it("swallows the SECOND quick tap (double-tap zoom / loupe), not the first", () => {
    const { game } = build("guards-tap");
    const c = game.canvas;
    const s1 = touch("touchstart");
    c.dispatchEvent(s1);
    const e1 = touch("touchend");
    c.dispatchEvent(e1);
    expect(s1.defaultPrevented).toBe(false); // a single tap is untouched
    expect(e1.defaultPrevented).toBe(false);
    const s2 = touch("touchstart");
    c.dispatchEvent(s2);
    const e2 = touch("touchend");
    c.dispatchEvent(e2);
    expect(s2.defaultPrevented).toBe(true); // the hold after a double-tap = loupe
    expect(e2.defaultPrevented).toBe(true); // the second tap's end = zoom
  });

  it("swallows pinch (gesturestart) and selectstart on the canvas", () => {
    const { game } = build("guards-pinch");
    const g = new Event("gesturestart", { cancelable: true });
    game.canvas.dispatchEvent(g);
    expect(g.defaultPrevented).toBe(true);
    const sel = new Event("selectstart", { cancelable: true });
    game.canvas.dispatchEvent(sel);
    expect(sel.defaultPrevented).toBe(true);
  });

  it("destroy removes the guards", () => {
    const { game } = build("guards-destroy");
    game.destroy();
    const g = new Event("gesturestart", { cancelable: true });
    game.canvas.dispatchEvent(g);
    expect(g.defaultPrevented).toBe(false);
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
    game.Loop.run({ update, draw, ...cb });
    return { game, update, draw };
  }

  it("calls update with no arguments (the step IS the time unit) and passes ctx to draw", () => {
    const { game } = build();
    const update = vi.fn();
    const draw = vi.fn();
    game.Loop.run({ update, draw });
    tick(16);
    tick(36); // 20ms → one step
    expect(update).toHaveBeenCalledWith();
    expect(draw).toHaveBeenCalledWith(game.ctx);
  });

  it("measures per-frame update/draw cost in game.timings", () => {
    const { game } = build();
    game.Loop.run({ update: () => {}, draw: () => {} });
    tick(16);
    tick(36); // 20ms → one step
    expect(game.timings.steps).toBe(1);
    expect(game.timings.updateMs).toBeGreaterThanOrEqual(0);
    expect(game.timings.drawMs).toBeGreaterThanOrEqual(0);
  });

  it("runs draw but not update while paused", () => {
    const { game, update, draw } = withCallbacks();
    tick(16); // primes lastTime
    game.Loop.pause();
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
    game.Loop.stop();
    tick(32);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("restarts with a fresh clock after stop() — no catch-up burst", () => {
    const { game, update, draw } = withCallbacks();
    tick(16);
    game.Loop.stop();
    game.Loop.run({ update, draw });
    tick(5000); // long wall-clock gap while stopped: must only prime the clock
    expect(update).not.toHaveBeenCalled();
    tick(5017);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("drops edge input that arrives while paused", () => {
    const { game } = build();
    const seen: boolean[] = [];
    game.Loop.run({ update: () => seen.push(game.Keys.pressed("Space")), draw: vi.fn() });
    tick(16);
    game.Loop.pause();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(32); // paused frame clears the stale edge
    game.Loop.resume();
    tick(64); // steps run again
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(true);
  });

  it("runs onStepStart before update and onStep after, every step", () => {
    const { game } = build();
    const order: string[] = [];
    game.onStepStart(() => order.push("start"));
    game.onStep(() => order.push("end"));
    game.Loop.run({ update: () => order.push("update"), draw: vi.fn() });
    tick(16);
    tick(66); // ~50ms → 3 steps in one frame
    expect(order.slice(0, 3)).toEqual(["start", "update", "end"]);
    expect(order.length % 3).toBe(0); // the trio holds for every step
    for (let i = 0; i < order.length; i += 3) {
      expect(order.slice(i, i + 3)).toEqual(["start", "update", "end"]);
    }
  });

  it("exposes interpolation as the unsimulated fraction of a step", () => {
    const { game } = withCallbacks();
    tick(16);
    tick(40); // 24ms → one step consumed, ~7.33ms remains
    const step = 1000 / 60;
    expect(game.Loop.interpolation).toBeCloseTo((24 - step) / step, 2);
  });
});

describe("destroy", () => {
  it("stops the loop, removes listeners and refuses to run again", () => {
    const { game } = build();
    const draw = vi.fn();
    game.Loop.run({ update: vi.fn(), draw });
    tick(16);
    game.destroy();
    tick(32);
    expect(draw).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    expect(game.Keys.down("KeyQ")).toBe(false);
    expect(() => game.Loop.run({ update: vi.fn(), draw })).toThrow(/destroyed/);
  });
});

describe("input", () => {
  it("tracks held keys via down()", () => {
    const { game } = build();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    expect(game.Keys.down("ArrowLeft")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
    expect(game.Keys.down("ArrowLeft")).toBe(false);
    expect(game.Keys.released("ArrowLeft")).toBe(true);
  });

  it("tracks layout-aware key values independently of physical codes", () => {
    const { game } = build();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", code: "Equal", shiftKey: true }));
    expect(game.Keys.down("Equal")).toBe(true);
    expect(game.Keys.keyDown("?")).toBe(true);
    expect(game.Keys.keyPressed("?")).toBe(true);

    // Releasing Shift first may change the keyup value to "+". The value
    // recorded on keydown must still be released.
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "+", code: "Equal" }));
    expect(game.Keys.keyDown("?")).toBe(false);
    expect(game.Keys.keyReleased("?")).toBe(true);
  });

  it("pressed() is edge-triggered and observed by update, then cleared", () => {
    const { game } = build();
    const seen: boolean[] = [];
    game.Loop.run({ update: () => seen.push(game.Keys.pressed("Space")), draw: vi.fn() });

    tick(16); // prime lastTime
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(34); // one update step observes the press
    expect(seen).toContain(true);

    // Auto-repeat keydown while held must not re-trigger pressed().
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    tick(52);
    expect(game.Keys.pressed("Space")).toBe(false);
  });

  it("does not clear edges on a render-only frame", () => {
    const { game } = build();
    game.Loop.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" }));
    tick(24); // <1 step: draw only, no update → press must survive
    expect(game.Keys.pressed("KeyR")).toBe(true);
  });

  it("frameReleased survives the steps into draw, then clears at frame end", () => {
    const { game, canvas } = build();
    const inDraw: boolean[] = [];
    const inUpdate: boolean[] = [];
    game.Loop.run({
      update: () => inUpdate.push(game.Pointer.released),
      draw: () => inDraw.push(game.Pointer.frameReleased),
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

  it("pointercancel drops `down` without minting a release edge", () => {
    // The browser stole the gesture (system pan, notification pull, iOS
    // loupe): no pointerup ever comes. `down` must end so drags stop cleanly,
    // but a canceled gesture is NOT a click — no release edge.
    const { game, canvas } = build("pointer-cancel");
    const releasedFrames: boolean[] = [];
    game.Loop.run({ update: vi.fn(), draw: () => releasedFrames.push(game.Pointer.frameReleased) });
    tick(16);
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5 }));
    tick(34);
    expect(game.Pointer.down).toBe(true);
    window.dispatchEvent(new Event("pointercancel"));
    expect(game.Pointer.down).toBe(false);
    tick(52);
    expect(releasedFrames).not.toContain(true);
  });

  it("keeps the right button off the primary press entirely", () => {
    // A right-drag is its own gesture. If it minted a primary press, every UI
    // button would fire on right-click and every drag handler would start.
    const { game, canvas } = build("secondary-button");
    game.Loop.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);

    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5, button: 2 }));
    expect(game.Pointer.down).toBe(false);
    expect(game.Pointer.secondary.down).toBe(true);
    tick(34);
    expect(game.Pointer.secondary.down).toBe(true);

    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 5, clientY: 5, button: 2 }));
    expect(game.Pointer.secondary.down).toBe(false);
    expect(game.Pointer.released).toBe(false);
  });

  it("gives the right button its own one-step press and release edges", () => {
    const { game, canvas } = build("secondary-edges");
    const presses: boolean[] = [];
    const releases: boolean[] = [];
    game.Loop.run({
      update: () => {
        presses.push(game.Pointer.secondary.pressed);
        releases.push(game.Pointer.secondary.released);
      },
      draw: vi.fn(),
    });
    tick(16);

    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5, button: 2 }));
    tick(34);
    expect(presses.filter(Boolean)).toHaveLength(1);

    // Held across frames: the edge does not fire again.
    tick(52);
    expect(presses.filter(Boolean)).toHaveLength(1);
    expect(game.Pointer.secondary.down).toBe(true);

    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 5, clientY: 5, button: 2 }));
    tick(70);
    expect(releases.filter(Boolean)).toHaveLength(1);
    tick(88);
    expect(releases.filter(Boolean)).toHaveLength(1);
  });

  it("drops the right button on a canceled gesture and swallows the canvas menu", () => {
    const { game, canvas } = build("secondary-cancel");
    game.Loop.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5, button: 2 }));
    expect(game.Pointer.secondary.down).toBe(true);
    window.dispatchEvent(new Event("pointercancel"));
    expect(game.Pointer.secondary.down).toBe(false);

    // The native menu opening on press would cancel the drag before its first
    // move arrives, so the canvas keeps it to itself.
    const menu = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
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
    expect(game.Pointer.x).toBe(game.viewport.w / 2);
    expect(game.Pointer.y).toBe(game.viewport.h / 2);
    expect(game.Pointer.inside).toBe(true);

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 0 }));
    expect(game.Pointer.inside).toBe(false);
  });

  it("framePressed and wheel are frame-scoped and cleared at frame end", () => {
    const { game } = build();
    const seen: { pressed: boolean; wheel: number }[] = [];
    game.Loop.run({
      update: () => {},
      draw: () => seen.push({ pressed: game.Pointer.framePressed, wheel: game.Pointer.wheel }),
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
    game.Loop.run({
      update: () => {},
      draw: () => game.setCursor("pointer"),
    });
    tick(16);
    expect(frames).toBe(1);
    expect(game.canvas.style.cursor).toBe("pointer");

    game.Loop.run({ update: () => {}, draw: () => {} }); // stop requesting
    tick(32);
    expect(frames).toBe(2);
    expect(game.canvas.style.cursor).toBe(""); // reset itself
  });

  it("pressed() fires for exactly one step even when a frame runs several", () => {
    const { game } = build();
    let firedInPressedState = 0;
    game.Loop.run({
      update: () => {
        if (game.Keys.pressed("Space")) firedInPressedState++;
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
    expect(game.Keys.down("Space")).toBe(false);
    expect(game.Keys.keyDown(" ")).toBe(false);

    const select = document.createElement("select");
    document.body.appendChild(select);
    const arrow = new KeyboardEvent("keydown", {
      code: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    select.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(game.Keys.down("ArrowDown")).toBe(false);
    expect(game.Keys.keyDown("ArrowDown")).toBe(false);
  });

  it("honors a custom preventKeys set", () => {
    const canvas = document.createElement("canvas");
    const game = createApp(canvas, { preventKeys: ["KeyZ"], fullscreen: false });
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
    const game = createApp(canvas, { background: "#123456", fullscreen: false });
    const ctx = game.ctx as unknown as { fillRect: ReturnType<typeof vi.fn>; fillStyle?: string };
    game.Loop.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, game.viewport.w, game.viewport.h);
    expect(ctx.fillStyle).toBe("#123456");
  });

  it("letterboxes a fixed resolution: logical viewport size + centered fit", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const canvas = document.createElement("canvas");
    const game = createApp(canvas, { resolution: { w: 200, h: 200 }, fullscreen: false });
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
    const game = createApp(canvas, { resolution: { w: 200, h: 200 }, fullscreen: false });
    // Window center (400,300) → logical center (100,100).
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 300 }));
    expect(game.Pointer.x).toBeCloseTo(100);
    expect(game.Pointer.y).toBeCloseTo(100);
    // A point inside the left pillar bar is outside the logical area.
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 300 }));
    expect(game.Pointer.inside).toBe(false);
  });

  it("does not clear when no background is configured", () => {
    const { game } = build();
    const ctx = game.ctx as unknown as { fillRect: ReturnType<typeof vi.fn> };
    game.Loop.run({ update: vi.fn(), draw: vi.fn() });
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
    const game = createApp(canvas, { resolution: { w: 200, h: 200 }, fullscreen: false });
    game.Loop.run({ update: vi.fn(), draw: () => log.push("draw") });
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
  it("orders step subscriptions around update, and frame subscriptions after draw", () => {
    const canvas = document.createElement("canvas");
    const calls: string[] = [];
    const game = createApp(canvas, { fullscreen: false });
    game.onStepStart(() => calls.push("stepStart"));
    game.onStep(() => calls.push("step"));
    game.onFrame(() => calls.push("frame"));
    game.Loop.run({ update: () => calls.push("update"), draw: () => calls.push("draw") });
    tick(16);
    tick(48); // enough for one update step

    // The opening frame is IDLE — 16ms hasn't reached a full 16.67ms step — and
    // it still draws, which is the property that lets paused/idle frames render.
    expect(calls.slice(0, 2)).toEqual(["draw", "frame"]);
    // Every simulated step is bracketed stepStart → update → step...
    for (let i = 0; i < calls.length; i += 1) {
      if (calls[i] !== "update") continue;
      expect(calls[i - 1]).toBe("stepStart");
      expect(calls[i + 1]).toBe("step");
    }
    // ...and the frame's draw lands after all of them, with onFrame last.
    expect(calls.at(-2)).toBe("draw");
    expect(calls.at(-1)).toBe("frame");
    expect(calls.lastIndexOf("step")).toBeLessThan(calls.lastIndexOf("draw"));
  });

  it("ticks step subscriptions once per FIXED STEP, not once per frame", () => {
    const canvas = document.createElement("canvas");
    let steps = 0;
    let frames = 0;
    const game = createApp(canvas, { fullscreen: false });
    game.onStep(() => (steps += 1));
    game.onFrame(() => (frames += 1));
    game.Loop.run({ update: vi.fn(), draw: vi.fn() });
    tick(16);
    tick(64); // one long frame — several fixed steps have to catch up inside it

    expect(steps).toBeGreaterThan(1);
    expect(frames).toBe(2); // exactly one per rendered frame
  });
});

describe("pauseOnPortrait", () => {
  it("pauses when the media query matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
    );
    const canvas = document.createElement("canvas");
    const game = createApp(canvas, { pauseOnPortrait: true, fullscreen: false });
    expect(game.Loop.paused).toBe(true);
  });

  it("does not pause when the media query does not match", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
    );
    const canvas = document.createElement("canvas");
    const game = createApp(canvas, { pauseOnPortrait: true, fullscreen: false });
    expect(game.Loop.paused).toBe(false);
  });
});

describe("auto-pause lifecycle", () => {
  /** Point document.hasFocus/visibilityState at controllable values. */
  function stubLifecycle(): {
    setFocused: (value: boolean) => void;
    setHidden: (value: boolean) => void;
  } {
    let hidden = false;
    let hasFocus = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => hasFocus);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
      hidden ? "hidden" : "visible",
    );
    return {
      setFocused(value) {
        hasFocus = value;
        window.dispatchEvent(new Event(value ? "focus" : "blur"));
      },
      setHidden(value) {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    };
  }

  it("pauses on blur and RESUMES on refocus", () => {
    const { setFocused } = stubLifecycle();
    const game = createApp(document.createElement("canvas"), { pauseWhenBlurred: true });
    expect(game.Loop.paused).toBe(false);
    setFocused(false);
    expect(game.Loop.paused).toBe(true);
    setFocused(true);
    expect(game.Loop.paused).toBe(false);
  });

  it("pauses while hidden and resumes when visible again", () => {
    const { setHidden } = stubLifecycle();
    const game = createApp(document.createElement("canvas"), { pauseWhenHidden: true });
    setHidden(true);
    expect(game.Loop.paused).toBe(true);
    setHidden(false);
    expect(game.Loop.paused).toBe(false);
  });

  it("leaves a pause it did not take alone (a pause menu survives a tab switch)", () => {
    const { setFocused } = stubLifecycle();
    const game = createApp(document.createElement("canvas"), { pauseWhenBlurred: true });
    game.Loop.pause(); // game code opens its own pause menu
    setFocused(false);
    setFocused(true);
    expect(game.Loop.paused).toBe(true);
  });

  it("does not pause at all without the options", () => {
    const { setFocused, setHidden } = stubLifecycle();
    const game = createApp(document.createElement("canvas"));
    setFocused(false);
    setHidden(true);
    expect(game.Loop.paused).toBe(false);
  });
});

describe("fps", () => {
  it("defaults to 60 steps per second", () => {
    const { game } = build();
    expect(game.Loop.step).toBeCloseTo(1000 / 60, 6);
  });

  it("runs the fixed step at the configured rate", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    // 20fps: a 50ms step, which divides the tick below exactly (1000/30 does
    // not, and the loop would drop the third step to floating-point dust).
    const game = createApp(canvas, { fps: 20, fullscreen: false });
    let steps = 0;
    game.Loop.run({ update: () => steps++, draw: () => {} });
    tick(16); // primes the frame clock
    // 100ms of wall clock is 2 steps at 20fps, where the default 60 runs 6.
    tick(116);
    expect(steps).toBe(2);
    expect(game.Loop.step).toBe(50);
  });

  it("derives clock time from the configured rate, not from 60Hz", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const app = createApp(canvas, { fps: 20 });
    app.Loop.run({ update: () => {}, draw: () => {} });
    tick(16); // primes the frame clock
    tick(116);
    // Two steps of 50ms must read as 100ms of clock time. Against the old
    // hardcoded 60Hz they would have reported 33.3.
    expect(app.Clock.world.now).toBe(100);
    expect(app.Loop.step).toBe(50);
  });
});
