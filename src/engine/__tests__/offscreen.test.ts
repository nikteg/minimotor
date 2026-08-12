import { describe, expect, it } from "vitest";
import {
  bumpScratch,
  scratchCanvas,
  scratchContext,
  scratchGeneration,
} from "@src/engine/offscreen.js";

describe("scratchCanvas", () => {
  it("returns a w×h surface that can take a 2d context in jsdom", () => {
    const c = scratchCanvas(12, 8);
    expect(c.width).toBe(12);
    expect(c.height).toBe(8);
    // jsdom has no OffscreenCanvas 2d backend, so this is an HTML canvas
    // whose getContext is whatever the test file (or jsdom) installed.
    expect(typeof c.getContext).toBe("function");
  });

  it("ceils and clamps to at least 1×1", () => {
    const c = scratchCanvas(0.2, -4);
    expect(c.width).toBe(1);
    expect(c.height).toBe(1);
  });

  it("scratchContext returns whatever getContext(2d) gave", () => {
    const c = scratchCanvas(4, 4);
    const ctx = scratchContext(c);
    // jsdom's real getContext is null; engine tests that bake pixels mock it.
    expect(ctx === null || typeof ctx === "object").toBe(true);
  });

  it("tracks a generation that bumpScratch advances", () => {
    const c = scratchCanvas(4, 4);
    expect(scratchGeneration(c)).toBe(0);
    bumpScratch(c);
    expect(scratchGeneration(c)).toBe(1);
    const foreign = document.createElement("canvas");
    expect(scratchGeneration(foreign)).toBeUndefined();
    bumpScratch(foreign);
    expect(scratchGeneration(foreign)).toBeUndefined();
  });
});
