import { activeDrag, rawPointer, setActiveDrag, uiPointer, type ActiveDrag } from "./core/index.js";
import { pointInRect } from "../collision.js";
import { Loop } from "../engine/index.js";

// ---------- Drag and drop ----------

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
 * payload is retained only while dragging; render the source however you like. */
export function dragSource<T>(opts: DragSourceOptions<T>): DragSourceState {
  const p = uiPointer();
  const hovered = !opts.disabled && pointInRect(p.x, p.y, opts);
  if (hovered && p.pressed && !activeDrag) {
    setActiveDrag({
      sourceId: opts.id,
      payload: opts.payload,
      offsetX: p.x - opts.x,
      offsetY: p.y - opts.y,
    });
  }
  const dragging = activeDrag?.sourceId === opts.id;
  if (hovered || dragging) Loop.setCursor(dragging ? "grabbing" : "grab");
  return { hovered, dragging };
}

/** Mark a rectangle as a drop target. On the release frame, `dropped` contains
 * the source id and typed payload. Targets decide compatibility with `accepts`. */
export function dropTarget<T>(opts: DropTargetOptions<T>): DropTargetState<T> {
  const p = uiPointer();
  const drag = activeDrag as ActiveDrag | null;
  const accepted = drag ? (opts.accepts?.(drag.payload as T, drag.sourceId) ?? true) : false;
  const hovered = !!drag && pointInRect(p.x, p.y, opts);
  const canDrop = hovered && accepted;
  if (canDrop) Loop.setCursor("copy");
  let dropped: DropResult<T> | null = null;
  if (canDrop && p.released && drag) {
    dropped = { sourceId: drag.sourceId, targetId: opts.id, payload: drag.payload as T };
    setActiveDrag(null);
  }
  return { hovered, canDrop, dropped };
}

/** Current drag data for drawing an icon/stack preview above the UI. */
export function draggedItem<T>(): DraggedItem<T> | null {
  if (!activeDrag) return null;
  const p = rawPointer();
  return {
    sourceId: activeDrag.sourceId,
    payload: activeDrag.payload as T,
    x: p.x - activeDrag.offsetX,
    y: p.y - activeDrag.offsetY,
  };
}

/** Cancel the active drag (scene change, inventory close, Escape). */
export function cancelDrag(): void {
  setActiveDrag(null);
}
