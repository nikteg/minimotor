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
