import { clamp } from "../mathf.js";

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
  const moved = clamp(Math.floor(amount), 0, source.count);
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

/** Collect a picked-up `item` into `slots`: top up existing same-item stacks
 *  (up to their `max`) first, then drop the remainder into empty slots. Returns
 *  the leftover count that didn't fit (0 = fully collected). The merge-then-
 *  overflow ordering is the loot/pickup case `transferStack` (slot→slot) doesn't
 *  cover, and the one people get subtly wrong. */
export function addToInventory<T>(
  slots: Array<ItemStack<T> | null>,
  item: T,
  options: { max: number; amount?: number; same?: (a: T, b: T) => boolean },
): number {
  const max = options.max;
  const same = options.same ?? Object.is;
  let amount = Math.max(0, Math.floor(options.amount ?? 1));
  for (const slot of slots) {
    if (amount <= 0) break;
    if (slot && same(slot.item, item)) {
      const put = Math.min(Math.max(0, max - slot.count), amount);
      slot.count += put;
      amount -= put;
    }
  }
  for (let i = 0; i < slots.length && amount > 0; i++) {
    if (!slots[i]) {
      const put = Math.min(max, amount);
      slots[i] = { item, count: put, max };
      amount -= put;
    }
  }
  return amount;
}
