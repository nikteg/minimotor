// ---------- Paint sequence (verification harness) ----------
// The clock behind `LayoutEntry.paint`. A layout capture records where a rect
// LANDED; this records when the kit actually put pixels in it, which is a
// different question and the one an occlusion check has to ask.
//
// The mechanism is deliberately the same "most recent entry" idiom the rest of
// the capture uses (`annotateLayoutText`, `pushLayoutParent`): `recordLayout`
// ARMS the entry it just pushed, and the kit's shared paint primitives —
// `drawBox`, `centeredText`, `centeredSpans`, the tileset draws — call
// `notePaint()` as they draw. The first paint after a record claims the next
// ordinal; later paints inside the same widget (a panel's title over its frame,
// a button's label over its box) are already covered by it.
//
// The consequence worth stating, because it is the whole value of the field: an
// entry that ends a frame with NO ordinal painted nothing of its own. A bare
// `row`/`col` is pure geometry, and a `UI.fill` slot is a reservation whose
// caller may never draw into it. Neither can occlude anything, and a check that
// treated them as if they could would report a container "over" its own
// neighbours purely for existing.
//
// This lives in its own module, importing NOTHING, because `theme.ts` is the
// biggest caller and `layout-capture.ts` reaches `lifecycle.ts`, which imports
// `theme.ts` back. A leaf module is cheaper than reasoning about which half of
// a cycle is initialized first.
/** The frame's paint counter — the last ordinal handed out. */
let seq = 0;
/** The entry a paint would be attributed to: the one `recordLayout` pushed most
 *  recently. Null whenever capture is off, which is what makes `notePaint` one
 *  comparison in a production draw. */
let pending = null;
/** Attribute the next paint to `entry` — called by `recordLayout`, right after
 *  it pushes. */
export function armPaint(entry) {
    pending = entry;
}
/** Stop attributing paints to anything: the next draw belongs to no captured
 *  rect. For the kit's few "call this last" painters (`drawTips`), which put a
 *  box on the screen that no `place` ever recorded — without this they would be
 *  credited to whatever entry happened to close the frame. */
export function detachPaint() {
    pending = null;
}
/** The kit is drawing. Claims the next ordinal for the armed entry, once. */
export function notePaint() {
    const entry = pending;
    if (entry === null || entry.paint !== undefined)
        return;
    entry.paint = ++seq;
}
/** Start a fresh frame's numbering (and drop the armed entry with it). */
export function resetPaintSeq() {
    seq = 0;
    pending = null;
}
