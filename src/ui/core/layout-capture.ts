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
import { uiSlot } from "./state.js";

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
  /** Index (into this same array) of the container this rect was placed in, or
   *  `undefined` at the top level. Containers always precede their children. */
  parent?: number;
  /** This container clips/scrolls its children, so they may legitimately
   *  extend past its box (`layoutIssues` stops checking inside it). */
  clips?: boolean;
  /** The rect came from explicit `x`/`y` rather than a layout slot — it was
   *  positioned by hand, so it is not expected to sit inside its container. */
  pinned?: boolean;
}

// Entries recorded so far THIS frame, and the last completed frame's tree.
// Per app, like every other frame-scoped state.
const st = uiSlot<{ frame: LayoutEntry[]; tree: LayoutEntry[] }>(() => ({
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

// The containers currently being filled (indices into this frame's entries),
// innermost last — see `pushLayoutParent`.
const parents: number[] = [];

/** Record one resolved rect — called by `place`/`fillRect`/the containers,
 *  always behind a `layoutCaptureActive` guard. `id` is the raw option value
 *  (stringified here so call sites stay one expression). */
export function recordLayout(
  kind: string,
  id: string | number | undefined,
  rect: { x: number; y: number; w: number; h: number },
  flags?: { clips?: boolean; pinned?: boolean },
): void {
  const tl = uiToScreen(rect.x, rect.y);
  const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
  st().frame.push({
    kind,
    id: id === undefined ? undefined : String(id),
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    screenRect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
    scale: currentUiScale(),
    parent: parents[parents.length - 1],
    clips: flags?.clips,
    pinned: flags?.pinned,
  });
}

/** Open the container that recorded the MOST RECENT entry: everything recorded
 *  until `popLayoutParent` becomes its child. Call it right after a container
 *  records its own box, around the children callback. */
export function pushLayoutParent(): void {
  if (!layoutCaptureActive) return;
  parents.push(st().frame.length - 1);
}

/** Close the container opened by `pushLayoutParent`. */
export function popLayoutParent(): void {
  if (!layoutCaptureActive) return;
  parents.pop();
}

/** A child that escaped its container's box — what `layoutIssues` reports. */
export interface LayoutIssue {
  /** The escaping entry and the container it was placed in. */
  child: LayoutEntry;
  parent: LayoutEntry;
  /** How far past each edge it reached, in screen px (0 = inside). */
  overflow: { left: number; top: number; right: number; bottom: number };
}

/** Layout problems in the captured frame: children that spill out of the
 *  container that laid them out. That is the signature of a container which
 *  failed to size to its content — its children then paint over whatever comes
 *  after it, the classic "UI drawn on top of UI" bug.
 *
 *  Deliberately quiet about the legitimate ways a rect leaves its box: a
 *  clipping/scrolling container (its content is *meant* to overflow, that's
 *  what the clip is for) and a hand-positioned `x`/`y` rect (the caller chose
 *  the coordinates; the container never placed it).
 *
 *      UI.layoutCapture(true);
 *      // ...a frame renders...
 *      expect(UI.layoutIssues()).toEqual([]); */
export function layoutIssues(tolerance = 0.5): LayoutIssue[] {
  const tree = layoutTree();
  const issues: LayoutIssue[] = [];
  // A container inside a clip may itself be scrolled out of its ancestor, so
  // "inside any clipping ancestor" disables the check for the whole subtree.
  const clipped: boolean[] = [];
  for (const [i, e] of tree.entries()) {
    const parentIndex = e.parent;
    const parent = parentIndex === undefined ? undefined : tree[parentIndex];
    clipped[i] = !!e.clips || (parentIndex !== undefined && clipped[parentIndex]);
    if (!parent || e.pinned || clipped[i]) continue;
    const c = e.screenRect;
    const p = parent.screenRect;
    const overflow = {
      left: Math.max(0, p.x - c.x),
      top: Math.max(0, p.y - c.y),
      right: Math.max(0, c.x + c.w - (p.x + p.w)),
      bottom: Math.max(0, c.y + c.h - (p.y + p.h)),
    };
    const worst = Math.max(overflow.left, overflow.top, overflow.right, overflow.bottom);
    if (worst > tolerance) issues.push({ child: e, parent, overflow });
  }
  return issues;
}
