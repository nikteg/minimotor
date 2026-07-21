import { activeDrag, rawPointer, setActiveDrag, uiPointer, type ActiveDrag } from "./core/index.js";
import { pointInRect } from "../collision.js";
import { Loop } from "../engine/index.js";

// ---------- Drag and drop ----------

export interface DragSourceOptions<T> {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  payload: T;
  disabled?: boolean;
}

export interface DragSourceState {
  hovered: boolean;
  dragging: boolean;
}

export interface DropTargetOptions<T> {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accepts?: (payload: T, sourceId: string) => boolean;
}

export interface DropResult<T> {
  sourceId: string;
  targetId: string;
  payload: T;
}

export interface DropTargetState<T> {
  hovered: boolean;
  canDrop: boolean;
  dropped: DropResult<T> | null;
}

export interface DraggedItem<T> {
  sourceId: string;
  payload: T;
  /** Suggested preview top-left, preserving where the source was grabbed. */
  x: number;
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
