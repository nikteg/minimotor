// The layout capture's PAINT half: `LayoutEntry.paint`, `LayoutEntry.overlay`
// and the `paintIssues` check built on them.
//
// What the capture could not answer before, and what these are about. An entry
// says what a rect IS and where it landed; `layoutIssues` compares a child
// against the container that placed it. Neither knows anything about WHEN a rect
// was drawn, so two rects that never shared a parent could sit straight on top
// of one another with `layoutIssues` and `layoutLag` clean the whole time.
//
// Both halves of that are covered here: an overlay painting over the screen (the
// widget working) and ordinary content painted over an overlay (the fault). The
// second is `throughOverlay`, and the fixture is deliberately the shape a
// consumer hit for real — a table drawn after an open popover, through it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reset,
  button,
  col,
  layoutCapture,
  layoutIssues,
  layoutTree,
  modal,
  paintIssues,
  panel,
  popover,
  row,
  text,
} from "@src/ui/api.js";
import { registerUiApp, selectUiApp } from "@src/ui/core/state.js";
import type { App } from "@src/engine/index.js";

function mockCtx(): CanvasRenderingContext2D {
  return {
    canvas: {
      width: 800,
      height: 600,
      style: {},
      hasAttribute: () => true,
      focus: vi.fn(),
      blur: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    },
    font: "13px monospace",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "left" as CanvasTextAlign,
    fillStyle: "#fff",
    strokeStyle: "#fff",
    lineWidth: 1,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (s: string) =>
      ({
        width: s.length * 8,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3,
      }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

function testApp() {
  const ctx = mockCtx();
  const frameHooks: (() => void)[] = [];
  const unsubscribe = (): void => {};
  const app = {
    ctx,
    viewport: { canvas: ctx.canvas, ctx, w: 800, h: 600, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 },
    Pointer: {
      x: -1,
      y: -1,
      inside: true,
      down: false,
      pressed: false,
      released: false,
      doublePressed: false,
      framePressed: false,
      frameReleased: false,
      frameDoublePressed: false,
      wheel: 0,
    },
    Loop: { step: 1000 / 60, steps: 0, onStep: () => unsubscribe, onFrame: () => unsubscribe },
    resetTransform: () => {},
    setCursor: () => {},
    onStep: () => unsubscribe,
    onFrame: (fn: () => void) => {
      frameHooks.push(fn);
      return unsubscribe;
    },
  } as unknown as App;
  const registered = registerUiApp(app);
  selectUiApp(registered);
  return {
    /** Every frame re-selects the app: `appFrameEnd` finishes with
     *  `clearUiApp`, so nothing is ambient afterwards and even READING the tree
     *  needs the app back. */
    beginFrame: () => selectUiApp(registered),
    endFrame: () => frameHooks.forEach((fn) => fn()),
  };
}

/** Draw `render` until the auto-sizing has settled, and leave the app selected
 *  so the tree can be read. Three frames because a shrink-wrapping container has
 *  no measurement at all on its first one. */
function settle(fx: ReturnType<typeof testApp>, render: () => void, frames = 3): void {
  for (let i = 0; i < frames; i++) {
    fx.beginFrame();
    layoutCapture(true);
    render();
    fx.endFrame();
  }
  fx.beginFrame();
}

const name = (entry: { kind: string; id?: string }): string =>
  entry.id === undefined ? entry.kind : `${entry.kind}:${entry.id}`;

/** Every reported pair as `under < over`, with the fault shape called out. */
const pairs = (): string[] =>
  paintIssues().map(
    (issue) =>
      `${name(issue.under)} < ${name(issue.over)}` + (issue.throughOverlay ? " !overlay" : ""),
  );

let fx: ReturnType<typeof testApp>;
beforeEach(() => {
  _reset();
  fx = testApp();
});

describe("what the capture records about when a rect was drawn", () => {
  /** The distinction the field exists to make, and the one an occlusion check
   * cannot work without: a `col` is pure geometry. It reserves a box, places its
   * children and puts nothing on the canvas — so it can never cover anything,
   * and a check that treated its box as painted would report it as sitting over
   * every neighbour it happens to reach. A `panel` has a frame and does. */
  it("gives a paint ordinal to what paints and none to what does not", () => {
    settle(fx, () => {
      col({ x: 10, y: 10, w: 200, h: 120, id: "bare" }, () => {
        text("in a bare column");
      });
      panel({ x: 300, y: 10, w: 200, h: 120, id: "framed" }, () => {
        text("in a panel");
      });
    });
    expect(
      layoutTree().map((entry) => `${name(entry)} ${entry.paint === undefined ? "-" : "painted"}`),
    ).toEqual(["col:bare -", "text painted", "panel:framed painted", "text painted"]);
  });

  /** MEASURED, and it is the answer to the question the paint ordinal raised:
   * in this kit
   * the two orders COINCIDE. Every record site is followed immediately by the
   * widget's own draw — `autoContainer` records and then calls `cfg.box`,
   * `place` records and the widget paints into the rect it returned — and
   * nothing anywhere sorts. Even the one genuinely deferred painter, the
   * `select` drop menu, is RECORDED in its deferred pass too, so it lands last
   * in the array as well as last on the canvas.
   *
   * That is worth an assertion rather than a comment precisely because it is a
   * coincidence of the current call sites and not a property anything enforces.
   * The moment a widget defers a draw without deferring its record — which is
   * what a real overlay pass or a two-pass measure would do — the
   * array stops being the paint order, and the check reads `paint` and carries
   * on. */
  it("hands the ordinals out in the array's own order, today", () => {
    settle(fx, () => {
      panel({ x: 10, y: 10, w: 200, h: 200, id: "a" }, () => {
        text("first");
        row({ id: "inner" }, () => {
          button("go", { id: "go" });
        });
      });
      panel({ x: 300, y: 10, w: 200, h: 200, id: "b" }, () => text("second"));
    });
    const painted = layoutTree()
      .map((entry, index) => ({ index, paint: entry.paint }))
      .filter((e): e is { index: number; paint: number } => e.paint !== undefined);
    const ascending = painted.every((e, i) => i === 0 || e.index > painted[i - 1].index);
    expect({ ascending, count: painted.length }).toEqual({
      ascending: true,
      count: painted.length,
    });
    expect(painted.map((e) => e.paint)).toEqual(painted.map((_, i) => i + 1));
  });
});

describe("an overlay covering the screen is the overlay working", () => {
  /** A popover was INVISIBLE to the capture until the paint ordinal: its box is
   * computed
   * inside `popover` rather than through `place`/`autoContainer`, so nothing
   * recorded it — and `runAutoSized`'s `pushLayoutParent`, which opens "the most
   * recent entry", therefore hung the popover's children off the TRIGGER drawn
   * just before it. Both are fixed by recording the box, since the box is then
   * the most recent entry. */
  it("records the popover's own box, with its children under it", () => {
    settle(fx, () => {
      button("open", { x: 40, y: 40, w: 100, h: 30, id: "trigger" });
      popover({ w: 200, open: true, id: "filters" }, () => {
        text("a line inside");
      });
    });
    const tree = layoutTree();
    const box = tree.findIndex((entry) => entry.kind === "popover");
    expect({
      found: box >= 0,
      id: tree[box]?.id,
      overlay: tree[box]?.overlay,
      painted: tree[box]?.paint !== undefined,
      childParent: tree[box + 1]?.parent === box,
      childOverlay: tree[box + 1]?.overlay,
    }).toEqual({
      found: true,
      id: "filters",
      overlay: true,
      painted: true,
      childParent: true,
      childOverlay: true,
    });
  });

  /** The whole point of the exemption. The popover covers a panel drawn before
   * it — completely, opaquely, on purpose — and that is not a finding. */
  it("reports nothing when the overlay is the last thing drawn", () => {
    settle(fx, () => {
      panel({ x: 20, y: 20, w: 300, h: 300, id: "behind" }, () => text("behind the popover"));
      popover({ x: 40, y: 60, w: 200, h: 100, open: true, id: "over-it" }, () => {
        text("on top, legitimately");
      });
    });
    expect(pairs()).toEqual([]);
    // ...and the escape checks were quiet either way, which is why this needed a
    // check of its own.
    expect(layoutIssues()).toEqual([]);
  });

  /** A modal's dim backdrop covers the viewport and eats the pointer over all of
   * it, and the capture had no record of that at all — a reader of the tree saw
   * a centered panel and no sign of what made it modal. */
  it("records the modal's backdrop as the overlay root", () => {
    settle(fx, () => {
      panel({ x: 20, y: 20, w: 300, h: 300, id: "behind" }, () => text("under the dialog"));
      modal({ w: 240, h: 120, title: "Sure?", id: "confirm" }, () => {
        text("Delete everything?");
      });
    });
    const tree = layoutTree();
    const backdrop = tree.findIndex((entry) => entry.kind === "modal");
    const dialog = tree.findIndex((entry) => entry.kind === "panel" && entry.id === "confirm");
    expect({
      backdropId: tree[backdrop]?.id,
      backdropCoversViewport:
        tree[backdrop]?.screenRect.w === 800 && tree[backdrop]?.screenRect.h === 600,
      backdropPainted: tree[backdrop]?.paint !== undefined,
      backdropOverlay: tree[backdrop]?.overlay,
      dialogUnderBackdrop: tree[dialog]?.parent === backdrop,
      dialogOverlay: tree[dialog]?.overlay,
      issues: pairs(),
    }).toEqual({
      // NOT plain `confirm`: the dialog panel already answers to that, and a
      // second entry with the same id changes what a `find` by id resolves to.
      backdropId: "confirm:backdrop",
      backdropCoversViewport: true,
      backdropPainted: true,
      backdropOverlay: true,
      dialogUnderBackdrop: true,
      dialogOverlay: true,
      issues: [],
    });
  });
});

describe("ordinary content painted over an overlay is the fault", () => {
  /** THE REPORTED SHAPE, reproduced. `popover` paints its frame on the spot rather
   * than deferring to an overlay pass, so anything the screen draws AFTER it
   * paints straight through it — which is what a table did to an open
   * JOIN BY CODE box: its header, a cell and two of its own JOIN buttons came
   * through the frame, one of them on top of CANCEL. `layoutIssues` and
   * `layoutLag` were clean the entire time and still are here, which is the
   * measurement that justifies the new check. */
  it("names both rects, and the escape checks still see nothing", () => {
    settle(fx, () => {
      popover({ x: 40, y: 40, w: 200, h: 120, open: true, id: "code-entry" }, () => {
        text("PARTY CODE");
      });
      // The table the screen goes on to draw, overlapping the box.
      panel({ x: 60, y: 100, w: 260, h: 200, id: "roster" }, () => {
        text("PLAYERS");
      });
    });
    expect(layoutIssues()).toEqual([]);
    // Both the frame and the words the table put through it, which is exactly
    // the pair of findings the real screen would have produced. The popover's
    // OWN label is not in the list: it sits above the table's top edge, so those
    // two never met — the check is geometric all the way down.
    expect(pairs()).toEqual([
      "popover:code-entry < panel:roster !overlay",
      "popover:code-entry < text !overlay",
    ]);
    // The assertion a screen should actually carry: nothing may paint through an
    // overlay, whatever else on the screen legitimately overlaps.
    expect(paintIssues().filter((issue) => issue.throughOverlay)).not.toEqual([]);
  });

  /** Move the same popover clear of the table and the fault goes with it — the
   * check is about the rects meeting, not about a popover existing. */
  it("says nothing when the two do not actually meet", () => {
    settle(fx, () => {
      popover({ x: 400, y: 40, w: 200, h: 120, open: true, id: "code-entry" }, () => {
        text("PARTY CODE");
      });
      panel({ x: 60, y: 100, w: 260, h: 200, id: "roster" }, () => text("PLAYERS"));
    });
    expect(pairs()).toEqual([]);
  });
});

describe("a z-order between two ordinary regions", () => {
  /** THE OTHER REPORTED SHAPE. Two HUD regions that genuinely overlap, neither an
   * overlay, where which one is on top is a DESIGN decision and not a fault — so
   * the capture's job is to report the pair with its order and let the screen's
   * own test assert the direction. That assertion used to be impossible
   * headlessly: it had to be settled by eye and pinned with the mock
   * context's `fillText` log, where a word's index in the frame stood in for its
   * depth.
   *
   * Both directions are drawn here, because an ordering assertion between boxes
   * that never met is vacuous and this is the cheapest way to show the check
   * actually turns over. */
  it("reports which of the two painted later, and turns over with the draw order", () => {
    const effects = (): void => {
      panel({ x: 200, y: 100, w: 120, h: 200, id: "hud-effects" }, () => text("12s"));
    };
    const corner = (): void => {
      panel({ x: 160, y: 240, w: 200, h: 160, id: "hud-corner" }, () => text("POWER-UPS"));
    };

    settle(fx, () => {
      effects();
      corner();
    });
    const cornerOver = pairs();

    _reset();
    fx = testApp();
    settle(fx, () => {
      corner();
      effects();
    });
    const effectsOver = pairs();

    // Only the two panels' own pair: each panel also covers the other's LABEL,
    // which is the same finding said twice.
    const between = (lines: string[]): string[] =>
      lines.filter((line) => line.includes("hud-corner") && line.includes("hud-effects"));
    expect({
      cornerOver: between(cornerOver),
      effectsOver: between(effectsOver),
    }).toEqual({
      cornerOver: ["panel:hud-effects < panel:hud-corner"],
      effectsOver: ["panel:hud-corner < panel:hud-effects"],
    });
    // Neither direction is a fault: an overlap between two ordinary regions is a
    // design decision, and only `throughOverlay` is unambiguous.
    expect([...cornerOver, ...effectsOver].some((line) => line.includes("!overlay"))).toBe(false);
  });

  /** Nesting is not occlusion. A container's frame paints UNDER its own children
   * by construction (`autoContainer` calls `cfg.box` before the child pass), so
   * every panel on every screen would otherwise report once per label it holds. */
  it("never reports a child over its own container", () => {
    settle(fx, () => {
      panel({ x: 20, y: 20, w: 300, h: 200, id: "solo" }, () => {
        text("a label");
        row({ id: "buttons" }, () => {
          button("one", { id: "one" });
          button("two", { id: "two" });
        });
      });
    });
    expect(pairs()).toEqual([]);
  });
});
