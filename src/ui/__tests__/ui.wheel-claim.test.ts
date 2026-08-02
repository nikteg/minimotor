import { describe, expect, it } from "vitest";
import { claimWheel } from "@src/ui/core/input.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp, endTestFrame } from "./app-fixture.js";

// `claimWheel` is how two nested wheel consumers agree on who gets the notch:
// the first to claim wins for the frame. The claim therefore MUST be released
// at frame end, and for a long time that release was registered by `lists` —
// so a screen with a wheel consumer but no scroll region (a lone
// `UI.viewport3d`) claimed once on frame one and never got the wheel back. The
// first notch zoomed; every notch after it vanished, silently.

function testApp() {
  const ctx = { canvas: { width: 800, height: 600 } } as unknown as CanvasRenderingContext2D;
  const app = createTestUiApp(ctx);
  selectUiApp(app);
  return app;
}

describe("claimWheel", () => {
  it("gives the notch to the first claimant and nothing to the second", () => {
    testApp();
    expect(claimWheel(true, -100, false, false)).toBe(-100);
    expect(claimWheel(true, -100, false, false)).toBe(0);
  });

  it("releases the claim at frame end even with no scroll region on screen", () => {
    // The regression. Without `claimWheel` registering its own reset this
    // second frame returns 0, and a viewport's zoom dies after one notch.
    const app = testApp();
    expect(claimWheel(true, -100, false, false)).toBe(-100);
    // The frame boundary also clears the ambient app selection, exactly as the
    // real kernel does — so each new frame re-selects, as `createUI`'s bound
    // functions do.
    endTestFrame(app);
    selectUiApp(app);
    expect(claimWheel(true, -100, false, false)).toBe(-100);
    endTestFrame(app);
    selectUiApp(app);
    expect(claimWheel(true, -100, false, false)).toBe(-100);
  });

  it("passes the wheel on when the claimant is pinned in that direction", () => {
    // A fully scrolled-up region must not swallow an upward notch: the point of
    // atMin/atMax is that the gesture chains to whatever encloses it.
    testApp();
    expect(claimWheel(true, -100, true, false)).toBe(0);
    // …and the unclaimed notch is still there for the next consumer.
    expect(claimWheel(true, -100, false, false)).toBe(-100);
  });

  it("ignores a pointer that is elsewhere, and a zero delta", () => {
    testApp();
    expect(claimWheel(false, -100, false, false)).toBe(0);
    expect(claimWheel(true, 0, false, false)).toBe(0);
    expect(claimWheel(true, -100, false, false)).toBe(-100);
  });

  it("keeps two apps' claims apart", () => {
    // The claim is per-app state; two canvases on one page must not steal each
    // other's wheel.
    const a = testApp();
    expect(claimWheel(true, -100, false, false)).toBe(-100);
    const b = testApp();
    expect(claimWheel(true, -100, false, false)).toBe(-100);
    // And each clears its own, independently.
    endTestFrame(a);
    selectUiApp(a);
    expect(claimWheel(true, -100, false, false)).toBe(-100);
    selectUiApp(b);
    expect(claimWheel(true, -100, false, false)).toBe(0);
  });
});
