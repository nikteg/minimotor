// ---------- Inventory and crafting ----------
// Moving items between slots the way players expect: fill an empty slot, merge
// same-item stacks up to their cap, or swap two different stacks.

export interface ItemStack<T> {
  item: T;
  count: number;
  max: number;
}

/** Move/merge/swap inventory stacks. Returns false only when a requested
 * partial move cannot be swapped into an incompatible occupied slot. */
export function transferStack<T>(
  slots: Array<ItemStack<T> | null>,
  from: number,
  to: number,
  amount = Infinity,
  same: (a: T, b: T) => boolean = Object.is,
): boolean {
  if (from === to) return true;
  const source = slots[from];
  if (!source || !slots.hasOwnProperty(to)) return false;
  const moved = Math.max(0, Math.min(source.count, Math.floor(amount)));
  if (moved === 0) return true;
  const target = slots[to];
  if (!target) {
    slots[to] = { ...source, count: moved };
    source.count -= moved;
    if (source.count === 0) slots[from] = null;
    return true;
  }
  if (same(source.item, target.item)) {
    const accepted = Math.min(moved, Math.max(0, target.max - target.count));
    target.count += accepted;
    source.count -= accepted;
    if (source.count === 0) slots[from] = null;
    return accepted > 0;
  }
  if (moved < source.count) return false;
  [slots[from], slots[to]] = [target, source];
  return true;
}
