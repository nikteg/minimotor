// A test-only window hook for the sample pages: it exposes the UI layout-capture
// harness so e2e specs can assert on the geometry the UI actually resolved
// (`UI.layoutIssues()` — children that spill out of the container that laid them
// out, the "UI drawn on top of UI" signature) instead of scraping pixels.
//
// Import it for side effect in any sample worth watching:
//
//     import "../shared/layout-probe.ts";
//
// Capture stays OFF until a spec turns it on, so this costs a page a single
// object assignment and nothing per frame.
import { UI } from "minimotor";

declare global {
  interface Window {
    __uiProbe?: {
      capture(on: boolean): void;
      tree(): ReturnType<typeof UI.layoutTree>;
      issues(): ReturnType<typeof UI.layoutIssues>;
      focused(): string | null;
    };
  }
}

window.__uiProbe = {
  capture: UI.layoutCapture,
  tree: UI.layoutTree,
  issues: UI.layoutIssues,
  focused: UI.focusedId,
};
