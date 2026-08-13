// One `UI.text` call, several colours: a log line where the player's name keeps
// that player's colour while the sentence around it stays the log's.
//
// The property under test is that the runs are ONE label and not several: the
// same slot, the same wrap points, the same alignment and the same measured
// width as the plain string they concatenate to. Splitting the line into
// separate `UI.text` calls is what this exists to avoid, and it is also the
// thing that would silently pass a weaker test — so every assertion here
// compares the run form against the string form rather than against a constant.
//
// The mock's `measureText` is length-proportional (10px a character), so "wider"
// means "more characters", which is all these assertions need.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, lastRect, text, textWidth } from "@src/ui/api.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp } from "./app-fixture.js";

interface Drawn {
  /** Every fillText as drawn: text, x, y, and the fillStyle in force. */
  fillText: { text: string; x: number; y: number; color: string; align: string }[];
}

function mockCtx(): { ctx: CanvasRenderingContext2D; calls: Drawn } {
  const calls: Drawn = { fillText: [] };
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
    strokeText: vi.fn(),
    fillRect: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillText(t: string, x: number, y: number) {
      calls.fillText.push({
        text: t,
        x,
        y,
        color: String(this.fillStyle),
        align: String(this.textAlign),
      });
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

function setup(): { ctx: CanvasRenderingContext2D; calls: Drawn } {
  const made = mockCtx();
  selectUiApp(createTestUiApp(made.ctx));
  return made;
}

/** What one `UI.text` call painted, and the box it was recorded in. */
function draw(
  { calls }: { calls: Drawn },
  content: Parameters<typeof text>[0],
  opts?: Parameters<typeof text>[1],
): { runs: Drawn["fillText"]; line: string; rect: { x: number; y: number; w: number; h: number } } {
  calls.fillText.length = 0;
  text(content, opts);
  return {
    runs: [...calls.fillText],
    line: calls.fillText.map((f) => f.text).join(""),
    // The slot `UI.text` just resolved for itself — the label's box, which is
    // the thing that must not change when the string gains colours.
    rect: lastRect()!,
  };
}

const RED = "#ff0000";
const BLUE = "#0000ff";

describe("UI.text colour spans", () => {
  beforeEach(() => {
    _reset();
  });

  it("draws the runs in order, each in its own colour", () => {
    const ui = setup();
    const { runs, line } = draw(ui, [{ text: "Ana", color: RED }, { text: " holed out" }], {
      x: 10,
      y: 10,
      color: BLUE,
    });
    expect(runs.map((r) => r.text)).toEqual(["Ana", " holed out"]);
    expect(runs.map((r) => r.color)).toEqual([RED, BLUE]);
    expect(line).toBe("Ana holed out");
    // Laid down left to right: the second run starts where the first ended.
    expect(runs[1]!.x).toBe(runs[0]!.x + "Ana".length * 10);
    // Both on one baseline — it is one line, not two labels.
    expect(runs[1]!.y).toBe(runs[0]!.y);
  });

  it("occupies exactly the slot its plain-string equivalent would", () => {
    const ui = setup();
    const plain = draw(ui, "Ana holed out", { x: 10, y: 10 });
    const spans = draw(ui, [{ text: "Ana", color: RED }, { text: " holed out" }], { x: 10, y: 10 });
    expect(spans.rect).toEqual(plain.rect);
    expect(textWidth([{ text: "Ana", color: RED }, { text: " holed out" }])).toBe(
      textWidth("Ana holed out"),
    );
  });

  it("wraps at the same points as the string it concatenates to", () => {
    const ui = setup();
    const sentence = "Ana used the Big Bertha on Bo";
    const box = { x: 0, y: 0, w: 120, h: 90, wrap: true } as const;
    const plain = draw(ui, sentence, box);
    const spans = draw(
      ui,
      [
        { text: "Ana", color: RED },
        { text: " used the Big Bertha on " },
        { text: "Bo", color: BLUE },
      ],
      box,
    );
    // Same lines, in the same order, at the same baselines.
    const lineOf = (runs: Drawn["fillText"]): { y: number; text: string }[] => {
      const out: { y: number; text: string }[] = [];
      for (const run of runs) {
        const last = out[out.length - 1];
        if (last && last.y === run.y) last.text += run.text;
        else out.push({ y: run.y, text: run.text });
      }
      return out;
    };
    expect(lineOf(spans.runs)).toEqual(lineOf(plain.runs));
    expect(lineOf(spans.runs).length).toBeGreaterThan(1);
    expect(spans.rect).toEqual(plain.rect);
  });

  it("keeps a word whole when a colour changes inside it", () => {
    const ui = setup();
    const { runs, line } = draw(
      ui,
      [
        { text: "Ana", color: RED },
        { text: "'s ball", color: BLUE },
      ],
      { x: 0, y: 0, w: 200, wrap: true },
    );
    expect(line).toBe("Ana's ball");
    // "Ana's" is one word: its two coloured halves stay on one baseline even
    // though nothing separates them.
    expect(runs[0]!.y).toBe(runs[1]!.y);
    expect(runs[1]!.x).toBe(runs[0]!.x + "Ana".length * 10);
  });

  it("right-aligns the whole line, not each run", () => {
    const ui = setup();
    const plain = draw(ui, "Ana holed out", { x: 0, y: 0, w: 300, align: "right" });
    const spans = draw(ui, [{ text: "Ana", color: RED }, { text: " holed out" }], {
      x: 0,
      y: 0,
      w: 300,
      align: "right",
    });
    const spansRight = spans.runs[spans.runs.length - 1]!;
    const spansEnd = spansRight.x + spansRight.text.length * 10;
    // The single-run form is drawn by the canvas's own right alignment; the
    // multi-run form has to place itself, and must land in the same place.
    expect(plain.runs).toHaveLength(1);
    expect(plain.runs[0]!.align).toBe("right");
    expect(spansEnd).toBe(plain.runs[0]!.x);
    expect(spans.runs.every((r) => r.align === "left")).toBe(true);
  });

  it("ellipsizes the combined line, not the run that overflows", () => {
    const ui = setup();
    // 10px a character in a 90px slot: nine characters fit, and the last of
    // them is the ellipsis.
    const plain = draw(ui, "Ana holed out", { x: 0, y: 0, w: 90 });
    const spans = draw(ui, [{ text: "Ana", color: RED }, { text: " holed out" }], {
      x: 0,
      y: 0,
      w: 90,
    });
    expect(plain.line).toBe("Ana hole…");
    expect(spans.line).toBe(plain.line);
    // The name survived the cut in its own colour; the ellipsis belongs to the
    // run it ate into.
    expect(spans.runs.map((r) => [r.text, r.color])).toEqual([
      ["Ana", RED],
      [" hole…", plain.runs[0]!.color],
    ]);
  });

  it("a run with no colour of its own wears the label's", () => {
    const ui = setup();
    const { runs } = draw(ui, [{ text: "hit " }, { text: "hard", color: RED }], {
      x: 0,
      y: 0,
      color: "dim",
    });
    // "dim" is a theme role, resolved once for the label and inherited by the
    // run that named no colour.
    expect(runs[0]!.color).not.toBe("");
    expect(runs[0]!.color).not.toBe(RED);
    expect(runs[1]!.color).toBe(RED);
  });

  it("still draws a plain string as one fillText per line", () => {
    const ui = setup();
    // Backward compatibility with teeth: wrapping cuts a line into words
    // internally, and painting them word by word would be a silent regression
    // in both cost and kerning.
    const one = draw(ui, "Ana holed out", { x: 0, y: 0 });
    expect(one.runs).toHaveLength(1);
    const wrapped = draw(ui, "Ana used the Big Bertha on Bo", {
      x: 0,
      y: 0,
      w: 120,
      h: 90,
      wrap: true,
    });
    expect(wrapped.runs.length).toBeGreaterThan(1);
    expect(new Set(wrapped.runs.map((r) => r.y)).size).toBe(wrapped.runs.length);
    // Neighbouring runs of one colour fold back together, so a two-span label
    // in ONE colour is also a single fillText.
    const folded = draw(
      ui,
      [
        { text: "Ana", color: RED },
        { text: " holed out", color: RED },
      ],
      { x: 0, y: 0 },
    );
    expect(folded.runs).toHaveLength(1);
    expect(folded.line).toBe("Ana holed out");
  });
});
