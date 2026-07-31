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
