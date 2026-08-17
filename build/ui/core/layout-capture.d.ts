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
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** The same rect mapped out to SCREEN-logical coords (via `uiToScreen`) —
     *  where it actually lands on the canvas. Equal to `rect` at the root. */
    screenRect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
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
    lag?: {
        w: number;
        h: number;
    };
    /** The rect this container's own frame was PAINTED at, when the layout moved
     *  it afterwards — otherwise absent, and `rect` is both.
     *
     *  A container placed into a deferred slot (`Flow.reserve`) has to paint its
     *  backdrop UNDER its children, so the frame goes down at the provisional
     *  size and only `slot.commit` — after the children — knows the real one.
     *  `rect` reports the committed size, because that is where the children were
     *  put and what the parent's cursor advanced by. Both are true and they are
     *  different rects, so the capture records both rather than picking.
     *
     *  Set only when the entry actually painted (it carries a `paint` ordinal)
     *  and only when the two differ by more than half a pixel — so a settled
     *  screen carries none of these, and an entry that put no pixels down never
     *  carries one however far its slot moved.
     *
     *  **How rare that makes it, MEASURED** on the largest consumer to hand: over
     *  240 settled frames — every screen it ships, four window sizes, six UI
     *  scales — not one entry in any tree carried this field, and on the frames
     *  that were NOT settled exactly one box in the whole application ever did.
     *  Which is the argument for the field's shape: a container that is not
     *  mid-resize pays a comparison and nothing else, and the alternative fix —
     *  moving `cfg.box` past `slot.commit` — would have reordered every deferred
     *  panel's backdrop under its own children to close a gap that narrow.
     *
     *  **`lag` does not overlap with this and cannot stand in for it.** `lag`
     *  compares the COMMITTED rect against the measured content, and for a
     *  deferred container those are the same number by construction: the field is
     *  absent on exactly the frames this one is present. MEASURED on this repo's
     *  own fixture (`ui.painted-rect.test.ts`) and on the consumer's play HUD —
     *  closing a panel leaves 160px of its frame on the canvas below a
     *  48px `rect`, with `layoutLag` silent throughout.
     *
     *  Occlusion is a question about pixels, so `paintIssues` and
     *  `drawLayoutOverlay` read this in preference to `rect`; containment
     *  (`layoutIssues`) is a question about where children were PLACED, and reads
     *  `rect`, which is what the container's body flow actually used. */
    paintedRect?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** `paintedRect` mapped to SCREEN-logical coords — the pair to `screenRect`,
     *  present exactly when `paintedRect` is. */
    paintedScreenRect?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
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
/** The zero-cost-when-off guard: record sites check this boolean and skip the
 *  `recordLayout` call entirely while capture is disabled. */
export declare let layoutCaptureActive: boolean;
/** Turn layout capture on or off (off clears any captured tree). While on,
 *  every placed widget/container rect is recorded for `layoutTree()` — a test
 *  and debugging aid; leave it off in production draw loops. */
export declare function layoutCapture(on: boolean): void;
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
export declare function layoutTree(): LayoutEntry[];
/** Record one resolved rect — called by `place`/`fillRect`/the containers,
 *  always behind a `layoutCaptureActive` guard. `id` is the raw option value
 *  (stringified here so call sites stay one expression). */
export declare function recordLayout(kind: string, id: string | number | undefined, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, flags?: {
    clips?: boolean;
    pinned?: boolean;
}): number;
/** Rewrite an entry's geometry after the fact. A container placed into a
 *  deferred slot records itself BEFORE its children (so the tree keeps draw
 *  order and the children hang off it) but only learns its true size after
 *  them — this is how the recorded rect catches up, instead of the tree
 *  reporting the provisional size the container was never drawn at.
 *  `index` is what `recordLayout` returned; -1 is ignored.
 *
 *  `paintedAt` is the rect as it stood when the container painted its own
 *  backdrop, which is BEFORE the commit and therefore not always this one. Pass
 *  it and the difference is kept as `paintedRect` instead of being overwritten
 *  — the caller does not have to decide whether the two agree, and an entry
 *  that painted nothing never gets the field however far its rect moved. */
export declare function refreshLayoutRect(index: number, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, paintedAt?: {
    x: number;
    y: number;
    w: number;
    h: number;
}): void;
/** Hang the label a widget just drew on the entry it just recorded.
 *
 *  Same "the MOST RECENT entry" idiom as `pushLayoutParent`: the caller records
 *  its rect through `place` and annotates it on the next line, with nothing in
 *  between that could record. Kept separate from `recordLayout` so the generic
 *  `place` path — every widget in the kit — carries no text parameter it has
 *  nothing to put in. */
export declare function annotateLayoutText(str: string): void;
/** Open the container that recorded the MOST RECENT entry: everything recorded
 *  until `popLayoutParent` becomes its child. Call it right after a container
 *  records its own box, around the children callback. */
export declare function pushLayoutParent(): void;
/** Close the container opened by `pushLayoutParent`. */
export declare function popLayoutParent(): void;
/** Everything recorded until `popLayoutOverlay` belongs to an overlay and is
 *  entitled to paint over what is beneath it. Called by `popover` and `modal`
 *  around their own box and body, and by the deferred `select` menu pass. */
export declare function pushLayoutOverlay(): void;
/** Leave the innermost overlay opened by `pushLayoutOverlay`. */
export declare function popLayoutOverlay(): void;
/** Record what an auto-sized container's box was actually worth, once its
 *  children have been measured. Called only from `autoContainer`, only while
 *  capture is on.
 *
 *  `off` is how far the drawn box missed the content it turned out to hold —
 *  nonzero means the container drew at last frame's size, which is the
 *  one-frame pop. `key` is its auto-size cache key; the SECOND container to
 *  claim a key in one frame marks both as sharing it. */
export declare function noteContainerSize(index: number, key: string | undefined, off: {
    w: number;
    h: number;
}): void;
/** A container that drew at the wrong size, and why — what `layoutLag`
 *  reports. */
export interface LayoutLag {
    /** The container whose box missed its content. */
    entry: LayoutEntry;
    /** Px the drawn box was off its measured content, per axis. Positive means
     *  the box was too big, negative too small. */
    off: {
        w: number;
        h: number;
    };
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
export declare function layoutLag(tolerance?: number): LayoutLag[];
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
/** Draw every captured layout box over the finished frame — the visual form of
 *  `layoutTree()`, for eyeballing padding, gaps and alignment against the art.
 *
 *  Needs `layoutCapture(true)`; it draws the last COMPLETED frame, so with
 *  capture left on it trails the live UI by one frame (invisible in practice,
 *  and the reason a toggle should enable capture and the overlay together).
 *
 *  Boxes are drawn from `screenRect` — or from `paintedScreenRect` where an
 *  entry has one, so the box follows the art rather than the layout on the one
 *  frame those disagree (see `LayoutEntry.paintedRect`). Either is already
 *  screen-logical: call this at the ROOT of the draw, OUTSIDE any `UI.scaled`
 *  block, or the scale is applied twice. Findings win over kind: a child that
 *  escaped its container
 *  (`layoutIssues`) is red, as is anything painted THROUGH an open overlay
 *  (`paintIssues`); a container that drew at a stale size (`layoutLag`) is
 *  orange.
 *
 *      UI.layoutCapture(debugOn);
 *      UI.scaled(() => buildTheWholeUI());
 *      if (debugOn) UI.drawLayoutOverlay({ dim: 0.15 }); */
export declare function drawLayoutOverlay(opts?: LayoutOverlayOptions): void;
/** A child that escaped its container's box — what `layoutIssues` reports. */
export interface LayoutIssue {
    /** The escaping entry and the container it was placed in. */
    child: LayoutEntry;
    parent: LayoutEntry;
    /** How far past each edge it reached, in screen px (0 = inside). */
    overflow: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
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
export declare function layoutIssues(tolerance?: number): LayoutIssue[];
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
    overlap: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** `under` is an OVERLAY. This is the unambiguous form of the fault: a
     *  popover, a modal or an open menu is up, and ordinary content drawn later
     *  in the frame has painted straight through it. Nothing legitimate does
     *  this — the rest of the list is pairs whose order is a design decision. */
    throughOverlay?: true;
}
/** Rects the captured frame painted over one another, later paint first.
 *
 *  The check `layoutIssues` cannot make. That one compares a child against the
 *  container that placed it, which catches a box too small for its contents and
 *  nothing else; two rects that never shared a parent can sit straight on top of
 *  each other with `layoutIssues` and `layoutLag` clean the whole time. They did,
 *  twice — a table painted through an open popover, and a HUD panel and a
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
 *  Rects are the ones the entries PAINTED at (`LayoutEntry.paintedRect` where
 *  present), not the ones the layout settled on. The two are the same on every
 *  settled frame and differ for a deferred container on the frame its content
 *  changes size — which is both a false positive and a false negative at once,
 *  on precisely the boxes most likely to be mid-resize.
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
export declare function paintIssues(tolerance?: number): PaintIssue[];
