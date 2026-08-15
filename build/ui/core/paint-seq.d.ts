/** Attribute the next paint to `entry` — called by `recordLayout`, right after
 *  it pushes. */
export declare function armPaint(entry: {
    paint?: number;
}): void;
/** Stop attributing paints to anything: the next draw belongs to no captured
 *  rect. For the kit's few "call this last" painters (`drawTips`), which put a
 *  box on the screen that no `place` ever recorded — without this they would be
 *  credited to whatever entry happened to close the frame. */
export declare function detachPaint(): void;
/** The kit is drawing. Claims the next ordinal for the armed entry, once. */
export declare function notePaint(): void;
/** Start a fresh frame's numbering (and drop the armed entry with it). */
export declare function resetPaintSeq(): void;
