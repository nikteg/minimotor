// ---------- Layout capture (verification harness) ----------
// An opt-in recorder for tests and debugging: while enabled, every rect the
// layout resolves — widget slots through `place`/`fillRect`, container boxes
// through `autoContainer`/the scroll containers — is captured with its
// reference rect, its on-screen rect (via `uiToScreen`) and the active UI
// scale. `layoutTree()` then hands back the last COMPLETED frame's entries, so
// a test can assert where everything actually landed (positions under
// `UI.scaled`, containment, non-overlap) without scraping canvas calls.
//
// Disabled (the default) the whole thing is one module-level boolean check at
// each record site — nothing is allocated, mapped or stored.

import { currentUiScale, uiToScreen } from "./input.js";
import { onFrameEnd, onReset } from "./lifecycle.js";
import { runtimeSlot } from "./runtime.js";

/** One captured rect: a widget slot or a container box. */
export interface LayoutEntry {
  /** What resolved the rect: a container kind (`"row"`, `"col"`, `"panel"`, …)
   *  or a widget kind (`"button"`, `"slider"`, `"text"`, …); `"widget"` /
   *  `"fill"` for placements whose call site passes none. */
  kind: string;
  /** The stable id the widget/container's options carried, if any. */
  id?: string;
  /** The resolved rect in the coords the widget laid out with — reference
   *  coords inside a `UI.scaled` block, screen-logical at the root. */
  rect: { x: number; y: number; w: number; h: number };
  /** The same rect mapped out to SCREEN-logical coords (via `uiToScreen`) —
   *  where it actually lands on the canvas. Equal to `rect` at the root. */
  screenRect: { x: number; y: number; w: number; h: number };
  /** The UI scale active at placement (`currentUiScale`; 1 at the root). */
  scale: number;
}

// Entries recorded so far THIS frame, and the last completed frame's tree.
// Per runtime, like every other frame-scoped state.
const st = runtimeSlot<{ frame: LayoutEntry[]; tree: LayoutEntry[] }>(() => ({
  frame: [],
  tree: [],
}));

/** The zero-cost-when-off guard: record sites check this boolean and skip the
 *  `recordLayout` call entirely while capture is disabled. */
export let layoutCaptureActive = false;

// The frame boundary: entries collected during a frame become the readable
// tree at frame end. Registered once, on first enable; capture also turns
// itself off on the test `_reset` so the flag can't leak across tests.
let hookWired = false;
function ensureCaptureHook(): void {
  if (hookWired) return;
  hookWired = true;
  onFrameEnd(() => {
    const s = st();
    s.tree = s.frame;
    s.frame = [];
  });
  onReset(() => {
    layoutCaptureActive = false;
  });
}

/** Turn layout capture on or off (off clears any captured tree). While on,
 *  every placed widget/container rect is recorded for `layoutTree()` — a test
 *  and debugging aid; leave it off in production draw loops. */
export function layoutCapture(on: boolean): void {
  layoutCaptureActive = on;
  if (on) {
    ensureCaptureHook();
  } else {
    const s = st();
    s.frame.length = 0;
    s.tree.length = 0;
  }
}

/** The layout entries captured for the last COMPLETED frame (draw order —
 *  containers before the children placed inside them). Empty until a frame
 *  has finished with capture enabled:
 *
 *    UI.layoutCapture(true);
 *    // ...one frame renders...
 *    const buttons = UI.layoutTree().filter((e) => e.kind === "button"); */
export function layoutTree(): LayoutEntry[] {
  return st().tree;
}

/** Record one resolved rect — called by `place`/`fillRect`/the containers,
 *  always behind a `layoutCaptureActive` guard. `id` is the raw option value
 *  (stringified here so call sites stay one expression). */
export function recordLayout(
  kind: string,
  id: string | number | undefined,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const tl = uiToScreen(rect.x, rect.y);
  const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
  st().frame.push({
    kind,
    id: id === undefined ? undefined : String(id),
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    screenRect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
    scale: currentUiScale(),
  });
}
