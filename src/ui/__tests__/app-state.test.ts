import { describe, expect, it } from "vitest";
import { currentUiApp, resetUiApps, selectUiApp, uiApp } from "@src/ui/core/state.js";
import { createTestUiApp } from "./app-fixture.js";

describe("per-app UI state", () => {
  it("requires a selected app", () => {
    resetUiApps();
    expect(() => currentUiApp()).toThrow("no active app");
  });

  it("uses the app itself as UI identity", () => {
    const ctx = {} as CanvasRenderingContext2D;
    const app = createTestUiApp(ctx);
    selectUiApp(app);
    expect(uiApp()).toBe(app);
  });
});
