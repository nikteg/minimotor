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
import { _reset, lastRect, layoutCapture, layoutTree, text, textWidth } from "@src/ui/api.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp, endTestFrame } from "./app-fixture.js";

interface Drawn {
  /** Every fillText as drawn: text, x, y, and the fillStyle in force. */
  fillText: { text: string; x: number; y: number; color: string; align: string }[];
}

/** 10px a character, which is what makes "wider" mean "more characters". */
const evenly = (t: string): number => t.length * 10;

function mockCtx(measure: (t: string) => number = evenly): {
  ctx: CanvasRenderingContext2D;
  calls: Drawn;
} {
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
    measureText: (t: string) => ({ width: measure(t) }),
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

function setup(measure?: (t: string) => number): {
  ctx: CanvasRenderingContext2D;
  calls: Drawn;
  endFrame: () => void;
} {
  const made = mockCtx(measure);
  const app = createTestUiApp(made.ctx);
  selectUiApp(app);
  return {
    ...made,
    // The frame boundary deselects the app on its way out (nothing may stay
    // ambient between frames), so re-select it or every read afterwards —
    // `layoutTree()` included — has no app to read from.
    endFrame: () => {
      endTestFrame(app);
      selectUiApp(app);
    },
  };
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

// A real font does not measure a string as the sum of its pieces: canvas kerns
// across a glyph pair, and cutting the pair between two `measureText` calls
// loses the kern. MEASURED in headless Chromium (`chromium_headless_shell`,
// three fonts x eight boundaries): at 13px "Helvetica Neue" `"V"` + `"."` is
// 9.880 joined against 11.557 summed — 1.677px — and at 12px system-ui
// `"AV"` + `"A"` is 0.762px. The default mock here measures LINEARLY, so it
// cannot see any of this; these tests install a mock that kerns.
//
// It matters because the runs are supposed to be one label: the slot, the
// alignment origin and the ellipsis all come from the combined measure, so a
// paint that walked the runs' own widths would place every run after the first
// past where the combined string puts it, and run the line's painted end out of
// the box `text` reserved.
const KERN_PAIRS: Record<string, number> = { AV: 4, VA: 4 };

/** Linear, minus a fixed pull for every kerning pair the string contains —
 *  which a split between the two characters therefore cannot charge. */
function kerned(t: string): number {
  let w = t.length * 10;
  for (let i = 0; i + 1 < t.length; i++) w -= KERN_PAIRS[t.slice(i, i + 2)] ?? 0;
  return w;
}

describe("UI.text colour spans, under a font that kerns", () => {
  beforeEach(() => {
    _reset();
  });

  const THREE = [
    { text: "AVA", color: RED },
    { text: "VAV", color: BLUE },
    { text: "AVA" },
  ] as const;

  it("starts each run where the combined string does, not after the previous one", () => {
    const ui = setup(kerned);
    // THREE runs, not two, because two cannot tell the strategies apart: the
    // second run's start is the width of the first run either way. It is the
    // THIRD that separates them — the combined prefix "AVAVAV" is 40 wide, and
    // the two runs before it measured apart come to 44.
    const spans = draw(ui, THREE, { x: 0, y: 0 });
    expect(spans.runs.map((r) => r.text)).toEqual(["AVA", "VAV", "AVA"]);
    const x0 = spans.runs[0]!.x;
    expect(spans.runs[1]!.x - x0).toBe(kerned("AVA"));
    expect(spans.runs[2]!.x - x0).toBe(kerned("AVAVAV"));
    // The two numbers this test exists to keep apart. Walking the runs' own
    // widths would put the third at 44.
    expect(kerned("AVAVAV")).toBe(40);
    expect(kerned("AVA") + kerned("VAV")).toBe(44);
  });

  it("takes the slot and the alignment origin from the combined measure", () => {
    const ui = setup(kerned);
    const plain = draw(ui, "AVAVAVAVA", { x: 0, y: 0 });
    const spans = draw(ui, THREE, { x: 0, y: 0 });
    expect(spans.rect).toEqual(plain.rect);

    const plainRight = draw(ui, "AVAVAVAVA", { x: 0, y: 0, w: 300, align: "right" });
    const spansRight = draw(ui, THREE, { x: 0, y: 0, w: 300, align: "right" });
    // Right-aligned, the canvas places the plain string by its own combined
    // width, so `plainRight`'s x is the line's right edge and the line starts
    // that far back. The run form has to compute the same origin itself.
    expect(spansRight.runs[0]!.x).toBe(plainRight.runs[0]!.x - kerned("AVAVAVAVA"));
  });

  it("overhangs by only the kerns the split itself destroys", () => {
    const ui = setup(kerned);
    const spans = draw(ui, THREE, { x: 0, y: 0 });
    const last = spans.runs[spans.runs.length - 1]!;
    const paintedEnd = last.x + kerned(last.text) - spans.runs[0]!.x;
    // The honest residual. Canvas cannot render a kerning pair that is split
    // across two `fillText` calls, so a run-painted line can never be exactly
    // as wide as the same characters in one colour. But it overhangs by ONE
    // lost kern, not one per boundary: every run starts at the width of the
    // combined PREFIX, which has already paid for the kerns behind it, so only
    // the final boundary is left unaccounted and the error cannot accumulate
    // however many colours the line passes through.
    expect(paintedEnd).toBe(kerned("AVAVAVAVA") + 4);
    // What walking the runs' own widths would have cost instead: one lost kern
    // per BOUNDARY — two here, and growing with every extra colour on the line.
    expect(kerned("AVA") * 3).toBe(kerned("AVAVAVAVA") + 8);
  });
});

// The item's fourth requirement: the same combined text must reach measurement
// AND whatever the kit reports for debugging and accessibility. Measurement is
// `textWidth`; the reporting surface is the layout capture, which records every
// rect the layout resolves and is what `layoutTree()` hands to a test or a
// debug overlay. Before this it recorded a text widget's BOX and never its
// words — `UI.text` takes no `id`, so a captured tree could not say what any
// label on the screen said.
describe("UI.text reports its words to the layout capture", () => {
  beforeEach(() => {
    _reset();
  });

  /** The text entries of one captured frame, in draw order. */
  function textEntries(ui: ReturnType<typeof setup>, build: () => void) {
    layoutCapture(true);
    build();
    ui.endFrame();
    return layoutTree().filter((e) => e.kind === "text");
  }

  it("records a plain label's string on its own slot", () => {
    const ui = setup();
    const entries = textEntries(ui, () => text("Ana holed out", { x: 0, y: 0 }));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("Ana holed out");
  });

  it("records the COMBINED string for a run-coloured label, never the fragments", () => {
    const ui = setup();
    const entries = textEntries(ui, () =>
      text([{ text: "Ana", color: RED }, { text: " holed out" }], { x: 0, y: 0 }),
    );
    expect(entries).toHaveLength(1);
    // The sentence a reader would read out, identical to the plain-string form
    // — not "Ana" and " holed out" as two things, and not two entries.
    expect(entries[0]!.text).toBe("Ana holed out");
  });

  it("reports the same string that measurement and the slot were built from", () => {
    const ui = setup();
    const spans = [{ text: "Ana", color: RED }, { text: " holed out" }];
    const entries = textEntries(ui, () => text(spans, { x: 0, y: 0 }));
    const reported = entries[0]!.text!;
    // One string, three consumers: what the capture reports, what `textWidth`
    // measures, and what the slot was sized from. This is the assertion that
    // fails if any of them is ever fed the fragments instead.
    expect(textWidth(spans)).toBe(textWidth(reported));
    expect(entries[0]!.rect.w).toBe(Math.ceil(textWidth(reported)));
  });

  it("records the text the label actually wrapped to, joined across the lines", () => {
    const ui = setup();
    const entries = textEntries(ui, () =>
      text([{ text: "Ana", color: RED }, { text: " used the Big Bertha on Bo" }], {
        x: 0,
        y: 0,
        w: 120,
        h: 90,
        wrap: true,
      }),
    );
    // Wrapping is a paint-time decision; what the label SAYS does not change,
    // so the reported string is the unbroken sentence.
    expect(entries[0]!.text).toBe("Ana used the Big Bertha on Bo");
  });

  it("costs nothing while the capture is off", () => {
    const ui = setup();
    layoutCapture(false);
    text("Ana holed out", { x: 0, y: 0 });
    ui.endFrame();
    expect(layoutTree()).toEqual([]);
  });
});

describe("a per-label outline", () => {
  // **The point of the option is that it does NOT leak.** Before it existed the
  // only way to outline one label was `UI.withTheme({ textOutline })`, which
  // turns it on for every widget drawn inside the callback — a theme is the
  // wrong lever for one piece of text. These check the three cases that
  // distinguish an override from a theme setting.
  const strokes = (ctx: CanvasRenderingContext2D): number =>
    (ctx.strokeText as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

  it("strokes a label the theme has no outline for", () => {
    const ui = setup();
    text("CURVES", { outline: { color: "#000", width: 3 } });
    ui.endFrame();
    expect(strokes(ui.ctx)).toBeGreaterThan(0);
  });

  it("leaves the label drawn after it alone", () => {
    // The leak this option exists to avoid: one outlined label must not outline
    // whatever is drawn next.
    const ui = setup();
    text("CURVES", { outline: { color: "#000", width: 3 } });
    const after = strokes(ui.ctx);
    text("plain", {});
    ui.endFrame();
    expect(strokes(ui.ctx)).toBe(after);
  });

  it("draws nothing extra when the width is zero", () => {
    // Which is also how a label opts OUT of an outline the theme has set.
    const ui = setup();
    text("quiet", { outline: { color: "#000", width: 0 } });
    ui.endFrame();
    expect(strokes(ui.ctx)).toBe(0);
  });
});
