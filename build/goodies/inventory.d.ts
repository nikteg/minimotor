/** One occupied inventory slot: `count` of `item`, capped at `max` per stack. */
export interface ItemStack<T> {
    /** What the stack holds. */
    item: T;
    /** How many are in this stack. */
    count: number;
    /** Per-stack cap — a stack never merges past this. */
    max: number;
}
/** Move/merge/swap inventory stacks: fill an empty `to` slot, merge same-item
 *  stacks up to `max`, or swap two different stacks. Returns false when nothing
 *  moved: the source slot is missing or empty, `to` is not a slot of `slots`,
 *  a same-item merge finds the target stack already full, or a partial
 *  `amount` faces a different item (part of a stack can't swap). */
export declare function transferStack<T>(slots: Array<ItemStack<T> | null>, from: number, to: number, amount?: number, same?: (a: T, b: T) => boolean): boolean;
/** Collect a picked-up `item` into `slots`: top up existing same-item stacks
 *  (up to their `max`) first, then drop the remainder into empty slots. Returns
 *  the leftover count that didn't fit (0 = fully collected). The merge-then-
 *  overflow ordering is the loot/pickup case `transferStack` (slot→slot) doesn't
 *  cover, and the one people get subtly wrong. */
export declare function addToInventory<T>(slots: Array<ItemStack<T> | null>, item: T, options: {
    max: number;
    amount?: number;
    same?: (a: T, b: T) => boolean;
}): number;
