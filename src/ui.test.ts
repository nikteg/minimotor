import { describe, expect, it, vi } from "vitest";
import { pointInRect } from "./collision.js";
import {
  _reset,
  bar,
  begin,
  buttonState,
  createFloats,
  defaultTheme,
  flex,
  getTheme,
  setTheme,
  stack,
  textWidth,
} from "./ui.js";

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

describe("UI floats", () => {
  it("rise, fade and expire on the fixed step", () => {
    const floats = createFloats();
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
    const floats = createFloats();
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
    expect(defaultTheme.primary).toBe(defaultTheme.accent);
    expect(defaultTheme.danger).toBeDefined();
    setTheme({ radius: 8, borderWidth: 3 });
    expect(getTheme().radius).toBe(8);
    expect(getTheme().borderWidth).toBe(3);
    expect(getTheme().buttonPadX).toBe(defaultTheme.buttonPadX); // untouched
    _reset();
  });
});

describe("UI flex", () => {
  it("splits a column into fixed and flex regions with pad and gap", () => {
    const L = flex(
      { x: 0, y: 0, w: 200, h: 300 },
      {
        dir: "col",
        pad: 10,
        gap: 10,
        children: {
          header: { h: 40 },
          body: { flex: 1 },
          footer: { h: 30 },
        },
      },
    );
    expect(L.header).toEqual({ x: 10, y: 10, w: 180, h: 40 });
    expect(L.body).toEqual({ x: 10, y: 60, w: 180, h: 190 }); // 280 - 40 - 30 - 2 gaps
    expect(L.footer).toEqual({ x: 10, y: 260, w: 180, h: 30 });
  });

  it("divides leftover by flex shares in a row and recurses into children", () => {
    const L = flex(
      { x: 0, y: 0, w: 420, h: 100 },
      {
        dir: "row",
        gap: 10,
        children: {
          side: { w: 100 },
          main: {
            flex: 2,
            dir: "col",
            children: { top: { h: 20 }, rest: { flex: 1 } },
          },
          aside: { flex: 1, h: 50 }, // fixed cross size
        },
      },
    );
    expect(L.side).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(L.main.w).toBe(200); // (420 - 100 - 20 gaps) * 2/3
    expect(L.aside).toEqual({ x: 320, y: 0, w: 100, h: 50 });
    expect(L.top).toEqual({ x: 110, y: 0, w: 200, h: 20 }); // nested, flat name
    expect(L.rest.h).toBe(80);
  });
});

describe("UI implicit context", () => {
  it("begin() routes bar/textWidth to the given ctx; flex resolves fn sizes", () => {
    const { ctx, calls } = mockCtx();
    (ctx as { measureText?: unknown }).measureText = (t: string) => ({ width: t.length * 10 });
    begin(ctx);

    expect(textWidth("abcd")).toBe(40);
    bar(0, 0, 100, 8, 0.5); // ctx-less form draws to the begun ctx
    expect(calls.boxes.length).toBe(1); // track box
    expect(calls.fillRect.length).toBe(1); // fill

    const L = flex(
      { x: 0, y: 0, w: 300, h: 40 },
      {
        dir: "row",
        children: {
          label: { w: (m) => m.text("abcd") + 20 }, // content-fit
          rest: { flex: 1 },
        },
      },
    );
    expect(L.label.w).toBe(60);
    expect(L.rest.w).toBe(240);
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
