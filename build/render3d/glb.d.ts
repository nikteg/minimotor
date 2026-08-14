export interface GlbContainer {
    /** The JSON chunk, decoded as UTF-8 but not parsed. */
    json: string;
    /** The BIN chunk as a buffer of its own. Sliced rather than viewed: every
     * offset in a glTF document is measured from the start of the buffer it
     * names, and a view whose `byteOffset` is the chunk's position in the file
     * would make every one of them wrong by that much. */
    binary?: ArrayBuffer;
}
/** Whether these bytes open with the GLB magic.
 *
 * Detection is by content and not by URL suffix, because a `.gltf` that is
 * really a GLB, a blob URL and a `fetch` of something served without a
 * filename are all ordinary things to be handed. */
export declare function isGlb(bytes: ArrayBuffer): boolean;
/** Split a GLB into its JSON text and its binary chunk.
 *
 * Every structural rule the container has is checked here rather than left to
 * fail later as a confusing out-of-range read: a truncated file, a chunk that
 * runs past the declared length, two JSON chunks, a BIN chunk before the JSON
 * one. Chunks of a type this does not recognise are skipped, which is what the
 * specification asks of a reader — the tag space is open, and an unknown chunk
 * is not an error.
 *
 * `label` names the source in the error messages; it is only ever the URL the
 * bytes came from. */
export declare function parseGlb(bytes: ArrayBuffer, label?: string): GlbContainer;
