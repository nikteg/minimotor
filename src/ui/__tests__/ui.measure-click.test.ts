/** A click on a button inside an ANCHORED root, which is what the measure pass
 *  must not disturb. The game found this before the kit did, which is the
 *  coverage gap this file closes. */
import { describe, expect, it, beforeEach } from "vitest";
import { createTestUiApp, endTestFrame, stepTestApp } from "./app-fixture.js";
import { createUI } from "../index.js";
import type { App } from "../../core/app.js";
import type { UiApi } from "../api.js";

const ctx = {
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  arcTo() {},
  arc() {},
  closePath() {},
  fill() {},
  stroke() {},
  fillRect() {},
  strokeRect() {},
  clip() {},
  translate() {},
  scale() {},
  rect() {},
  setTransform() {},
  drawImage() {},
  measureText: () => ({ width: 40, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
  fillText() {},
  strokeText() {},
  createLinearGradient: () => ({ addColorStop() {} }),
  canvas: {
    width: 1280,
    height: 720,
    style: {},
    hasAttribute: () => true,
    focus: () => {},
    tabIndex: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  font: "13px monospace",
  textBaseline: "alphabetic",
  textAlign: "left",
  fillStyle: "#fff",
  strokeStyle: "#fff",
  lineWidth: 1,
  globalAlpha: 1,
} as unknown as CanvasRenderingContext2D;

describe("a click inside an anchored root", () => {
  let app: App;
  let UI: UiApi;
  beforeEach(() => {
    app = createTestUiApp(ctx);
    UI = createUI(app);
  });

  const render = (fired: string[]) =>
    UI.col({ anchor: "bottomLeft", margin: 0, gap: 0, id: "corner" }, () => {
      if (UI.button({ id: "go", label: "GO" })) fired.push("go");
    });

  const renderPopover = (fired: string[]) =>
    UI.col({ anchor: "center", margin: 0, gap: 0, id: "screen" }, () => {
      UI.button({ id: "trigger", label: "OPEN" });
      UI.popover({ id: "pop", open: true, x: 100, y: 100, w: 200 }, () => {
        // The FIELD is the structural difference the game has and the earlier
        // reproductions did not: a native editor inside a measured root.
        UI.field({ label: "Code", id: "code" }, (id, layout) => {
          UI.textInput({ id, value: "", onChange: () => {}, at: layout });
        });
        if (UI.button({ id: "submit", label: "JOIN" })) fired.push("submit");
      });
    });

  it("fires inside a POPOVER in an anchored root, which is the reported case", () => {
    const fired: string[] = [];
    for (let f = 0; f < 2; f++) {
      stepTestApp(app);
      UI.layoutCapture(true);
      renderPopover(fired);
      endTestFrame(app);
    }
    const rect = UI.layoutTree().find((e) => e.id === "submit")!.screenRect;
    const pointer = app.Pointer as unknown as Record<string, unknown>;
    pointer.x = rect.x + rect.w / 2;
    pointer.y = rect.y + rect.h / 2;
    pointer.inside = true;
    pointer.released = true;
    pointer.frameReleased = true;
    stepTestApp(app);
    UI.layoutCapture(true);
    renderPopover(fired);
    endTestFrame(app);
    expect(fired).toEqual(["submit"]);
  });

  // A third case — the popover drawn OUTSIDE the anchored root and the whole
  // screen inside `UI.scaled` — was written and REMOVED. It failed identically
  // with the measure pass switched off, so it was measuring this file's own
  // click plumbing under a transform rather than anything about the kit. The
  // real version of that case is `join-by-code-check` in the game, which does
  // drive a scaled screen properly and which passes.

  it("fires, and fires exactly once", () => {
    const fired: string[] = [];
    // Settle, so the anchored box is where it will be when clicked.
    for (let f = 0; f < 2; f++) {
      stepTestApp(app);
      UI.layoutCapture(true);
      render(fired);
      endTestFrame(app);
    }
    const rect = UI.layoutTree().find((e) => e.id === "go")!.screenRect;
    const pointer = app.Pointer as unknown as Record<string, unknown>;
    pointer.x = rect.x + rect.w / 2;
    pointer.y = rect.y + rect.h / 2;
    pointer.inside = true;
    pointer.released = true;
    // `uiPointer` reads the FRAME edge (`input.ts:280`), not the level.
    pointer.frameReleased = true;
    stepTestApp(app);
    UI.layoutCapture(true);
    render(fired);
    endTestFrame(app);
    // Exactly once: a measure pass runs the children an extra time, and a
    // button that fired in both runs would double every action in the UI.
    expect(fired).toEqual(["go"]);
  });
});
