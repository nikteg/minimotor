import { describe, expect, it, vi } from "vitest";
import { pointInRect } from "../../collision.js";
import {
  _reset,
  bar,
  begin,
  button,
  buttonState,
  col,
  createFloatText,
  defaultTheme,
  getTheme,
  idScope,
  ids,
  row,
  setTheme,
  stack,
  text,
  textWidth,
} from "../index.js";

const mockCtx = () => {
  const calls: {
    fillText: [string, number, number][];
    fillRect: [number, number, number, number][];
    // Rounded boxes trace a path (rect() then fill()); record the last
    // rect() so `drawBox` output is observable too.
    boxes: [number, number, number, number][];
  } = { fillText: [], fillRect: [], boxes: [] };
  let pending: [number, number, number, number] | null = null;
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    fillText: (t: string, x: number, y: number) => calls.fillText.push([t, x, y]),
    fillRect: (x: number, y: number, w: number, h: number) => calls.fillRect.push([x, y, w, h]),
    rect: (x: number, y: number, w: number, h: number) => {
      pending = [x, y, w, h];
    },
    fill: () => {
      if (pending) calls.boxes.push(pending);
      pending = null;
    },
    strokeRect: vi.fn(),
    set globalAlpha(_v: number) {},
    get globalAlpha() {
      return 1;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe("UI floatText", () => {
  it("rise, fade and expire on the fixed step", () => {
    const floats = createFloatText();
    floats.spawn("+100", 50, 200, { vy: -100, life: 500 });
    expect(floats.size).toBe(1);

    floats.advance(250);
    const { ctx, calls } = mockCtx();
    floats.draw(ctx);
    expect(calls.fillText).toEqual([["+100", 50, 175]]); // rose 25px in 250ms

    floats.advance(250); // lifetime exhausted
    expect(floats.size).toBe(0);
    const second = mockCtx();
    floats.draw(second.ctx);
    expect(second.calls.fillText).toEqual([]);
  });

  it("clear() empties the pool", () => {
    const floats = createFloatText();
    floats.spawn("a", 0, 0);
    floats.spawn("b", 0, 0);
    expect(floats.size).toBe(2);
    floats.clear();
    expect(floats.size).toBe(0);
  });
});

describe("UI buttonState", () => {
  const rect = { x: 100, y: 100, w: 80, h: 40 };

  it("reports hover/active/clicked from pointer state", () => {
    const idle = buttonState(rect, { x: 0, y: 0, down: false, released: false });
    expect(idle).toEqual({ hover: false, active: false, clicked: false });

    const hover = buttonState(rect, { x: 140, y: 120, down: false, released: false });
    expect(hover).toEqual({ hover: true, active: false, clicked: false });

    const held = buttonState(rect, { x: 140, y: 120, down: true, released: false });
    expect(held).toEqual({ hover: true, active: true, clicked: false });

    const clicked = buttonState(rect, { x: 140, y: 120, down: false, released: true });
    expect(clicked.clicked).toBe(true);
  });

  it("release outside the rect is not a click", () => {
    const out = buttonState(rect, { x: 10, y: 10, down: false, released: true });
    expect(out.clicked).toBe(false);
  });
});

describe("UI bar", () => {
  it("draws the track (box) plus a clamped fill", () => {
    const { ctx, calls } = mockCtx();
    bar(ctx, 10, 20, 100, 8, 0.5);
    expect(calls.boxes).toEqual([[10, 20, 100, 8]]); // track, via drawBox
    expect(calls.fillRect).toEqual([[10, 20, 50, 8]]); // half fill

    const over = mockCtx();
    bar(over.ctx, 0, 0, 100, 8, 1.7); // clamped to full
    expect(over.calls.fillRect[0]).toEqual([0, 0, 100, 8]);

    const empty = mockCtx();
    bar(empty.ctx, 0, 0, 100, 8, -2); // clamped to none — track only, no fill
    expect(empty.calls.boxes).toEqual([[0, 0, 100, 8]]);
    expect(empty.calls.fillRect).toEqual([]);
  });
});

describe("UI theme", () => {
  it("setTheme merges over the defaults without compounding", () => {
    setTheme({ accent: "#f00" });
    expect(getTheme().accent).toBe("#f00");
    expect(getTheme().text).toBe(defaultTheme.text);
    setTheme({ text: "#0f0" });
    expect(getTheme().accent).toBe(defaultTheme.accent); // previous override gone
    expect(getTheme().text).toBe("#0f0");
    _reset();
    expect(getTheme()).toEqual(defaultTheme);
  });

  it("exposes the new metric and variant-color fields with defaults", () => {
    expect(defaultTheme.borderWidth).toBe(2);
    expect(defaultTheme.radius).toBe(0);
    expect(defaultTheme.buttonPadX).toBe(28);
    expect(defaultTheme.pad).toBe(8);
    expect(defaultTheme.textPad).toBe(0);
    expect(defaultTheme.primary).toBe(defaultTheme.accent);
    expect(defaultTheme.danger).toBeDefined();
    setTheme({ radius: 8, borderWidth: 3 });
    expect(getTheme().radius).toBe(8);
    expect(getTheme().borderWidth).toBe(3);
    expect(getTheme().buttonPadX).toBe(defaultTheme.buttonPadX); // untouched
    _reset();
  });
});

describe("UI widget identity", () => {
  it("builds stable keyed ids and returns scoped callback values", () => {
    const id = ids("inventory", "player");
    expect(id("slot", 3)).toBe("inventory:player:slot:3");
    expect(idScope("menu", () => 42)).toBe(42);
  });
});

describe("UI implicit context", () => {
  it("begin() routes bar and textWidth to the given ctx", () => {
    const { ctx, calls } = mockCtx();
    (ctx as { measureText?: unknown }).measureText = (t: string) => ({ width: t.length * 10 });
    begin(ctx);

    expect(textWidth("abcd")).toBe(40);
    bar(0, 0, 100, 8, 0.5); // ctx-less form draws to the begun ctx
    expect(calls.boxes.length).toBe(1); // track box
    expect(calls.fillRect.length).toBe(1); // fill
    _reset();
  });
});

describe("UI text", () => {
  const textCtx = () => {
    const { ctx, calls } = mockCtx();
    (ctx as { measureText?: unknown }).measureText = (t: string) => ({ width: t.length * 10 });
    begin(ctx);
    return { calls };
  };

  it("padX insets a left-aligned label from its slot edge", () => {
    const { calls } = textCtx();
    text("x", { x: 10, y: 0, w: 100, h: 20, padX: 8 });
    expect(calls.fillText[0][1]).toBe(18); // rect.x(10) + padX(8)
    _reset();
  });

  it("defaults the inset to theme.textPad, overridable per call", () => {
    const flush = textCtx();
    text("x", { x: 10, y: 0, w: 100, h: 20 }); // textPad default 0 → flush
    expect(flush.calls.fillText[0][1]).toBe(10);
    _reset();

    setTheme({ textPad: 6 });
    const themed = textCtx();
    text("x", { x: 10, y: 0, w: 100, h: 20 }); // inherits theme inset
    expect(themed.calls.fillText[0][1]).toBe(16); // rect.x(10) + theme.textPad(6)
    const over = textCtx();
    text("x", { x: 10, y: 0, w: 100, h: 20, padX: 0 }); // per-call wins
    expect(over.calls.fillText[0][1]).toBe(10);
    _reset();
  });

  it("center/right align anchors at x when no width is given (canvas-native)", () => {
    const c1 = textCtx();
    text("hi", { x: 100, y: 0, align: "center" }); // pinned, no width
    expect(c1.calls.fillText[0][1]).toBe(100); // centered ON x, not x + w/2
    _reset();

    const c2 = textCtx();
    text("hi", { x: 100, y: 0, align: "right" });
    expect(c2.calls.fillText[0][1]).toBe(100); // right edge anchored at x
    _reset();
  });

  it("center align positions within the slot when a width IS given", () => {
    const { calls } = textCtx();
    text("hi", { x: 0, y: 0, w: 200, align: "center" });
    expect(calls.fillText[0][1]).toBe(100); // centered in the 200px slot
    _reset();
  });

  it("wrap breaks a long string into stacked lines within the width", () => {
    const { calls } = textCtx();
    // words are 20px each; "aa bb" = 50 ≤ 55, "aa bb cc" = 80 > 55 → wraps.
    text("aa bb cc", { x: 0, y: 0, w: 55, h: 60, wrap: true });
    expect(calls.fillText.map((f) => f[0])).toEqual(["aa bb", "cc"]);
    // the two lines have different y (stacked, not overprinted)
    expect(calls.fillText[0][2]).not.toBe(calls.fillText[1][2]);
    _reset();
  });
});

describe("UI stack", () => {
  it("hands out row slots with gaps and tracks last/extent", () => {
    const s = stack({ x: 10, y: 20, gap: 5, h: 30 });
    expect(s.next(100)).toEqual({ x: 10, y: 20, w: 100, h: 30 });
    expect(s.next(50, 20)).toEqual({ x: 115, y: 20, w: 50, h: 20 });
    expect(s.last).toEqual({ x: 115, y: 20, w: 50, h: 20 });
    expect(s.extent).toEqual({ x: 10, y: 20, w: 155, h: 30 });
    s.gap(10);
    expect(s.next(10).x).toBe(180);
  });

  it("align end grows backwards from the far edge", () => {
    const s = stack({ x: 300, y: 0, gap: 5, align: "end" });
    expect(s.next(100)).toEqual({ x: 200, y: 0, w: 100, h: 30 });
    expect(s.next(50)).toEqual({ x: 145, y: 0, w: 50, h: 30 });
  });

  it("columns advance vertically with the cross width", () => {
    const s = stack({ x: 0, y: 0, dir: "col", gap: 4, w: 80 });
    expect(s.next(undefined, 30)).toEqual({ x: 0, y: 0, w: 80, h: 30 });
    expect(s.next(undefined, 20).y).toBe(34);
    expect(s.extent).toEqual({ x: 0, y: 0, w: 80, h: 54 });
  });
});

describe("UI closure containers", () => {
  const btnCtx = () => {
    const { ctx, calls } = mockCtx();
    (ctx as { measureText?: unknown }).measureText = (t: string) => ({ width: t.length * 10 });
    (ctx as { font?: string }).font = "";
    return { ctx, calls };
  };

  it("auto-flows children left-to-right and bubbles the click out", () => {
    const { ctx, calls } = btnCtx();
    begin(ctx);
    // A root row with an explicit rect; two auto-width buttons flow inside.
    const clickedB = row({ x: 0, y: 0, w: 400, h: 40, gap: 10 }, () => {
      button({ label: "AA" }); // width = 2*10 + padX(28) = 48
      return button({ label: "BBBB" }); // return value bubbles through row()
    });
    expect(clickedB).toBe(false); // pointer is off-screen in the mock
    // Two button boxes drawn; the second sits one slot + gap to the right.
    const boxes = calls.boxes;
    expect(boxes[0][0]).toBe(0); // first button x
    expect(boxes[0][3]).toBe(40); // fills the row height
    expect(boxes[1][0]).toBe(48 + 10); // 2nd button after 1st(48) + gap(10)
    _reset();
  });

  it("nests a column inside a row and reserves declared sizes", () => {
    const { ctx } = btnCtx();
    begin(ctx);
    const seen: { x: number; y: number; w: number; h: number }[] = [];
    row({ x: 0, y: 0, w: 300, h: 100, gap: 0 }, () => {
      col({ w: 120, gap: 4 }, (c) => {
        button({ label: "X" }); // flows down inside the col
        button({ label: "Y" });
        seen.push(c.extent);
      });
    });
    // Column fills the row height (100) as its cross size; buttons stack.
    expect(seen[0].h).toBeGreaterThan(30); // two 30px buttons + gap
    _reset();
  });

  it("a root container without a rect throws", () => {
    const { ctx } = btnCtx();
    begin(ctx);
    expect(() => row(() => button({ label: "x" }))).toThrow(/explicit x\/y\/w\/h/);
    _reset();
  });
});

describe("Collision.pointInRect", () => {
  it("includes edges, excludes outside", () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(pointInRect(5, 5, r)).toBe(true);
    expect(pointInRect(0, 0, r)).toBe(true);
    expect(pointInRect(10, 10, r)).toBe(true);
    expect(pointInRect(11, 5, r)).toBe(false);
    expect(pointInRect(5, -1, r)).toBe(false);
  });
});
