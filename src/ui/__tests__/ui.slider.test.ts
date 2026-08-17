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
import { createTestUiApp, endTestFrame } from "./app-fixture.js";
import type { App } from "@src/engine/index.js";

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
      // A press moves keyboard focus to the canvas, which the gesture tests
      // below are the first in this file to reach.
      focus: vi.fn(),
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

// A UI-scale slider: six ratios, deliberately unevenly spaced, so
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

// ---------- the grab and the let-go ----------
// A slider's value moves once per drawn frame while it is dragged, so "the
// value changed" is not an event a caller can hang a sound, a haptic or a
// network write on: a consumer hung its interface click there and one sweep of
// a volume track played 31 clips. `onPress`/`onRelease` are the two edges the
// gesture actually has.
//
// The slider is 300 wide at x=20 with no label, so the track starts at 20 and
// the value readout reserves the right-hand end; every x below is comfortably
// inside it, and y=35 is the middle of a default 30-tall slot at y=20.
const GESTURE_OPTS = { x: 20, y: 20, w: 300, id: "vol" };
const TRACK_Y = 35;

interface TestPointer {
  x: number;
  y: number;
  down: boolean;
  framePressed: boolean;
  frameReleased: boolean;
}

function pointerOf(app: App): TestPointer {
  return app.Pointer as unknown as TestPointer;
}

/** Put the pointer somewhere for the next drawn frame. `framePressed` is the
 *  down EDGE, so it is set for one frame only — the same shape the browser
 *  wiring produces. */
function movePointer(app: App, x: number, down: boolean, pressed = false): void {
  const p = pointerOf(app);
  const wasDown = p.down;
  p.x = x;
  p.y = TRACK_Y;
  p.down = down;
  p.framePressed = pressed;
  p.frameReleased = wasDown && !down;
}

describe("UI.slider gesture edges", () => {
  beforeEach(() => {
    _reset();
  });

  it("presses once, releases once, and is silent for every step between", () => {
    const { ctx } = mockCtx();
    const app = createTestUiApp(ctx);
    selectUiApp(app);
    const log: string[] = [];
    const opts = {
      ...GESTURE_OPTS,
      onPress: () => log.push("press"),
      onRelease: () => log.push("release"),
    };
    let value = 0.1;
    const draw = (): void => {
      // `endTestFrame` clears the ambient app, so each frame re-selects it the
      // same way the real loop does.
      selectUiApp(app);
      value = slider({ ...opts, value });
      endTestFrame(app);
    };

    // Hover with the button up: nothing at all.
    movePointer(app, 100, false);
    draw();
    expect(log).toEqual([]);

    // The grab.
    movePointer(app, 100, true, true);
    draw();
    expect(log).toEqual(["press"]);

    // Twelve frames of drag. The value moves on every one of them and the
    // slider says nothing about any of it — this is the whole assertion.
    const before = value;
    for (let x = 110; x <= 230; x += 10) {
      movePointer(app, x, true);
      draw();
    }
    expect(value).toBeGreaterThan(before);
    expect(log).toEqual(["press"]);

    // The let-go.
    movePointer(app, 230, false);
    draw();
    expect(log).toEqual(["press", "release"]);

    // And nothing keeps arriving afterwards.
    for (let i = 0; i < 3; i++) {
      movePointer(app, 230, false);
      draw();
    }
    expect(log).toEqual(["press", "release"]);
  });

  it("still pairs both edges for a press that never moved the value", () => {
    const { ctx } = mockCtx();
    const app = createTestUiApp(ctx);
    selectUiApp(app);
    const log: string[] = [];
    let value = 0.5;
    const draw = (): void => {
      // `endTestFrame` clears the ambient app, so each frame re-selects it the
      // same way the real loop does.
      selectUiApp(app);
      value = slider({
        ...GESTURE_OPTS,
        value,
        onPress: () => log.push("press"),
        onRelease: () => log.push("release"),
      });
      endTestFrame(app);
    };
    // Down and straight back up on the knob's own position: the value never
    // changes, so a caller listening for changes hears NOTHING here, which is
    // the other half of the bug.
    const knobX = 20 + 0.5 * (300 - (Math.ceil(4 * 10) + 12));
    movePointer(app, knobX, true, true);
    draw();
    movePointer(app, knobX, false);
    draw();
    expect(log).toEqual(["press", "release"]);
    expect(value).toBeCloseTo(0.5, 5);
  });

  it("tells the slider that owned the drag, not the one drawn first", () => {
    // The drag slot is shared, so the FIRST slider drawn is the one that
    // notices the pointer went up. It must not take the release for itself.
    const { ctx } = mockCtx();
    const app = createTestUiApp(ctx);
    selectUiApp(app);
    const log: string[] = [];
    let first = 0.5;
    let second = 0.5;
    const draw = (): void => {
      // `endTestFrame` clears the ambient app, so each frame re-selects it the
      // same way the real loop does.
      selectUiApp(app);
      first = slider({
        x: 20,
        y: 20,
        w: 300,
        id: "first",
        value: first,
        onPress: () => log.push("press:first"),
        onRelease: () => log.push("release:first"),
      });
      second = slider({
        x: 20,
        y: 60,
        w: 300,
        id: "second",
        value: second,
        onPress: () => log.push("press:second"),
        onRelease: () => log.push("release:second"),
      });
      endTestFrame(app);
    };
    const p = pointerOf(app);
    // The second slider's row: y=60 with the default 30-tall slot.
    p.x = 100;
    p.y = 75;
    p.down = true;
    p.framePressed = true;
    draw();
    expect(log).toEqual(["press:second"]);
    p.framePressed = false;
    p.down = false;
    draw();
    expect(log).toEqual(["press:second", "release:second"]);
  });

  it("drops the let-go of a slider whose panel closed under the finger", () => {
    // A modal dismissed mid-drag stops drawing its sliders. The pending release
    // must not be saved up and delivered whenever the panel is next opened.
    const { ctx } = mockCtx();
    const app = createTestUiApp(ctx);
    selectUiApp(app);
    const log: string[] = [];
    let value = 0.5;
    const draw = (): void => {
      // `endTestFrame` clears the ambient app, so each frame re-selects it the
      // same way the real loop does.
      selectUiApp(app);
      value = slider({
        ...GESTURE_OPTS,
        value,
        onPress: () => log.push("press"),
        onRelease: () => log.push("release"),
      });
      endTestFrame(app);
    };
    movePointer(app, 100, true, true);
    draw();
    expect(log).toEqual(["press"]);

    // Two frames in which the slider is not drawn at all, the first of them the
    // frame the pointer comes up. Nothing collects the announcement.
    movePointer(app, 100, false);
    endTestFrame(app);
    endTestFrame(app);

    draw();
    expect(log).toEqual(["press"]);
  });
});
