import { claimPointerGesture, clearDragPayload, ensureWired, holdDragPayload, lifecycleOnce, onFrameEnd, onReset, rawPointer, uiSlot, setCursor, theme, uiCtx, uiPointer, } from "../../ui/core/index.js";
import { pointInRect } from "../../collision/index.js";
const st = uiSlot(() => ({ drag: null, targets: new Map() }));
const gestureSt = uiSlot(() => ({ drag: null }));
const ensureDragHooks = lifecycleOnce(() => {
    ensureWired(); // so the frame-end hook actually runs
    onFrameEnd(() => {
        // A release not consumed by any drop target cancels the drag.
        const s = st();
        if (s.drag && rawPointer().released)
            s.drag = null;
        const gesture = gestureSt();
        if (gesture.drag && rawPointer().released)
            gesture.drag = null;
        // Publish for the NEXT frame rather than this one: every widget has to see
        // the same answer, and `dragSource` runs somewhere in the middle of a frame
        // — so setting it there would suppress hover for the widgets drawn after
        // the source and not for the ones before it.
        if (s.drag)
            holdDragPayload();
        else
            clearDragPayload();
        s.targets.clear();
    });
    onReset(() => {
        st().drag = null;
        st().targets.clear();
        gestureSt().drag = null;
    });
});
/** Mark a rectangle as draggable. Call every draw frame for each source. The
 * payload is retained only while dragging; render the source however you like.
 * Wire the full loop with `dropTarget` (where drops land) and `draggedItem`
 * (the preview that follows the pointer):
 *
 *     UI.dragSource({ id: `slot:${i}`, ...slotRect, payload: item });
 *     const t = UI.dropTarget<Item>({ id: "trash", ...trashRect });
 *     if (t.dropped) discard(t.dropped.payload); // set on the release frame
 *     const drag = UI.draggedItem<Item>();
 *     if (drag) drawIcon(drag.payload, drag.x, drag.y);
 */
export function dragSource(opts) {
    ensureDragHooks();
    const s = st();
    const p = uiPointer();
    const hovered = !opts.disabled && pointInRect(p.x, p.y, opts);
    if (hovered && p.pressed && !s.drag) {
        s.drag = {
            sourceId: opts.id,
            payload: opts.payload,
            offsetX: p.x - opts.x,
            offsetY: p.y - opts.y,
        };
    }
    const dragging = s.drag?.sourceId === opts.id;
    // The payload owns the pointer while dragged — carrying it across a scroll
    // region must not also swipe-scroll that region.
    if (dragging)
        claimPointerGesture();
    // "grabbing" while this source drags (priority 1, so a target's "copy" at 2
    // wins over it regardless of draw order); "grab" only when nothing is being
    // dragged, so OTHER sources don't fight the drag cursor mid-drag.
    if (dragging)
        setCursor("grabbing", 1);
    else if (hovered && !s.drag)
        setCursor("grab", 0);
    return { hovered, dragging };
}
/** Claim a rectangle for direct pointer dragging without publishing a payload
 * to `dropTarget`s. The gesture owns the pointer while held and reports its
 * displacement in the current UI coordinate space. */
export function dragGesture(opts) {
    ensureDragHooks();
    const s = gestureSt();
    const p = uiPointer();
    const hovered = !opts.disabled && pointInRect(p.x, p.y, opts);
    if (hovered && p.pressed && !s.drag) {
        s.drag = { id: opts.id, startX: p.x, startY: p.y };
    }
    const dragging = s.drag?.id === opts.id;
    if (dragging) {
        claimPointerGesture();
        setCursor("grabbing", 1);
    }
    else if (hovered && !s.drag) {
        setCursor("grab", 0);
    }
    return {
        hovered,
        dragging,
        dx: dragging ? p.x - s.drag.startX : 0,
        dy: dragging ? p.y - s.drag.startY : 0,
    };
}
/** Mark a rectangle as a drop target. On the release frame, `dropped` contains
 * the source id and typed payload. Targets decide compatibility with `accepts`.
 * See `dragSource` for the end-to-end source → target → preview example. */
export function dropTarget(opts) {
    ensureDragHooks();
    const s = st();
    const p = uiPointer();
    const drag = s.drag;
    const accepted = drag ? (opts.accepts?.(drag.payload, drag.sourceId) ?? true) : false;
    const hovered = !!drag && pointInRect(p.x, p.y, opts);
    const canDrop = hovered && accepted;
    // Highest priority (2) so it wins over the dragged source's "grabbing" no
    // matter the draw order — a valid target shows "copy", an invalid one
    // "not-allowed". This makes the cursor symmetric in both drag directions.
    if (hovered)
        setCursor(canDrop ? "copy" : "not-allowed", 2);
    let dropped = null;
    if (canDrop && p.released && drag) {
        dropped = { sourceId: drag.sourceId, targetId: opts.id, payload: drag.payload };
        s.drag = null;
    }
    const result = { hovered, canDrop, dropped };
    s.targets.set(opts.id, result);
    return result;
}
/** Read a target registered by a layout-aware panel earlier in this frame. */
export function dropTargetState(id) {
    ensureDragHooks();
    return st().targets.get(id) ?? null;
}
/** Current drag data for drawing an icon/stack preview above the UI. */
export function draggedItem() {
    const drag = st().drag;
    if (!drag)
        return null;
    const p = rawPointer();
    return {
        sourceId: drag.sourceId,
        payload: drag.payload,
        x: p.x - drag.offsetX,
        y: p.y - drag.offsetY,
    };
}
/** Cancel the active drag (scene change, inventory close, Escape). */
export function cancelDrag() {
    st().drag = null;
}
/** The line to actually draw for an insertion point, given every edge that
 *  means it. An interior point is named by TWO edges — the trailing edge of
 *  the item before and the leading edge of the item after — and a gap between
 *  the items puts those a few px apart. Drawing whichever one the pointer is
 *  nearer makes the caret jump across the gap while the index never changes,
 *  so when the two are parallel and aligned the caret goes down the middle of
 *  the gap instead. In a GRID the pair straddles a row break and is not
 *  aligned at all; then there is nothing to average and the nearest edge is
 *  the honest answer. */
function centreOfGap(segs, axis, nearest) {
    const [first, second] = segs;
    if (!first || !second)
        return nearest;
    if (axis === "y") {
        // Horizontal carets: the same span across the flow means the same column.
        if (first[0] !== second[0] || first[2] !== second[2])
            return nearest;
        const y = (first[1] + second[1]) / 2;
        return [first[0], y, first[2], y];
    }
    // Vertical carets: the same span down the flow means the same row.
    if (first[1] !== second[1] || first[3] !== second[3])
        return nearest;
    const x = (first[0] + second[0]) / 2;
    return [x, first[1], x, first[3]];
}
/** Shortest distance from a point to a line SEGMENT (not the infinite line —
 *  the ends matter, or a grid row's caret would attract the pointer from the
 *  row above it). */
function distanceToSegment(px, py, seg) {
    const [ax, ay, bx, by] = seg;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** The caret is an I-beam, not a plain rule: a bare line is the same shape as
 *  `listItem`'s selected-row rail (3px of `theme.accent`), which in a GRID
 *  cell stands vertically right next to where the caret goes. The end ticks
 *  are what keep "insert here" from reading as "this one is selected". */
function paintCaret(seg, opts) {
    const ctx = uiCtx();
    const width = opts.width ?? Math.max(2, theme.borderWidth);
    const over = opts.overhang ?? 2;
    const tick = Math.max(3, width * 1.5);
    const [ax, ay, bx, by] = seg;
    const horizontal = ay === by;
    ctx.save();
    ctx.strokeStyle = opts.color ?? theme.accent;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (horizontal) {
        ctx.moveTo(ax - over, ay);
        ctx.lineTo(bx + over, by);
        ctx.moveTo(ax - over, ay - tick);
        ctx.lineTo(ax - over, ay + tick);
        ctx.moveTo(bx + over, by - tick);
        ctx.lineTo(bx + over, by + tick);
    }
    else {
        ctx.moveTo(ax, ay - over);
        ctx.lineTo(bx, by + over);
        ctx.moveTo(ax - tick, ay - over);
        ctx.lineTo(ax + tick, ay - over);
        ctx.moveTo(bx - tick, by + over);
        ctx.lineTo(bx + tick, by + over);
    }
    ctx.stroke();
    ctx.restore();
}
/** Where in a list a release would insert the dragged payload, drawn as a
 *  caret between two items and returned as the index to splice at.
 *
 *  Every insertion point is a line SEGMENT — one edge of one slot — and the
 *  nearest segment to the pointer wins. That single rule covers columns, rows
 *  AND row-major grids: a grid's cells offer their left and right edges, so
 *  the pointer at the end of a row picks that row's trailing edge rather than
 *  the far-left edge of the row below, which is what comparing coordinates on
 *  one axis would give.
 *
 *  The index is computed from the pointer WHENEVER this is called; only the
 *  caret is conditional on a payload being in flight. That is deliberate —
 *  `dropTarget` clears the drag on the release frame, so an indicator that
 *  went quiet without one would have nothing to report at exactly the moment
 *  the caller needs the position:
 *
 *      const t = UI.dropTarget<Item>({ id: "bag", ...box });
 *      const at = UI.dropIndicator({ items: slotRects, axis: "x" });
 *      if (t.dropped) items.splice(at, 0, t.dropped.payload); */
export function dropIndicator(opts) {
    const axis = opts.axis ?? "y";
    const p = uiPointer();
    // Both edges of every slot: the leading edge inserts BEFORE it, the trailing
    // edge AFTER. The two are duplicates in a plain list (item i's leading edge
    // and item i-1's trailing edge both mean "index i") and distinct in a grid,
    // where they sit on different rows.
    const byIndex = new Map();
    const offer = (index, seg) => {
        const at = byIndex.get(index);
        if (at)
            at.push(seg);
        else
            byIndex.set(index, [seg]);
    };
    for (const [i, r] of opts.items.entries()) {
        if (axis === "y") {
            offer(i, [r.x, r.y, r.x + r.w, r.y]);
            offer(i + 1, [r.x, r.y + r.h, r.x + r.w, r.y + r.h]);
        }
        else {
            offer(i, [r.x, r.y, r.x, r.y + r.h]);
            offer(i + 1, [r.x + r.w, r.y, r.x + r.w, r.y + r.h]);
        }
    }
    if (byIndex.size === 0) {
        const e = opts.empty;
        if (!e)
            return 0;
        offer(0, axis === "y" ? [e.x, e.y, e.x + e.w, e.y] : [e.x, e.y, e.x, e.y + e.h]);
    }
    let bestIndex = 0;
    let bestSegs = [];
    let bestSeg = [0, 0, 0, 0];
    let bestDistance = Infinity;
    for (const [index, segs] of byIndex) {
        for (const seg of segs) {
            const distance = distanceToSegment(p.x, p.y, seg);
            if (distance >= bestDistance)
                continue;
            bestDistance = distance;
            bestIndex = index;
            bestSegs = segs;
            bestSeg = seg;
        }
    }
    if (!opts.silent && st().drag)
        paintCaret(centreOfGap(bestSegs, axis, bestSeg), opts);
    return bestIndex;
}
