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
export declare function dragSource<T>(opts: DragSourceOptions<T>): DragSourceState;
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
export declare function dragGesture(opts: DragGestureOptions): DragGestureState;
/** Mark a rectangle as a drop target. On the release frame, `dropped` contains
 * the source id and typed payload. Targets decide compatibility with `accepts`.
 * See `dragSource` for the end-to-end source → target → preview example. */
export declare function dropTarget<T>(opts: DropTargetOptions<T>): DropTargetState<T>;
/** Read a target registered by a layout-aware panel earlier in this frame. */
export declare function dropTargetState<T>(id: string): DropTargetState<T> | null;
/** Current drag data for drawing an icon/stack preview above the UI. */
export declare function draggedItem<T>(): DraggedItem<T> | null;
/** Cancel the active drag (scene change, inventory close, Escape). */
export declare function cancelDrag(): void;
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
export declare function dropIndicator(opts: DropIndicatorOptions): number;
export {};
