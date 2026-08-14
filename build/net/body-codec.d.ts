import type { BodySnapshot } from "./body-state.js";
/** Pack one snapshot at `at` in `bytes`, returning the new offset. */
export declare function writeBodySnapshot(view: DataView, at: number, state: BodySnapshot): number;
/** Unpack one snapshot from `at`, returning it and the new offset. */
export declare function readBodySnapshot(view: DataView, at: number): {
    state: BodySnapshot;
    at: number;
} | null;
/** How `sync` puts a state on the wire when a packed format exists for it. */
export interface SyncCodec<T> {
    /** Binary lane name — see `Room.sendBytes`. */
    tag: string;
    encode(state: T, sentAt: number): Uint8Array;
    /** Return null for a frame this codec cannot read (a peer on an older
     *  build): the snapshot is then dropped rather than corrupting the buffer. */
    decode(bytes: Uint8Array): {
        state: T;
        sentAt: number;
    } | null;
}
/** Packed codec for a single replicated body. */
export declare function bodyCodec<T extends BodySnapshot>(): SyncCodec<T>;
/** Packed codec for a keyed collection of bodies (`syncBodies`). */
export declare function bodiesCodec<T extends BodySnapshot>(): SyncCodec<Array<{
    id: string;
    state: T;
}>>;
