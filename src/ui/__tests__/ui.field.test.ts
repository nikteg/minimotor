// `UI.field` — a label bound to the control it names. The binding is the whole
// point, and it is only observable by running frames against a real loop: the
// label draws BEFORE the control, the press arrives through the canvas's native
// pointerdown listener (which is what opens a mobile keyboard in-gesture), and
// the control then has to recognise that press as its own rather than as the
// outside press that blurs it. Same harness as ui.mobile.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "@src/engine/index.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { _reset, col, field, focusedId, lastRect, textInput } from "@src/ui/api.js";

let rafCallback: ((t: number) => void) | null = null;
const origGc = HTMLCanvasElement.prototype.getContext;

function makeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    strokeRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    rect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (t: string) => ({ width: t.length * 10 }),
    globalAlpha: 1,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

const games: App[] = [];

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    const holder = this as HTMLCanvasElement & { __ctx?: CanvasRenderingContext2D };
    holder.__ctx ??= makeCtx(this);
    return holder.__ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
  rafCallback = null;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  _reset();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = origGc;
});

function build(draw: () => void): { game: App; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const game = createApp(canvas, { fullscreen: false });
  // jsdom reports a zero-sized rect, which maps every pointer event to (0,0) —
  // pretend the canvas fills the window so client coords pass through 1:1.
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: game.viewport.w,
    height: game.viewport.h,
    right: game.viewport.w,
    bottom: game.viewport.h,
    toJSON: () => ({}),
  });
  games.push(game);
  game.Loop.run({
    update: () => {},
    draw: () => {
      selectUiApp(game);
      draw();
    },
  });
  return { game, canvas };
}

let now = 0;
function tick(ms = 16): void {
  now += ms;
  const cb = rafCallback;
  rafCallback = null;
  cb?.(now);
}

const downAt = (canvas: HTMLCanvasElement, x: number, y: number) =>
  canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y }));
const upAt = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));
const moveTo = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));

const editor = () => document.querySelector("input");

// The default theme: fontSize 13 → a 19px label line, spacing.sm → a 4px gap,
// inputH 32. So a field pinned at y=20 puts its label over 20..39 and its box
// over 43..75.
const LABEL_Y = 28;
const INPUT_Y = 60;

/** One name field, pinned so the rects are known. Returns the live value. */
function nameField(): { game: App; canvas: HTMLCanvasElement; read: () => string } {
  let value = "";
  const { game, canvas } = build(() => {
    value = field({ label: "Player name", id: "name", x: 20, y: 20, w: 180 }, (id) =>
      textInput({ id, value, placeholder: "Your name" }),
    ).value;
  });
  return { game, canvas, read: () => value };
}

describe("UI.field", () => {
  it("lays the label a small gap above the control, not a button-height slot", () => {
    let labelRect: { x: number; y: number; w: number; h: number } | null = null;
    let inputRect: { x: number; y: number; w: number; h: number } | null = null;
    build(() => {
      field({ label: "Player name", id: "name", x: 20, y: 20, w: 180 }, (id) => {
        labelRect = lastRect();
        const r = textInput({ id, value: "" });
        inputRect = lastRect();
        return r;
      });
    });
    tick();
    expect(labelRect).toEqual({ x: 20, y: 20, w: 180, h: 19 }); // one line, not 30
    // 20 + 19 + spacing.sm — the label belongs to the control, so the gap is
    // tighter than the spacing.md a plain column would have used.
    expect(inputRect!.y).toBe(43);
  });

  it("pressing the label focuses the input and typing lands in it", () => {
    const { game, canvas, read } = nameField();
    tick();
    tick(); // publish the press targets the native listener tests
    expect(editor()).toBeNull(); // nothing focused yet

    downAt(canvas, 40, LABEL_Y); // the LABEL, not the box
    const input = editor();
    expect(input).not.toBeNull(); // opened synchronously, inside the gesture
    expect(document.activeElement).toBe(input);

    // The frame after the press is where a hand-rolled label loses: the field
    // sees a press outside its own box and blurs the editor it was just given.
    tick();
    expect(document.activeElement).toBe(input);
    selectUiApp(game); // read kernel state outside a frame
    expect(focusedId()).toBe("name");
    upAt(40, LABEL_Y);
    tick();

    input!.value = "Nik";
    input!.dispatchEvent(new Event("input"));
    tick();
    expect(read()).toBe("Nik");
    expect(document.activeElement).toBe(input); // still typing into the same field
  });

  it("a press on the box itself still works, and one outside still blurs", () => {
    const { canvas } = nameField();
    tick();
    tick();
    downAt(canvas, 40, INPUT_Y);
    tick();
    expect(document.activeElement).toBe(editor());
    upAt(40, INPUT_Y);
    tick();

    downAt(canvas, 40, 300); // nowhere near the field or its label
    tick();
    expect(document.activeElement).not.toBe(editor());
    upAt(40, 300);
  });

  it("one field's label does not steal another field's focus", () => {
    let a = "";
    let b = "";
    const { game, canvas } = build(() => {
      col({ x: 20, y: 20, w: 180 }, () => {
        a = field({ label: "First", id: "a" }, (id) => textInput({ id, value: a })).value;
        b = field({ label: "Second", id: "b" }, (id) => textInput({ id, value: b })).value;
      });
    });
    tick();
    tick();
    // The second field's label: 20 + 19 + 4 + 32 (first field) + 8 (col gap).
    downAt(canvas, 40, 20 + 19 + 4 + 32 + 8 + 6);
    tick();
    selectUiApp(game);
    expect(focusedId()).toBe("b");
    upAt(40, 89);
    tick();
    const input = editor();
    input!.value = "second";
    input!.dispatchEvent(new Event("input"));
    tick();
    expect(b).toBe("second");
    expect(a).toBe("");
  });

  // The proxy rect makes the label part of the field's hit area, and the field
  // used to read that as "the pointer is over me" for the cursor too — so the
  // label wore the box's I-beam, offering text to select where there is none.
  it("the label wears the hand, the box wears the I-beam", () => {
    const { canvas } = nameField();
    tick();
    moveTo(40, LABEL_Y);
    tick();
    expect(canvas.style.cursor).toBe("pointer");
    moveTo(40, INPUT_Y);
    tick();
    expect(canvas.style.cursor).toBe("text");
    moveTo(40, 300);
    tick();
    expect(canvas.style.cursor).toBe("");
  });

  it("a disabled field's label asks for no cursor at all", () => {
    const { canvas } = build(() => {
      field({ label: "Player name", id: "name", x: 20, y: 20, w: 180, disabled: true }, (id) =>
        textInput({ id, value: "", disabled: true }),
      );
    });
    tick();
    moveTo(40, LABEL_Y);
    tick();
    expect(canvas.style.cursor).toBe("");
    // …and neither does the box it names, which is disabled alongside it.
    moveTo(40, INPUT_Y);
    tick();
    expect(canvas.style.cursor).toBe("");
  });

  it("a disabled field's label focuses nothing", () => {
    const { canvas } = build(() => {
      field({ label: "Player name", id: "name", x: 20, y: 20, w: 180, disabled: true }, (id) =>
        textInput({ id, value: "", disabled: true }),
      );
    });
    tick();
    tick();
    downAt(canvas, 40, LABEL_Y);
    tick();
    expect(editor()).toBeNull();
    upAt(40, LABEL_Y);
  });
});
