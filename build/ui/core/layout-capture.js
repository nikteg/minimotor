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
import { onFrameEnd, onReset } from "./lifecycle.js";
import { uiSlot } from "./state.js";
// Entries recorded so far THIS frame, and the last completed frame's tree.
// Per app, like every other frame-scoped state.
const st = uiSlot(() => ({
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
function ensureCaptureHook() {
    if (hookWired)
        return;
    hookWired = true;
    onFrameEnd(() => {
        const s = st();
        s.tree = s.frame;
        s.frame = [];
        s.keys.clear();
    });
    onReset(() => {
        layoutCaptureActive = false;
    });
}
/** Turn layout capture on or off (off clears any captured tree). While on,
 *  every placed widget/container rect is recorded for `layoutTree()` — a test
 *  and debugging aid; leave it off in production draw loops. */
export function layoutCapture(on) {
    layoutCaptureActive = on;
    if (on) {
        ensureCaptureHook();
    }
    else {
        const s = st();
        s.frame.length = 0;
        s.tree.length = 0;
        s.keys.clear();
    }
}
/** The layout entries captured for the last COMPLETED frame (draw order —
 *  containers before the children placed inside them). Empty until a frame
 *  has finished with capture enabled:
 *
 *    UI.layoutCapture(true);
 *    // ...one frame renders...
 *    const buttons = UI.layoutTree().filter((e) => e.kind === "button"); */
export function layoutTree() {
    return st().tree;
}
// The containers currently being filled (indices into this frame's entries),
// innermost last — see `pushLayoutParent`.
const parents = [];
/** Record one resolved rect — called by `place`/`fillRect`/the containers,
 *  always behind a `layoutCaptureActive` guard. `id` is the raw option value
 *  (stringified here so call sites stay one expression). */
export function recordLayout(kind, id, rect, flags) {
    const tl = uiToScreen(rect.x, rect.y);
    const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
    return (st().frame.push({
        kind,
        id: id === undefined ? undefined : String(id),
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        screenRect: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
        scale: currentUiScale(),
        parent: parents[parents.length - 1],
        clips: flags?.clips,
        pinned: flags?.pinned,
    }) - 1);
}
/** Rewrite an entry's geometry after the fact. A container placed into a
 *  deferred slot records itself BEFORE its children (so the tree keeps draw
 *  order and the children hang off it) but only learns its true size after
 *  them — this is how the recorded rect catches up, instead of the tree
 *  reporting the provisional size the container was never drawn at.
 *  `index` is what `recordLayout` returned; -1 is ignored. */
export function refreshLayoutRect(index, rect) {
    const entry = st().frame[index];
    if (!entry)
        return;
    const tl = uiToScreen(rect.x, rect.y);
    const br = uiToScreen(rect.x + rect.w, rect.y + rect.h);
    entry.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    entry.screenRect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}
/** Open the container that recorded the MOST RECENT entry: everything recorded
 *  until `popLayoutParent` becomes its child. Call it right after a container
 *  records its own box, around the children callback. */
export function pushLayoutParent() {
    if (!layoutCaptureActive)
        return;
    parents.push(st().frame.length - 1);
}
/** Close the container opened by `pushLayoutParent`. */
export function popLayoutParent() {
    if (!layoutCaptureActive)
        return;
    parents.pop();
}
/** Record what an auto-sized container's box was actually worth, once its
 *  children have been measured. Called only from `autoContainer`, only while
 *  capture is on.
 *
 *  `off` is how far the drawn box missed the content it turned out to hold —
 *  nonzero means the container drew at last frame's size, which is the
 *  one-frame pop. `key` is its auto-size cache key; the SECOND container to
 *  claim a key in one frame marks both as sharing it. */
export function noteContainerSize(index, key, off) {
    const s = st();
    const entry = s.frame[index];
    if (!entry)
        return;
    if (off.w !== 0 || off.h !== 0)
        entry.lag = off;
    if (key === undefined)
        return;
    const first = s.keys.get(key);
    if (first === undefined) {
        s.keys.set(key, index);
        return;
    }
    entry.sharedKey = key;
    const other = s.frame[first];
    if (other)
        other.sharedKey = key;
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
export function layoutLag(tolerance = 0.5) {
    const found = [];
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
const BACKDROP_CONTAINERS = new Set(["panel", "group", "popover", "modal"]);
const FLOW_CONTAINERS = new Set(["row", "col", "grid", "flow", "clip"]);
/** Containers get a warmer, heavier box than the widgets inside them — the
 *  point of the overlay is to see where a container's edge sits relative to
 *  its content, which is what padding IS. */
function overlayColor(kind) {
    if (BACKDROP_CONTAINERS.has(kind))
        return { stroke: "#ff4ecb", width: 1.5 };
    if (FLOW_CONTAINERS.has(kind))
        return { stroke: "#35d9ff", width: 1 };
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
 *  (`layoutIssues`) is red, a container that drew at a stale size
 *  (`layoutLag`) is orange.
 *
 *      UI.layoutCapture(debugOn);
 *      UI.scaled(() => buildTheWholeUI());
 *      if (debugOn) UI.drawLayoutOverlay({ dim: 0.15 }); */
export function drawLayoutOverlay(opts = {}) {
    const tree = layoutTree();
    if (tree.length === 0)
        return;
    const ctx = uiCtx();
    const escaped = new Set(layoutIssues().map((issue) => issue.child));
    const stale = new Set(layoutLag().map((finding) => finding.entry));
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
        if (wanted && !wanted.has(entry.kind))
            continue;
        const r = entry.screenRect;
        if (r.w <= 0 || r.h <= 0)
            continue;
        const look = escaped.has(entry)
            ? { stroke: "#ff4b4b", width: 2 }
            : stale.has(entry)
                ? { stroke: "#ffad42", width: 2 }
                : overlayColor(entry.kind);
        ctx.strokeStyle = look.stroke;
        ctx.lineWidth = look.width;
        // The half-pixel offset is what keeps a 1px stroke on the pixel rather
        // than smeared across two of them.
        const half = look.width / 2;
        ctx.strokeRect(r.x + half, r.y + half, Math.max(0, r.w - look.width), Math.max(0, r.h - half * 2));
        if (labels === "none" || entry.id === undefined)
            continue;
        const container = BACKDROP_CONTAINERS.has(entry.kind) || FLOW_CONTAINERS.has(entry.kind);
        if (labels === "containers" && !container)
            continue;
        ctx.fillStyle = look.stroke;
        ctx.fillText(`${entry.kind}:${entry.id}`, r.x + 2, r.y + 2);
    }
    ctx.restore();
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
export function layoutIssues(tolerance = 0.5) {
    const tree = layoutTree();
    const issues = [];
    // A container inside a clip may itself be scrolled out of its ancestor, so
    // "inside any clipping ancestor" disables the check for the whole subtree.
    const clipped = [];
    for (const [i, e] of tree.entries()) {
        const parentIndex = e.parent;
        const parent = parentIndex === undefined ? undefined : tree[parentIndex];
        clipped[i] = !!e.clips || (parentIndex !== undefined && clipped[parentIndex]);
        if (!parent || e.pinned || clipped[i])
            continue;
        const c = e.screenRect;
        const p = parent.screenRect;
        const overflow = {
            left: Math.max(0, p.x - c.x),
            top: Math.max(0, p.y - c.y),
            right: Math.max(0, c.x + c.w - (p.x + p.w)),
            bottom: Math.max(0, c.y + c.h - (p.y + p.h)),
        };
        const worst = Math.max(overflow.left, overflow.top, overflow.right, overflow.bottom);
        if (worst > tolerance)
            issues.push({ child: e, parent, overflow });
    }
    return issues;
}
