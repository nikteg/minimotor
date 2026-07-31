import {
  claimPointerGesture,
  ensureWired,
  onFrameEnd,
  onReset,
  rawPointer,
  uiSlot,
  setCursor,
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

let hooksRegistered = false;
function ensureDragHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  ensureWired(); // so the frame-end hook actually runs
  onFrameEnd(() => {
    // A release not consumed by any drop target cancels the drag.
    const s = st();
    if (s.drag && rawPointer().released) s.drag = null;
  });
  onReset(() => {
    st().drag = null;
  });
}

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
