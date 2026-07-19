import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSprite, clearSpriteCache } from "./sprites.js";

beforeEach(() => {
  clearSpriteCache();
  // jsdom's getContext("2d") returns null — patch it
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return null;
    const methods = ["scale", "translate", "drawImage", "clearRect", "save", "restore",
      "beginPath", "arc", "fill", "fillRect", "setTransform", "createLinearGradient",
      "createRadialGradient"];
    const ctx = Object.create(null);
    for (const m of methods) ctx[m] = vi.fn();
    ctx.canvas = this;
    return ctx as unknown as CanvasRenderingContext2D;
  };
});

describe("Sprites", () => {
  it("creates sprite canvas", () => {
    expect(getSprite("a", 32, 1, () => {})).toBeInstanceOf(HTMLCanvasElement);
  });
  it("caches same key", () => {
    let n = 0;
    const a = getSprite("k", 32, 1, () => { n++; });
    const b = getSprite("k", 32, 1, () => { n++; });
    expect(a).toBe(b);
    expect(n).toBe(1);
  });
  it("different keys create different sprites", () => {
    const a = getSprite("a", 32, 1, () => {});
    const b = getSprite("b", 32, 1, () => {});
    expect(a).not.toBe(b);
  });
  it("scales by DPR", () => {
    const s = getSprite("d", 32, 2, () => {});
    expect(s.width).toBe(64);
  });
  it("clearCache forces redraw", () => {
    let n = 0;
    getSprite("k", 32, 1, () => { n++; });
    clearSpriteCache();
    getSprite("k", 32, 1, () => { n++; });
    expect(n).toBe(2);
  });
});
