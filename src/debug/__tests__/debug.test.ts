// Module-local debug tests.
import { describe, expect, it } from "vitest";
import { createDebug } from "@src/debug/index.js";
import type { App } from "@src/engine/index.js";

describe("createDebug", () => {
  it("cycles off → performance → off when no collision source is configured", () => {
    let down = false;
    // createDebug subscribes its overlay with app.onFrame; capture the handler
    // so the test can drive frames itself.
    let frame: (() => void) | undefined;
    const game = {
      Keys: { keyDown: (key: string) => key === "?" && down },
      onFrame(handler: () => void) {
        frame = handler;
        return () => {};
      },
    } as unknown as App;

    const debug = createDebug(game, { perf: false });
    expect(debug.mode).toBe("off");

    // Edge-detected: holding the key past one frame must not keep cycling.
    down = true;
    frame?.();
    expect(debug.mode).toBe("performance");
    frame?.();
    expect(debug.mode).toBe("performance");

    down = false;
    frame?.();
    down = true;
    frame?.();
    expect(debug.mode).toBe("off");
    expect(debug.cycle()).toBe("performance");
  });

  it("keeps the collision stop for a game that draws its own", () => {
    // A 3D game has no 2D `world` for the overlay to draw, but it still has
    // collision worth looking at — so it asks for the stop and fills it from a
    // panel, which is handed the mode.
    let frame: (() => void) | undefined;
    const modes: string[] = [];
    const game = {
      Keys: { keyDown: () => false },
      onFrame(handler: () => void) {
        frame = handler;
        return () => {};
      },
    } as unknown as App;
    const debug = createDebug(game, {
      perf: false,
      collisionMode: true,
      panels: [(_app, mode) => modes.push(mode)],
    });

    expect(debug.cycle()).toBe("performance");
    frame?.();
    expect(debug.cycle()).toBe("collision");
    frame?.();
    expect(debug.cycle()).toBe("off");
    frame?.();
    expect(modes, "the panel is told which stop it is drawing for").toEqual([
      "performance",
      "collision",
    ]);
  });

  it("unsubscribes nothing on its own — the app owns the handler's lifetime", () => {
    const handlers: Array<() => void> = [];
    const game = {
      Keys: { keyDown: () => false },
      onFrame(handler: () => void) {
        handlers.push(handler);
        return () => {};
      },
    } as unknown as App;
    createDebug(game, { perf: false });
    expect(handlers).toHaveLength(1);
  });

  it("cycles from four simultaneous touch pointers", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const game = {
      Keys: { keyDown: () => false },
      canvas,
      onFrame: () => () => {},
      onDestroy: () => () => {},
    } as unknown as App;
    const debug = createDebug(game, { perf: false });

    const pointer = (type: string, pointerId: number) => {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.defineProperties(event, {
        pointerId: { value: pointerId },
        pointerType: { value: "touch" },
      });
      canvas.dispatchEvent(event);
    };

    pointer("pointerdown", 1);
    pointer("pointerdown", 2);
    pointer("pointerdown", 3);
    pointer("pointerdown", 4);
    expect(debug.mode).toBe("performance");

    pointer("pointerup", 1);
    pointer("pointerup", 2);
    pointer("pointerup", 3);
    pointer("pointerup", 4);
    pointer("pointerdown", 5);
    pointer("pointerdown", 6);
    pointer("pointerdown", 7);
    pointer("pointerdown", 8);
    expect(debug.mode).toBe("off");
  });
});

// The meter a game monitors does not exist when its overlay is installed — the
// room is opened later and replaced on every rejoin — so it is set, not passed.
describe("createDebug setNetMeter", () => {
  function harness() {
    let frame: (() => void) | undefined;
    const game = {
      Keys: { keyDown: () => false },
      Pointer: { x: -1, y: -1, frameReleased: false },
      timings: { updateMs: 0, drawMs: 0, steps: 1 },
      canvas: Object.assign(document.createElement("canvas"), { width: 800, height: 600 }),
      viewport: { dpr: 1, scale: 1, offsetX: 0, offsetY: 0 },
      onDestroy: () => () => {},
      ctx: {
        save: () => {},
        restore: () => {},
        setTransform: () => {},
        fillRect: () => {},
        fillText: () => {},
        measureText: (s: string) => ({ width: s.length * 6 }) as TextMetrics,
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        closePath: () => {},
      },
      onFrame(handler: () => void) {
        frame = handler;
        return () => {};
      },
    } as unknown as App;
    const debug = createDebug(game, { perf: { layout: "horizontal" }, initial: "performance" });
    return { debug, frame: () => frame?.() };
  }

  function meter() {
    const samples: number[] = [];
    return {
      samples,
      m: {
        sent: () => {},
        recv: () => {},
        sample: (now: number) => {
          samples.push(now);
          return { upMsgs: 1, downMsgs: 1, upBps: 1, downBps: 1 };
        },
      },
    };
  }

  it("samples the meter it was given, and stops when it is taken away", () => {
    const { debug, frame } = harness();
    const a = meter();
    frame();
    expect(a.samples.length, "no meter yet — nothing sampled").toBe(0);

    debug.setNetMeter(a.m);
    frame();
    frame();
    expect(a.samples.length).toBe(2);

    debug.setNetMeter(null);
    frame();
    expect(a.samples.length, "dropped — a closed room's meter is not read again").toBe(2);
  });

  it("switches to a replacement meter, as a rejoin does", () => {
    const { debug, frame } = harness();
    const a = meter();
    const b = meter();
    debug.setNetMeter(a.m);
    frame();
    debug.setNetMeter(b.m);
    frame();
    frame();
    expect(a.samples.length).toBe(1);
    expect(b.samples.length).toBe(2);
  });

  it("is a no-op rather than a crash when the HUD is disabled", () => {
    let frame: (() => void) | undefined;
    const game = {
      Keys: { keyDown: () => false },
      onFrame(h: () => void) {
        frame = h;
        return () => {};
      },
    } as unknown as App;
    const debug = createDebug(game, { perf: false });
    expect(() => debug.setNetMeter(meter().m)).not.toThrow();
    expect(() => frame?.()).not.toThrow();
  });
});

describe("debug panels", () => {
  function panelHarness(opts: Record<string, unknown> = {}) {
    let frame: (() => void) | undefined;
    let down = false;
    const game = {
      Keys: { keyDown: (key: string) => key === "?" && down },
      onFrame(handler: () => void) {
        frame = handler;
        return () => {};
      },
    } as unknown as App;
    const debug = createDebug(game, { perf: false, ...opts });
    return {
      debug,
      game,
      frame: () => frame?.(),
      toggle: () => {
        down = true;
        frame?.();
        down = false;
      },
    };
  }

  it("draws nothing while the overlay is off, and every panel once it is on", () => {
    const seen: string[] = [];
    const h = panelHarness({ panels: [() => seen.push("a"), () => seen.push("b")] });
    h.frame();
    expect(seen, "off means off — a panel is not a thing you pay for").toEqual([]);
    h.toggle();
    expect(seen).toEqual(["a", "b"]);
    h.frame();
    expect(seen).toEqual(["a", "b", "a", "b"]);
  });

  it("passes the app and the mode the overlay is in", () => {
    const calls: unknown[][] = [];
    const h = panelHarness({ panels: [(app: unknown, mode: unknown) => calls.push([app, mode])] });
    h.toggle();
    expect(calls).toEqual([[h.game, "performance"]]);
  });

  it("adds and removes panels after construction", () => {
    let count = 0;
    const h = panelHarness();
    const remove = h.debug.panel(() => count++);
    h.toggle();
    expect(count).toBe(1);
    remove();
    h.frame();
    expect(count).toBe(1);
  });

  it("draws once for a frame the game drew the panels itself", () => {
    // A game whose draw ends with something that must sit ON TOP of the panels
    // — a UI kit's deferred tooltip pass — asks for them mid-draw instead. The
    // automatic pass must then not draw them a second time.
    let count = 0;
    const h = panelHarness({ panels: [() => count++] });
    h.toggle();
    expect(count).toBe(1);
    h.debug.drawPanels(h.game);
    expect(count).toBe(2);
    h.debug.drawPanels(h.game);
    expect(count, "twice in one frame is still one draw").toBe(2);
    h.frame();
    expect(count, "the automatic pass stood down").toBe(2);
    h.frame();
    expect(count, "and is back the next frame").toBe(3);
  });

  it("refuses a manual draw while the overlay is off", () => {
    let count = 0;
    const h = panelHarness({ panels: [() => count++] });
    h.debug.drawPanels(h.game);
    expect(count).toBe(0);
  });
});
