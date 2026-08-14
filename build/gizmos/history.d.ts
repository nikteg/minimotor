/** A capped stack of cloned state snapshots for undo, returned by `undoStack()`. */
export interface UndoStack<S> {
    /** Snapshot the current state (call BEFORE applying a move). */
    push(state: S): void;
    /** Pop and return the most recent snapshot to restore, or null if empty. */
    undo(): S | null;
    /** True when there's something to undo. */
    readonly canUndo: boolean;
    /** Number of snapshots held. */
    readonly size: number;
    /** Drop all snapshots (new level, reset). */
    clear(): void;
}
/** Create an undo stack. `limit` caps retained snapshots (oldest dropped);
 *  `clone` deep-copies a state (default `structuredClone`) — override it for
 *  states that aren't structured-cloneable. */
export declare function undoStack<S>(options?: {
    limit?: number;
    clone?: (state: S) => S;
}): UndoStack<S>;
