import {
  claimPointerGesture,
  clearDragPayload,
  ensureWired,
  holdDragPayload,
  lifecycleOnce,
  onFrameEnd,
  onReset,
  rawPointer,
  uiSlot,
  setCursor,
  theme,
  uiCtx,
  uiPointer,
} from "@src/ui/core/index.js";
import { pointInRect } from "@src/collision/index.js";

// ---------- Drag and drop ----------

// The in-flight drag, owned per runtime. A widget sets it on grab; the kernel
// frame-end hook cancels it on a release no drop target consumed.
interface ActiveDrag {
  sourceId: string;
  payload: unknown;
  offsetX: number;
  offsetY: number;
}

const st = uiSlot<{ drag: ActiveDrag | null }>(() => ({ drag: null }));
interface ActiveGesture {
  id: string;
  startX: number;
  startY: number;
}

const gestureSt = uiSlot<{ drag: ActiveGesture | null }>(() => ({ drag: null }));

const ensureDragHooks = lifecycleOnce(() => {
  ensureWired(); // so the frame-end hook actually runs
  onFrameEnd(() => {
    // A release not consumed by any drop target cancels the drag.
    const s = st();
    if (s.drag && rawPointer().released) s.drag = null;
    const gesture = gestureSt();
    if (gesture.drag && rawPointer().released) gesture.drag = null;
    // Publish for the NEXT frame rather than this one: every widget has to see
    // the same answer, and `dragSource` runs somewhere in the middle of a frame
    // — so setting it there would suppress hover for the widgets drawn after
    // the source and not for the ones before it.
    if (s.drag) holdDragPayload();
    else clearDragPayload();
  });
  onReset(() => {
    st().drag = null;
    gestureSt().drag = null;
  });
});

/** Inputs to `dragSource`: the draggable rect, its identity, and the `payload`
 *  it carries. */
export interface DragSourceOptions<T> {
  /** Stable identity for this source across frames. */
  id: string;
  /** Draggable rect left edge in px. */
  x: number;
  /** Draggable rect top edge in px. */
  y: number;
  /** Draggable rect width in px. */
  w: number;
  /** Draggable rect height in px. */
  h: number;
  /** Value carried to the drop target; retained only while dragging. */
  payload: T;
  /** Skip input — the rect is not draggable. */
  disabled?: boolean;
}

/** What `dragSource` returns this frame: hover and active-drag flags. */
export interface DragSourceState {
  /** Pointer is over the source rect. */
  hovered: boolean;
  /** This source is the one currently being dragged. */
  dragging: boolean;
}

/** Inputs to `dropTarget`: the target rect, its identity, and an optional
 *  `accepts` predicate. */
export interface DropTargetOptions<T> {
  /** Stable identity for this target across frames. */
  id: string;
  /** Target rect left edge in px. */
  x: number;
  /** Target rect top edge in px. */
  y: number;
  /** Target rect width in px. */
  w: number;
  /** Target rect height in px. */
  h: number;
  /** Predicate deciding whether a dragged `payload` may drop here. Omit to
   *  accept everything. */
  accepts?: (payload: T, sourceId: string) => boolean;
}

/** A completed drop: which source and target, and the `payload` transferred. */
export interface DropResult<T> {
  /** `id` of the source the payload came from. */
  sourceId: string;
  /** `id` of the target it was dropped on. */
  targetId: string;
  /** The dragged payload. */
  payload: T;
}

/** What `dropTarget` returns this frame: hover/can-drop flags and the landed
 *  `DropResult` on the release frame. */
export interface DropTargetState<T> {
  /** A drag is currently over this target. */
  hovered: boolean;
  /** Hovered AND the payload passed `accepts` — a drop would land. */
  canDrop: boolean;
  /** Set on the release frame when a drop landed here, else `null`. */
  dropped: DropResult<T> | null;
}

/** The in-flight drag: its source, `payload`, and a suggested preview position
 *  for rendering. */
export interface DraggedItem<T> {
  /** `id` of the source being dragged. */
  sourceId: string;
  /** The payload being dragged. */
  payload: T;
  /** Suggested preview top-left, preserving where the source was grabbed. */
  x: number;
  /** Suggested preview top (see `x`). */
  y: number;
}

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
export function dragSource<T>(opts: DragSourceOptions<T>): DragSourceState {
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
  if (dragging) claimPointerGesture();
  // "grabbing" while this source drags (priority 1, so a target's "copy" at 2
  // wins over it regardless of draw order); "grab" only when nothing is being
  // dragged, so OTHER sources don't fight the drag cursor mid-drag.
  if (dragging) setCursor("grabbing", 1);
  else if (hovered && !s.drag) setCursor("grab", 0);
  return { hovered, dragging };
}

/** Inputs to `dragGesture`: a rectangle that owns pointer movement without
 * entering the drag-and-drop payload channel. This is useful for panning a
 * canvas, moving a window, or scrubbing a viewport where no drop target is
 * involved. */
export interface DragGestureOptions {
  /** Stable identity for this gesture across frames. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled?: boolean;
}

/** The pointer state and displacement returned by `dragGesture`. */
export interface DragGestureState {
  hovered: boolean;
  dragging: boolean;
  /** Displacement from the pointer position where this gesture began. */
  dx: number;
  dy: number;
}

/** Claim a rectangle for direct pointer dragging without publishing a payload
 * to `dropTarget`s. The gesture owns the pointer while held and reports its
 * displacement in the current UI coordinate space. */
export function dragGesture(opts: DragGestureOptions): DragGestureState {
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
  } else if (hovered && !s.drag) {
    setCursor("grab", 0);
  }
  return {
    hovered,
    dragging,
    dx: dragging ? p.x - s.drag!.startX : 0,
    dy: dragging ? p.y - s.drag!.startY : 0,
  };
}

/** Mark a rectangle as a drop target. On the release frame, `dropped` contains
 * the source id and typed payload. Targets decide compatibility with `accepts`.
 * See `dragSource` for the end-to-end source → target → preview example. */
export function dropTarget<T>(opts: DropTargetOptions<T>): DropTargetState<T> {
  ensureDragHooks();
  const s = st();
  const p = uiPointer();
  const drag = s.drag;
  const accepted = drag ? (opts.accepts?.(drag.payload as T, drag.sourceId) ?? true) : false;
  const hovered = !!drag && pointInRect(p.x, p.y, opts);
  const canDrop = hovered && accepted;
  // Highest priority (2) so it wins over the dragged source's "grabbing" no
  // matter the draw order — a valid target shows "copy", an invalid one
  // "not-allowed". This makes the cursor symmetric in both drag directions.
  if (hovered) setCursor(canDrop ? "copy" : "not-allowed", 2);
  let dropped: DropResult<T> | null = null;
  if (canDrop && p.released && drag) {
    dropped = { sourceId: drag.sourceId, targetId: opts.id, payload: drag.payload as T };
    s.drag = null;
  }
  return { hovered, canDrop, dropped };
}

/** Current drag data for drawing an icon/stack preview above the UI. */
export function draggedItem<T>(): DraggedItem<T> | null {
  const drag = st().drag;
  if (!drag) return null;
  const p = rawPointer();
  return {
    sourceId: drag.sourceId,
    payload: drag.payload as T,
    x: p.x - drag.offsetX,
    y: p.y - drag.offsetY,
  };
}

/** Cancel the active drag (scene change, inventory close, Escape). */
export function cancelDrag(): void {
  st().drag = null;
}

// ---------- Drop position ----------

/** A laid-out slot the caret can sit against — an item's rect in the list. */
interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Inputs to `dropIndicator`: the slots a reorder would insert between. */
export interface DropIndicatorOptions {
  /** The items' laid-out rects, in the order the list holds them. */
  items: readonly SlotRect[];
  /** Which way the items run: `"y"` for a column (the caret is a horizontal
   *  line between rows), `"x"` for a row or a row-major grid (a vertical line
   *  between cells). Default `"y"`. */
  axis?: "x" | "y";
  /** Where to draw the caret when `items` is empty — normally the container's
   *  padded box. Without it an empty list draws nothing. */
  empty?: SlotRect;
  /** Caret color. Default `theme.accent`. */
  color?: string;
  /** Caret thickness in px. Default `max(2, theme.borderWidth)`. */
  width?: number;
  /** Px the caret runs past each end of the slot it sits against. Default 2. */
  overhang?: number;
  /** Compute the index without drawing anything. */
  silent?: boolean;
}

type Caret = readonly [ax: number, ay: number, bx: number, by: number];

/** Shortest distance from a point to a line SEGMENT (not the infinite line —
 *  the ends matter, or a grid row's caret would attract the pointer from the
 *  row above it). */
function distanceToSegment(px: number, py: number, seg: Caret): number {
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
function paintCaret(seg: Caret, opts: DropIndicatorOptions): void {
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
  } else {
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
export function dropIndicator(opts: DropIndicatorOptions): number {
  const axis = opts.axis ?? "y";
  const p = uiPointer();
  // Both edges of every slot: the leading edge inserts BEFORE it, the trailing
  // edge AFTER. The two are duplicates in a plain list (item i's leading edge
  // and item i-1's trailing edge both mean "index i") and distinct in a grid,
  // where they sit on different rows.
  const candidates: { index: number; seg: Caret }[] = [];
  for (const [i, r] of opts.items.entries()) {
    if (axis === "y") {
      candidates.push({ index: i, seg: [r.x, r.y, r.x + r.w, r.y] });
      candidates.push({ index: i + 1, seg: [r.x, r.y + r.h, r.x + r.w, r.y + r.h] });
    } else {
      candidates.push({ index: i, seg: [r.x, r.y, r.x, r.y + r.h] });
      candidates.push({ index: i + 1, seg: [r.x + r.w, r.y, r.x + r.w, r.y + r.h] });
    }
  }
  if (candidates.length === 0) {
    const e = opts.empty;
    if (!e) return 0;
    candidates.push({
      index: 0,
      seg: axis === "y" ? [e.x, e.y, e.x + e.w, e.y] : [e.x, e.y, e.x, e.y + e.h],
    });
  }
  let best = candidates[0]!;
  let bestDistance = distanceToSegment(p.x, p.y, best.seg);
  for (const candidate of candidates) {
    const distance = distanceToSegment(p.x, p.y, candidate.seg);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (!opts.silent && st().drag) paintCaret(best.seg, opts);
  return best.index;
}
