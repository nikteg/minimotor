// ---------- Undo history ----------
// A capped snapshot stack for undo — puzzles, turn-based games, level editors.
// You `push()` a snapshot before a move; `undo()` hands back the previous one
// to restore. Both ends clone, so stored states can't be mutated behind your
// back, and the buffer is bounded so long sessions don't grow without limit.

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
export function undoStack<S>(
  options: { limit?: number; clone?: (state: S) => S } = {},
): UndoStack<S> {
  const limit = Math.max(1, options.limit ?? 30);
  const clone = options.clone ?? ((s: S) => structuredClone(s));
  const history: S[] = [];
  return {
    push(state) {
      history.push(clone(state));
      if (history.length > limit) history.shift();
    },
    undo() {
      const prev = history.pop();
      return prev === undefined ? null : clone(prev);
    },
    get canUndo() {
      return history.length > 0;
    },
    get size() {
      return history.length;
    },
    clear() {
      history.length = 0;
    },
  };
}
