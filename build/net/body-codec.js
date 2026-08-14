// ---------- Binary body snapshots ----------
// Snapshots are the only traffic that repeats 60 times a second, and a body
// snapshot has a FIXED, known shape — so it is the one message worth packing.
// A typical JSON body snapshot is ~150 bytes of quoted key names; the same
// state packs into ~40, with no JSON.stringify/parse on either end.
//
// Everything else in a room stays JSON: events, pickups, chat and commands are
// low-rate, schema-free, and far easier to debug as text. Binary is a scale
// win, not a latency fix — see API-REVIEW.md.
//
// The format is STATELESS on purpose. The snapshot lane is unreliable, so a
// scheme that built up a shared key/string dictionary would desynchronize the
// moment a packet went missing.
/** Numeric fields, in wire order. Each present one is one f32. */
const NUMBERS = ["x", "y", "vx", "vy", "w", "h", "rot", "spin", "facing"];
// Mask bits above the numeric block.
const GROUNDED_SET = 1 << 9;
const GROUNDED_VALUE = 1 << 10;
const ACTIVE_SET = 1 << 11;
const ACTIVE_VALUE = 1 << 12;
const COLOR_SET = 1 << 13;
const STATE_SET = 1 << 14;
const AREA_SET = 1 << 15;
/** Every snapshot frame opens with the sender's clock as an f64. */
const STAMP = 8;
/** A collection frame adds a u16 entry count. */
const LIST_HEADER = STAMP + 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** Upper bound on one packed body (mask + numerics + two length-prefixed
 *  strings at their worst-case UTF-8 expansion), so encoding can size its
 *  buffer once instead of growing it. */
const maxSize = (state) => 2 +
    NUMBERS.length * 4 +
    3 +
    (state.color?.length ?? 0) * 3 +
    (state.state?.length ?? 0) * 3 +
    (state.area?.length ?? 0) * 3;
/** Pack one snapshot at `at` in `bytes`, returning the new offset. */
export function writeBodySnapshot(view, at, state) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset);
    let mask = 0;
    let cursor = at + 2; // the mask is back-filled once we know it
    for (let i = 0; i < NUMBERS.length; i++) {
        const value = state[NUMBERS[i]];
        if (typeof value !== "number")
            continue;
        mask |= 1 << i;
        view.setFloat32(cursor, value, true);
        cursor += 4;
    }
    if (typeof state.grounded === "boolean") {
        mask |= GROUNDED_SET;
        if (state.grounded)
            mask |= GROUNDED_VALUE;
    }
    if (typeof state.active === "boolean") {
        mask |= ACTIVE_SET;
        if (state.active)
            mask |= ACTIVE_VALUE;
    }
    for (const [flag, text] of [
        [COLOR_SET, state.color],
        [STATE_SET, state.state],
        [AREA_SET, state.area],
    ]) {
        if (typeof text !== "string")
            continue;
        mask |= flag;
        const written = encoder.encodeInto(text, bytes.subarray(cursor + 1, cursor + 1 + 255));
        view.setUint8(cursor, written.written);
        cursor += 1 + written.written;
    }
    view.setUint16(at, mask, true);
    return cursor;
}
/** Unpack one snapshot from `at`, returning it and the new offset. */
export function readBodySnapshot(view, at) {
    if (at + 2 > view.byteLength)
        return null;
    const bytes = new Uint8Array(view.buffer, view.byteOffset);
    const mask = view.getUint16(at, true);
    let cursor = at + 2;
    const state = {};
    for (let i = 0; i < NUMBERS.length; i++) {
        if ((mask & (1 << i)) === 0)
            continue;
        if (cursor + 4 > view.byteLength)
            return null;
        state[NUMBERS[i]] = view.getFloat32(cursor, true);
        cursor += 4;
    }
    if (mask & GROUNDED_SET)
        state.grounded = (mask & GROUNDED_VALUE) !== 0;
    if (mask & ACTIVE_SET)
        state.active = (mask & ACTIVE_VALUE) !== 0;
    for (const [flag, key] of [
        [COLOR_SET, "color"],
        [STATE_SET, "state"],
        [AREA_SET, "area"],
    ]) {
        if ((mask & flag) === 0)
            continue;
        if (cursor >= view.byteLength)
            return null;
        const length = view.getUint8(cursor);
        cursor += 1;
        if (cursor + length > view.byteLength)
            return null;
        state[key] = decoder.decode(bytes.subarray(cursor, cursor + length));
        cursor += length;
    }
    // Absent numerics stay absent rather than defaulting to 0: the mask records
    // exactly which fields the sender had, and `applyBodyState` skips the rest.
    return { state: state, at: cursor };
}
/** Packed codec for a single replicated body. */
export function bodyCodec() {
    return {
        tag: "b",
        encode(state, sentAt) {
            const view = new DataView(new ArrayBuffer(STAMP + maxSize(state)));
            view.setFloat64(0, sentAt, true);
            const end = writeBodySnapshot(view, STAMP, state);
            return new Uint8Array(view.buffer, 0, end);
        },
        decode(bytes) {
            if (bytes.length < STAMP + 2)
                return null;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
            const sentAt = view.getFloat64(0, true);
            const read = readBodySnapshot(view, STAMP);
            return read && { state: read.state, sentAt };
        },
    };
}
/** Packed codec for a keyed collection of bodies (`syncBodies`). */
export function bodiesCodec() {
    return {
        tag: "bs",
        encode(entities, sentAt) {
            let size = LIST_HEADER;
            for (const entity of entities)
                size += 1 + entity.id.length * 3 + maxSize(entity.state);
            const buffer = new ArrayBuffer(size);
            const view = new DataView(buffer);
            const bytes = new Uint8Array(buffer);
            view.setFloat64(0, sentAt, true);
            view.setUint16(STAMP, entities.length, true);
            let cursor = LIST_HEADER;
            for (const entity of entities) {
                const written = encoder.encodeInto(entity.id, bytes.subarray(cursor + 1, cursor + 1 + 255));
                view.setUint8(cursor, written.written);
                cursor += 1 + written.written;
                cursor = writeBodySnapshot(view, cursor, entity.state);
            }
            return new Uint8Array(buffer, 0, cursor);
        },
        decode(bytes) {
            if (bytes.length < LIST_HEADER)
                return null;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
            const sentAt = view.getFloat64(0, true);
            const count = view.getUint16(STAMP, true);
            const entities = [];
            let cursor = LIST_HEADER;
            for (let i = 0; i < count; i++) {
                if (cursor >= bytes.length)
                    return null;
                const idLength = view.getUint8(cursor);
                cursor += 1;
                if (cursor + idLength > bytes.length)
                    return null;
                const id = decoder.decode(bytes.subarray(cursor, cursor + idLength));
                cursor += idLength;
                const read = readBodySnapshot(view, cursor);
                if (!read)
                    return null;
                entities.push({ id, state: read.state });
                cursor = read.at;
            }
            return { state: entities, sentAt };
        },
    };
}
