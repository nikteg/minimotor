import { describe, expect, it } from "vitest";
import { createDebug } from "../debug.js";
import type { App, EnginePlugin } from "../engine/index.js";

describe("createDebug", () => {
  it("cycles off → performance → collision → off from layout-aware key state", () => {
    let down = false;
    let plugin: EnginePlugin | undefined;
    const app = {
      keys: { keyDown: (key: string) => key === "?" && down },
    };
    const game = {
      use(value: EnginePlugin) {
        plugin = value;
      },
    } as App;
    const debug = createDebug(game, { perf: false });
    expect(debug.mode).toBe("off");

    down = true;
    plugin?.beforeDraw?.(app as never);
    expect(debug.mode).toBe("performance");
    plugin?.beforeDraw?.(app as never);
    expect(debug.mode).toBe("performance");

    down = false;
    plugin?.beforeDraw?.(app as never);
    down = true;
    plugin?.beforeDraw?.(app as never);
    expect(debug.mode).toBe("collision");
    expect(debug.cycle()).toBe("off");
  });
});
