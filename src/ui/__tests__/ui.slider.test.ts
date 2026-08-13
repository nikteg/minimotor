// `UI.slider`'s intrinsic layout: the track has to end where the value readout
// begins, at EVERY value the slider can hold — not just at the two ends the
// width used to be measured from.
//
// The mock's `measureText` is length-proportional (10px a character), so a
// formatted value that is longer is wider, which is the only property these
// assertions need.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, slider } from "@src/ui/api.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp } from "./app-fixture.js";

interface SliderCalls {
  /** fillText as drawn: [text, x, y]. The value is right-aligned, so its `x`
   *  is the text's RIGHT edge. */
  fillText: [string, number, number][];
  /** fillRect and the rect() of a traced rounded box: [x, y, w, h]. */
  boxes: [number, number, number, number][];
}

function mockCtx(): { ctx: CanvasRenderingContext2D; calls: SliderCalls } {
  const calls: SliderCalls = { fillText: [], boxes: [] };
  let pending: [number, number, number, number] | null = null;
  const ctx = {
    canvas: {
      width: 800,
      height: 600,
      style: {},
      hasAttribute: () => true,
      addEventListener: vi.fn(),
    },
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillText: (t: string, x: number, y: number) => calls.fillText.push([t, x, y]),
    fillRect: (x: number, y: number, w: number, h: number) => calls.boxes.push([x, y, w, h]),
    rect: (x: number, y: number, w: number, h: number) => {
      pending = [x, y, w, h];
    },
    fill: () => {
      if (pending) calls.boxes.push(pending);
      pending = null;
    },
    measureText: (t: string) => ({ width: t.length * 10 }),
    globalAlpha: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// Trash Golf's UI-scale slider: six ratios, deliberately unevenly spaced, so
// the control walks the array's INDEX and the format names the ratio at each.
const UI_SCALES = [1, 1.125, 1.25, 1.5, 1.75, 2];
const scaleFormat = (index: number): string => `${UI_SCALES[Math.round(index)]}x`;

/** Draw one slider and read back where the track ends and where the value text
 *  starts. The track is the first box the slider paints. */
function layout(
  ctx: CanvasRenderingContext2D,
  calls: SliderCalls,
  value: number,
  opts: Parameters<typeof slider>[0],
): { trackRight: number; valueLeft: number; valueText: string } {
  calls.fillText.length = 0;
  calls.boxes.length = 0;
  slider({ ...(opts as object), value } as Parameters<typeof slider>[0]);
  const [tx, , tw] = calls.boxes[0]!;
  // The value is the LAST thing the slider writes, right-aligned.
  const [valueText, right] = calls.fillText[calls.fillText.length - 1]!;
  return { trackRight: tx + tw, valueLeft: right - ctx.measureText(valueText).width, valueText };
}

describe("UI.slider value readout", () => {
  beforeEach(() => {
    _reset();
  });

  it("keeps the widest stepped value off the track, not just the two ends", () => {
    const { ctx, calls } = mockCtx();
    selectUiApp(createTestUiApp(ctx));
    const opts = {
      x: 20,
      y: 20,
      w: 300,
      min: 0,
      max: UI_SCALES.length - 1,
      step: 1,
      label: "UI scale",
      format: scaleFormat,
      id: "ui-scale",
    };
    for (let index = 0; index < UI_SCALES.length; index++) {
      const { trackRight, valueLeft, valueText } = layout(ctx, calls, index, opts);
      expect(valueText).toBe(`${UI_SCALES[index]}x`);
      // The gap is `valueSpace`'s 12 less whatever this particular value is
      // narrower than the widest; it is never negative.
      expect(trackRight).toBeLessThanOrEqual(valueLeft);
    }
  });

  it("holds the track still while the value walks its stops", () => {
    const { ctx, calls } = mockCtx();
    selectUiApp(createTestUiApp(ctx));
    const opts = {
      x: 20,
      y: 20,
      w: 300,
      min: 0,
      max: UI_SCALES.length - 1,
      step: 1,
      label: "UI scale",
      format: scaleFormat,
      id: "ui-scale",
    };
    const widths = new Set<number>();
    for (let index = 0; index < UI_SCALES.length; index++)
      widths.add(layout(ctx, calls, index, opts).trackRight);
    expect(widths.size).toBe(1);
  });

  it("reads the ends only when the stops are too many to be named positions", () => {
    const { ctx, calls } = mockCtx();
    selectUiApp(createTestUiApp(ctx));
    // 1000 stops: a continuous range with a snap on it. Walking it every frame
    // would be the cure being worse than the disease, so the ends decide, and
    // the default numeric format is widest at one of them anyway.
    const opts = { x: 20, y: 20, w: 300, min: 0, max: 1000, step: 1, label: "N", id: "n" };
    const { trackRight, valueLeft } = layout(ctx, calls, 500, opts);
    expect(trackRight).toBeLessThanOrEqual(valueLeft);
  });

  it("an unstepped range still reserves for its ends", () => {
    const { ctx, calls } = mockCtx();
    selectUiApp(createTestUiApp(ctx));
    const opts = { x: 20, y: 20, w: 300, label: "VOL", id: "vol" };
    const { trackRight, valueLeft, valueText } = layout(ctx, calls, 0.36, opts);
    expect(valueText).toBe("0.36"); // a unit range shows two decimals
    expect(trackRight).toBeLessThanOrEqual(valueLeft);
  });
});
