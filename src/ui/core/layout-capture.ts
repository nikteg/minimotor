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

import { uiCtx } from "./context.js";
import { currentUiScale, uiToScreen } from "./input.js";
import { ensureWired, onFrameEnd, onReset } from "./lifecycle.js";
import { armPaint, resetPaintSeq } from "./paint-seq.js";
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
  /** How far this container's drawn box was off its own content, per axis —
   *  set only for a container that could not be measured in-frame and so drew
   *  at last frame's size. See `layoutLag`. */
  lag?: { w: number; h: number };
  /** The auto-size cache key another container ALSO used this frame. Two
   *  containers sharing one key are reading each other's measurements. */
  sharedKey?: string;
  /** The words in the box, for a widget that draws a label of its own.
   *
   *  Set by `UI.text`, which is the one widget whose entire output is a string
   *  and which takes no `id` — so before this, a captured tree could say a
   *  label occupied a rect but never what it said, and the only headless way to
   *  ask was to scrape `fillText` off the context.
   *
   *  Crucially it is the COMBINED string: a label built from colour runs
   *  reports the one line those runs concatenate to, exactly as `textWidth`
   *  measures it and as the wrap is computed from. A reader of the tree — a
   *  test, a debug overlay, or anything reading the screen out — sees the
   *  sentence, never the fragments the paint happened to be cut into. */
  text?: string;
  /** WHEN this rect was drawn, as a 1-based ordinal over the frame's painted
   *  entries — the sequence the kit actually issued the draws in, kept apart
   *  from this array's own PLACEMENT order.
   *
   *  The two are not the same question and the array order answers only the
   *  second: entries arrive as a tree, containers before the children they
   *  hold, and a container that paints nothing still takes an index. So
   *  `paint` is **absent** for every entry that put no pixels down — a bare
   *  `row`/`col`, a `UI.fill` reservation whose caller drew with the raw
   *  context — and those entries cannot occlude anything. See `paintIssues`,
   *  which is the check this exists for. */
  paint?: number;
  /** This rect was recorded inside an overlay's own draw — a `popover` or
   *  `modal` body, or the deferred `select` menu. An overlay is SUPPOSED to
   *  paint over the screen beneath it, so `paintIssues` never reports one as
   *  the offender; the interesting case is the reverse, something ordinary
   *  painting over an overlay after it went up. */
  overlay?: true;
}

// Entries recorded so far THIS frame, and the last completed frame's tree.
// Per app, like every other frame-scoped state.
const st = uiSlot<{
  frame: LayoutEntry[];
  tree: LayoutEntry[];
  /** Auto-size cache keys used this frame → the entry that used them first.
   *  A second user of the same key is a collision, not a coincidence. */
  keys: Map<string, number>;
}>(() => ({
  frame: [],
  tree: [],
  keys: new Map(),
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
    s.keys.clear();
    resetPaintSeq();
    overlayDepth = 0;
  });
  onReset(() => {
    layoutCaptureActive = false;
    resetPaintSeq();
    overlayDepth = 0;
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
    s.keys.clear();
    resetPaintSeq();
    overlayDepth = 0;
  }
}

/** The layout entries captured for the last COMPLETED frame, in PLACEMENT order
 *  — containers before the children placed inside them, which is a tree and not
 *  a paint sequence. For when a rect was drawn, read `LayoutEntry.paint`; the
 *  two coincide today but nothing enforces that, and `paintIssues` is the check
 *  that uses the paint one. Empty until a frame has finished with capture
 *  enabled:
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
): number {
  const frame = st().frame;
  // Registering the frame-end hook is not enough on its own: `appFrameEnd` —
  // the thing that RUNS the hooks — is attached to the app by `ensureWired`,
  // which is otherwise reached only through the input layer. A screen built out
  // of nothing but `UI.text` touches no input, so as far as this module is
  // concerned the frame never ends and `layoutTree()` stays empty however many
  // frames the caller draws. Capture's whole contract is that entries become
  // readable at the frame boundary, so it has to ask for one.
  //
  // Here rather than in `layoutCapture(true)` because that can be called with
  // no app selected at all — several tests do — and `ensureWired` reads the
  // current app. The first record of a frame is always inside one. It costs one
  // length comparison per rect and one already-idempotent call per frame.
  if (frame.length === 0) ensureWired();
  const tl = uiToScreen(rect.x, rect.y);
  const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
  const entry: LayoutEntry = {
    kind,
    id: id === undefined ? undefined : String(id),
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    screenRect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
    scale: currentUiScale(),
    parent: parents[parents.length - 1],
    clips: flags?.clips,
    pinned: flags?.pinned,
    overlay: overlayDepth > 0 ? true : undefined,
  };
  // Whatever the kit draws next belongs to this rect until something else is
  // recorded — the same "most recent entry" idiom as `annotateLayoutText`.
  armPaint(entry);
  return frame.push(entry) - 1;
}

/** Rewrite an entry's geometry after the fact. A container placed into a
 *  deferred slot records itself BEFORE its children (so the tree keeps draw
 *  order and the children hang off it) but only learns its true size after
 *  them — this is how the recorded rect catches up, instead of the tree
 *  reporting the provisional size the container was never drawn at.
 *  `index` is what `recordLayout` returned; -1 is ignored. */
export function refreshLayoutRect(
  index: number,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const entry = st().frame[index];
  if (!entry) return;
  const tl = uiToScreen(rect.x, rect.y);
  const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
  entry.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  entry.screenRect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/** Hang the label a widget just drew on the entry it just recorded.
 *
 *  Same "the MOST RECENT entry" idiom as `pushLayoutParent`: the caller records
 *  its rect through `place` and annotates it on the next line, with nothing in
 *  between that could record. Kept separate from `recordLayout` so the generic
 *  `place` path — every widget in the kit — carries no text parameter it has
 *  nothing to put in. */
export function annotateLayoutText(str: string): void {
  if (!layoutCaptureActive) return;
  const frame = st().frame;
  const entry = frame[frame.length - 1];
  if (entry) entry.text = str;
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

// How many overlays own the draw right now. A COUNTER rather than a flag
// because overlays nest — a `select` inside a `modal` is ordinary — and because
// the frame-wide `isInOverlayPass()` cannot answer this question at all: it goes
// true when an immediate `popover` opens and stays true for the rest of the
// frame, so it would mark everything drawn AFTER the popover as an overlay,
// which is precisely item 115's fault wearing the exemption meant to excuse it.
let overlayDepth = 0;

/** Everything recorded until `popLayoutOverlay` belongs to an overlay and is
 *  entitled to paint over what is beneath it. Called by `popover` and `modal`
 *  around their own box and body, and by the deferred `select` menu pass. */
export function pushLayoutOverlay(): void {
  overlayDepth++;
}

/** Leave the innermost overlay opened by `pushLayoutOverlay`. */
export function popLayoutOverlay(): void {
  if (overlayDepth > 0) overlayDepth--;
}

/** Record what an auto-sized container's box was actually worth, once its
 *  children have been measured. Called only from `autoContainer`, only while
 *  capture is on.
 *
 *  `off` is how far the drawn box missed the content it turned out to hold —
 *  nonzero means the container drew at last frame's size, which is the
 *  one-frame pop. `key` is its auto-size cache key; the SECOND container to
 *  claim a key in one frame marks both as sharing it. */
export function noteContainerSize(
  index: number,
  key: string | undefined,
  off: { w: number; h: number },
): void {
  const s = st();
  const entry = s.frame[index];
  if (!entry) return;
  if (off.w !== 0 || off.h !== 0) entry.lag = off;
  if (key === undefined) return;
  const first = s.keys.get(key);
  if (first === undefined) {
    s.keys.set(key, index);
    return;
  }
  entry.sharedKey = key;
  const other = s.frame[first];
  if (other) other.sharedKey = key;
}

/** A container that drew at the wrong size, and why — what `layoutLag`
 *  reports. */
export interface LayoutLag {
  /** The container whose box missed its content. */
  entry: LayoutEntry;
  /** Px the drawn box was off its measured content, per axis. Positive means
   *  the box was too big, negative too small. */
  off: { w: number; h: number };
  /** Set when a second container used the same auto-size cache key in the same
   *  frame — then the wrong size isn't lag, it's another container's
   *  measurement. Give the containers distinct `id`s, or wrap each screen in
   *  its own `UI.idScope`. */
  sharedKey?: string;
}

/** Containers whose drawn box did not match their own content in the captured
 *  frame — the direct, named form of the "one-frame layout pop".
 *
 *  Most containers are measured IN the frame they draw (see `Flow.reserve`) and
 *  never appear here. The ones that can't be — a `panel`/`group` whose backdrop
 *  has to paint under its children, a wrapping or end-justified container —
 *  fall back to last frame's measurement, and this is where that shows up
 *  instead of as a visual glitch you have to catch by eye.
 *
 *  A `sharedKey` on the finding changes the diagnosis: the size wasn't stale,
 *  it belonged to a DIFFERENT container that hashed to the same structural
 *  cache key. That is the two-screens-of-the-same-shape bug, and no amount of
 *  waiting fixes it.
 *
 *      UI.layoutCapture(true);
 *      // ...a frame renders...
 *      expect(UI.layoutLag()).toEqual([]); */
export function layoutLag(tolerance = 0.5): LayoutLag[] {
  const found: LayoutLag[] = [];
  for (const entry of layoutTree()) {
    if (entry.sharedKey !== undefined) {
      found.push({ entry, off: entry.lag ?? { w: 0, h: 0 }, sharedKey: entry.sharedKey });
      continue;
    }
    const off = entry.lag;
    if (off && (Math.abs(off.w) > tolerance || Math.abs(off.h) > tolerance)) {
      found.push({ entry, off });
    }
  }
  return found;
}

/** Knobs for `drawLayoutOverlay`. */
export interface LayoutOverlayOptions {
  /** Draw only these kinds (`["panel", "col", "row"]` to see containers
   *  alone). Default: everything captured. */
  kinds?: readonly string[];
  /** Label the boxes. `"containers"` (the default) names only the
   *  panels/rows/cols that carry an explicit `id` — the ones whose edges you
   *  are trying to place. `"all"` adds every named widget, which is legible
   *  only on a sparse screen; `"none"` draws boxes alone. */
  labels?: "containers" | "all" | "none";
  /** Wash the canvas with this much black (0–1) first, so the boxes read over
   *  a busy screen. Default 0. */
  dim?: number;
}

const BACKDROP_CONTAINERS = new Set(["panel", "group", "popover", "modal"]);
const FLOW_CONTAINERS = new Set(["row", "col", "grid", "flow", "clip"]);

/** Containers get a warmer, heavier box than the widgets inside them — the
 *  point of the overlay is to see where a container's edge sits relative to
 *  its content, which is what padding IS. */
function overlayColor(kind: string): { stroke: string; width: number } {
  if (BACKDROP_CONTAINERS.has(kind)) return { stroke: "#ff4ecb", width: 1.5 };
  if (FLOW_CONTAINERS.has(kind)) return { stroke: "#35d9ff", width: 1 };
  return { stroke: "rgba(167,245,66,0.65)", width: 1 };
}

/** Draw every captured layout box over the finished frame — the visual form of
 *  `layoutTree()`, for eyeballing padding, gaps and alignment against the art.
 *
 *  Needs `layoutCapture(true)`; it draws the last COMPLETED frame, so with
 *  capture left on it trails the live UI by one frame (invisible in practice,
 *  and the reason a toggle should enable capture and the overlay together).
 *
 *  Boxes are drawn from `screenRect`, which is already screen-logical — call
 *  it at the ROOT of the draw, OUTSIDE any `UI.scaled` block, or the scale is
 *  applied twice. Findings win over kind: a child that escaped its container
 *  (`layoutIssues`) is red, as is anything painted THROUGH an open overlay
 *  (`paintIssues`); a container that drew at a stale size (`layoutLag`) is
 *  orange.
 *
 *      UI.layoutCapture(debugOn);
 *      UI.scaled(() => buildTheWholeUI());
 *      if (debugOn) UI.drawLayoutOverlay({ dim: 0.15 }); */
export function drawLayoutOverlay(opts: LayoutOverlayOptions = {}): void {
  const tree = layoutTree();
  if (tree.length === 0) return;
  const ctx = uiCtx();
  const escaped = new Set(layoutIssues().map((issue) => issue.child));
  const stale = new Set(layoutLag().map((finding) => finding.entry));
  // Only the unambiguous half of `paintIssues`. Two ordinary regions that
  // overlap are a design decision and belong in a test's report, not painted
  // red over the art every frame; something drawn through an OPEN OVERLAY is a
  // fault however it got there, and this is the only place a reader would see it
  // without knowing to go looking.
  const throughOverlay = new Set(
    paintIssues()
      .filter((issue) => issue.throughOverlay)
      .map((issue) => issue.over),
  );
  const wanted = opts.kinds ? new Set(opts.kinds) : undefined;
  const labels = opts.labels ?? "containers";
  ctx.save();
  if (opts.dim) {
    ctx.fillStyle = `rgba(0,0,0,${opts.dim})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  // A fixed font, not the theme's: a broken or highly decorative skin must not
  // be able to make its own debugger unreadable.
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const entry of tree) {
    if (wanted && !wanted.has(entry.kind)) continue;
    const r = entry.screenRect;
    if (r.w <= 0 || r.h <= 0) continue;
    const look = escaped.has(entry)
      ? { stroke: "#ff4b4b", width: 2 }
      : throughOverlay.has(entry)
        ? { stroke: "#ff4b4b", width: 2 }
        : stale.has(entry)
          ? { stroke: "#ffad42", width: 2 }
          : overlayColor(entry.kind);
    ctx.strokeStyle = look.stroke;
    ctx.lineWidth = look.width;
    // The half-pixel offset is what keeps a 1px stroke on the pixel rather
    // than smeared across two of them.
    const half = look.width / 2;
    ctx.strokeRect(
      r.x + half,
      r.y + half,
      Math.max(0, r.w - look.width),
      Math.max(0, r.h - half * 2),
    );
    if (labels === "none" || entry.id === undefined) continue;
    const container = BACKDROP_CONTAINERS.has(entry.kind) || FLOW_CONTAINERS.has(entry.kind);
    if (labels === "containers" && !container) continue;
    ctx.fillStyle = look.stroke;
    ctx.fillText(`${entry.kind}:${entry.id}`, r.x + 2, r.y + 2);
  }
  ctx.restore();
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

/** Two rects that were painted over one another — what `paintIssues` reports. */
export interface PaintIssue {
  /** The entry that painted FIRST and is therefore the one underneath. */
  under: LayoutEntry;
  /** The entry that painted over it. Never an overlay: an overlay covering the
   *  screen beneath it is the overlay working. */
  over: LayoutEntry;
  /** Where the two met, in screen px, already clipped to both entries'
   *  clipping ancestors — so a row scrolled out of a list does not report an
   *  overlap it is masked out of. */
  overlap: { x: number; y: number; w: number; h: number };
  /** `under` is an OVERLAY. This is the unambiguous form of the fault: a
   *  popover, a modal or an open menu is up, and ordinary content drawn later
   *  in the frame has painted straight through it. Nothing legitimate does
   *  this — the rest of the list is pairs whose order is a design decision. */
  throughOverlay?: true;
}

/** Intersect an entry's screen rect with every clipping ancestor's, which is
 *  the part of it that can actually reach the canvas. */
function visibleRect(
  tree: readonly LayoutEntry[],
  index: number,
): { x: number; y: number; w: number; h: number } {
  const e = tree[index];
  let { x, y, w, h } = e.screenRect;
  let at = e.parent;
  while (at !== undefined) {
    const ancestor = tree[at];
    if (!ancestor) break;
    if (ancestor.clips) {
      const c = ancestor.screenRect;
      const nx = Math.max(x, c.x);
      const ny = Math.max(y, c.y);
      w = Math.min(x + w, c.x + c.w) - nx;
      h = Math.min(y + h, c.y + c.h) - ny;
      x = nx;
      y = ny;
      if (w <= 0 || h <= 0) return { x, y, w: 0, h: 0 };
    }
    at = ancestor.parent;
  }
  return { x, y, w, h };
}

/** Whether `a` is `b` or one of its ancestors. */
function inSubtree(tree: readonly LayoutEntry[], a: number, b: number): boolean {
  let at: number | undefined = b;
  while (at !== undefined) {
    if (at === a) return true;
    at = tree[at]?.parent;
  }
  return false;
}

/** Rects the captured frame painted over one another, later paint first.
 *
 *  The check `layoutIssues` cannot make. That one compares a child against the
 *  container that placed it, which catches a box too small for its contents and
 *  nothing else; two rects that never shared a parent can sit straight on top of
 *  each other with `layoutIssues` and `layoutLag` clean the whole time. They did,
 *  twice — a party table painted through an open popover, and a HUD panel and a
 *  status column whose z-order could only be settled by eye.
 *
 *  What is reported: a pair whose visible rects overlap, where the LATER-painted
 *  one is not an overlay. Three things are deliberately not in it:
 *
 *  - an entry that painted nothing (no `paint` — a bare `row`/`col`, an unused
 *    `fill` slot). Geometry that puts no pixels down cannot cover anything;
 *  - an entry painting over its own container, or over anything else on its own
 *    ancestor line. That is what nesting IS;
 *  - an overlay as the offender. A `popover`, a `modal` and an open `select`
 *    menu are built to cover the screen; `throughOverlay` marks the reverse,
 *    which is never legitimate.
 *
 *  What is LEFT in the list is not automatically a bug — two HUD panels that
 *  deliberately overlap belong here, and which of them is on top is a design
 *  decision. So the consumer's assertion is usually about the CONTENTS:
 *
 *      expect(UI.paintIssues().filter((i) => i.throughOverlay)).toEqual([]);
 *
 *  ...for the fault shape, and a named pair's `over`/`under` for a z-order that
 *  is meant to be a particular way round. `O(n²)` over the frame's painted
 *  entries — a harness call, like the rest of this module. */
export function paintIssues(tolerance = 0.5): PaintIssue[] {
  const tree = layoutTree();
  const painted: number[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const [i, e] of tree.entries()) {
    if (e.paint === undefined) continue;
    const r = visibleRect(tree, i);
    if (r.w <= tolerance || r.h <= tolerance) continue;
    painted.push(i);
    rects[i] = r;
  }
  // Paint order, not array order: the two coincide today (every record site is
  // followed by the widget's own draw) and the whole point of the field is that
  // the check does not have to depend on that staying true.
  painted.sort((a, b) => tree[a].paint! - tree[b].paint!);
  const issues: PaintIssue[] = [];
  for (let i = 0; i < painted.length; i++) {
    const ai = painted[i];
    for (let j = i + 1; j < painted.length; j++) {
      const bi = painted[j];
      const over = tree[bi];
      if (over.overlay) continue;
      if (inSubtree(tree, ai, bi) || inSubtree(tree, bi, ai)) continue;
      const a = rects[ai];
      const b = rects[bi];
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const w = Math.min(a.x + a.w, b.x + b.w) - x;
      const h = Math.min(a.y + a.h, b.y + b.h) - y;
      if (w <= tolerance || h <= tolerance) continue;
      const under = tree[ai];
      issues.push({
        under,
        over,
        overlap: { x, y, w, h },
        throughOverlay: under.overlay ? true : undefined,
      });
    }
  }
  return issues;
}
