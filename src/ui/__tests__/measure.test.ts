import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, begin, measureWidth, text, textMetrics as metrics, textWidth } from "../index.js";

// Text measurement is memoized per (font, string) because immediate-mode UI
// re-measures the same labels every frame and `measureText` is expensive. These
// tests pin the memo's contract: same input → no second measurement, different
// font or text → a fresh one, and the glyph metrics are read under a pinned
// alphabetic baseline regardless of what the caller left on the context.

function mockCtx() {
  const measured: { font: string; str: string; baseline: string }[] = [];
  const ctx = {
    font: "13px monospace",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "left" as CanvasTextAlign,
    fillStyle: "#fff",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText(str: string) {
      measured.push({ font: ctx.font, str, baseline: ctx.textBaseline });
      return {
        width: str.length * 8,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3,
      } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D & { font: string; textBaseline: CanvasTextBaseline };
  return { ctx, measured };
}

beforeEach(() => {
  _reset();
});

describe("UI text measurement memo", () => {
  it("measures a given (font, string) once", () => {
    const { ctx, measured } = mockCtx();
    begin(ctx);
    expect(measureWidth(ctx, "PLAY")).toBe(32);
    expect(measured).toHaveLength(1);
    measureWidth(ctx, "PLAY");
    measureWidth(ctx, "PLAY");
    metrics(ctx, "PLAY");
    expect(measured).toHaveLength(1);
  });

  it("re-measures when the font changes", () => {
    const { ctx, measured } = mockCtx();
    begin(ctx);
    measureWidth(ctx, "PLAY");
    ctx.font = "bold 20px monospace";
    measureWidth(ctx, "PLAY");
    expect(measured).toHaveLength(2);
    expect(measured[1].font).toBe("bold 20px monospace");
    // …and the first font's entry is still cached.
    ctx.font = "13px monospace";
    measureWidth(ctx, "PLAY");
    expect(measured).toHaveLength(2);
  });

  it("re-measures different strings", () => {
    const { ctx, measured } = mockCtx();
    begin(ctx);
    measureWidth(ctx, "PLAY");
    measureWidth(ctx, "QUIT");
    expect(measured).toHaveLength(2);
  });

  it("measures under a pinned alphabetic baseline and restores the caller's", () => {
    const { ctx, measured } = mockCtx();
    begin(ctx);
    // actualBoundingBox* is reported relative to the ACTIVE baseline, so a
    // caller mid-draw with "middle" must not poison the cache.
    ctx.textBaseline = "middle";
    metrics(ctx, "SCORE");
    expect(measured[0].baseline).toBe("alphabetic");
    expect(ctx.textBaseline).toBe("middle");
  });

  it("returns the real glyph metrics", () => {
    const { ctx } = mockCtx();
    begin(ctx);
    expect(metrics(ctx, "hi")).toEqual({ width: 16, asc: 9, desc: 3 });
  });

  it("makes a repeated UI.text draw free of new measurements", () => {
    const { ctx, measured } = mockCtx();
    begin(ctx);
    text("Score: 42", { x: 10, y: 10 });
    const afterFirst = measured.length;
    expect(afterFirst).toBeGreaterThan(0);
    text("Score: 42", { x: 10, y: 30 });
    text("Score: 42", { x: 10, y: 50 });
    expect(measured).toHaveLength(afterFirst);
  });

  it("backs textWidth and leaves the context font untouched", () => {
    const { ctx, measured } = mockCtx();
    begin(ctx);
    ctx.font = "italic 11px serif";
    expect(textWidth("abc")).toBe(24);
    expect(ctx.font).toBe("italic 11px serif");
    const n = measured.length;
    textWidth("abc");
    expect(measured).toHaveLength(n);
  });
});
