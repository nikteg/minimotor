// Module-local debug tests.
import { describe, expect, it } from "vitest";
import { createDebug } from "@src/debug/index.js";
import type { App } from "@src/engine/index.js";

describe("createDebug", () => {
  it("cycles off → performance → collision → off from layout-aware key state", () => {
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
    expect(debug.mode).toBe("collision");
    expect(debug.cycle()).toBe("off");
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
      canvas: { width: 800, height: 600 },
      viewport: { dpr: 1, scale: 1, offsetX: 0, offsetY: 0 },
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
