import { clamp } from "../math/mathf.js";
/** Move/merge/swap inventory stacks: fill an empty `to` slot, merge same-item
 *  stacks up to `max`, or swap two different stacks. Returns false when nothing
 *  moved: the source slot is missing or empty, `to` is not a slot of `slots`,
 *  a same-item merge finds the target stack already full, or a partial
 *  `amount` faces a different item (part of a stack can't swap). */
export function transferStack(slots, from, to, amount = Infinity, same = Object.is) {
    if (from === to)
        return true;
    const source = slots[from];
    if (!source || !slots.hasOwnProperty(to))
        return false;
    const moved = clamp(Math.floor(amount), 0, source.count);
    if (moved === 0)
        return true;
    const target = slots[to];
    if (!target) {
        slots[to] = { ...source, count: moved };
        source.count -= moved;
        if (source.count === 0)
            slots[from] = null;
        return true;
    }
    if (same(source.item, target.item)) {
        const accepted = Math.min(moved, Math.max(0, target.max - target.count));
        target.count += accepted;
        source.count -= accepted;
        if (source.count === 0)
            slots[from] = null;
        return accepted > 0;
    }
    if (moved < source.count)
        return false;
    [slots[from], slots[to]] = [target, source];
    return true;
}
/** Collect a picked-up `item` into `slots`: top up existing same-item stacks
 *  (up to their `max`) first, then drop the remainder into empty slots. Returns
 *  the leftover count that didn't fit (0 = fully collected). The merge-then-
 *  overflow ordering is the loot/pickup case `transferStack` (slot→slot) doesn't
 *  cover, and the one people get subtly wrong. */
export function addToInventory(slots, item, options) {
    const max = options.max;
    const same = options.same ?? Object.is;
    let amount = Math.max(0, Math.floor(options.amount ?? 1));
    for (const slot of slots) {
        if (amount <= 0)
            break;
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
