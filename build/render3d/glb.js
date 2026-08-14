// ---------- GLB container ----------
// GLB is glTF 2.0's binary wrapper: a 12-byte header, then a run of chunks,
// the first of which is the JSON document and the second — when there is one —
// the binary buffer that document's `buffers[0]` refers to with no URI.
//
// This module knows nothing about glTF itself. It takes bytes, checks that the
// container is one, and hands back the JSON text and the binary chunk;
// `gltf.ts` decides what to do with them. Keeping the split means the header
// checks below can be tested against bytes that are deliberately malformed
// without also having to be a loadable scene.
/** `glTF` as a little-endian uint32 — the first four bytes of every GLB. */
const MAGIC = 0x46546c67;
/** `JSON`, with the trailing space the spec pads the tag with. */
const CHUNK_JSON = 0x4e4f534a;
/** `BIN` and a NUL, likewise. */
const CHUNK_BIN = 0x004e4942;
/** Whether these bytes open with the GLB magic.
 *
 * Detection is by content and not by URL suffix, because a `.gltf` that is
 * really a GLB, a blob URL and a `fetch` of something served without a
 * filename are all ordinary things to be handed. */
export function isGlb(bytes) {
    return bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, true) === MAGIC;
}
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
export function parseGlb(bytes, label = "GLB") {
    if (bytes.byteLength < 12) {
        throw new Error(`${label}: too short to hold a GLB header (${bytes.byteLength} bytes).`);
    }
    const header = new DataView(bytes);
    const magic = header.getUint32(0, true);
    if (magic !== MAGIC) {
        throw new Error(`${label}: not a GLB — magic is 0x${magic.toString(16).padStart(8, "0")}.`);
    }
    const version = header.getUint32(4, true);
    if (version !== 2)
        throw new Error(`${label}: unsupported GLB version ${version}.`);
    // The length field covers the whole file, header included. Fewer bytes than
    // it claims means the file was truncated in transit, and the chunk walk
    // below would otherwise read whatever happened to follow in memory.
    const declared = header.getUint32(8, true);
    if (declared < 12)
        throw new Error(`${label}: GLB declares an impossible length ${declared}.`);
    if (declared > bytes.byteLength) {
        throw new Error(`${label}: GLB declares ${declared} bytes but ${bytes.byteLength} arrived.`);
    }
    let json;
    let binary;
    let offset = 12;
    let first = true;
    while (offset < declared) {
        if (offset + 8 > declared) {
            throw new Error(`${label}: GLB ends mid-chunk-header at byte ${offset}.`);
        }
        const length = header.getUint32(offset, true);
        const type = header.getUint32(offset + 4, true);
        // Every chunk is padded to a four-byte boundary, so every chunk length is
        // a multiple of four and every following chunk header lands aligned. One
        // unpadded chunk misaligns the rest of the file.
        if (length % 4 !== 0) {
            throw new Error(`${label}: GLB chunk at byte ${offset} has unaligned length ${length}.`);
        }
        const start = offset + 8;
        if (start + length > declared) {
            throw new Error(`${label}: GLB chunk at byte ${offset} runs past the end of the file.`);
        }
        // The JSON chunk is required to be the first one. Anything else first —
        // including a BIN chunk — is a file no reader is obliged to understand,
        // and guessing at the order would mean guessing at the buffer's identity.
        if (first && type !== CHUNK_JSON) {
            throw new Error(`${label}: GLB does not open with a JSON chunk.`);
        }
        first = false;
        if (type === CHUNK_JSON) {
            if (json !== undefined)
                throw new Error(`${label}: GLB has more than one JSON chunk.`);
            json = new TextDecoder().decode(new Uint8Array(bytes, start, length));
        }
        else if (type === CHUNK_BIN) {
            if (binary !== undefined)
                throw new Error(`${label}: GLB has more than one BIN chunk.`);
            binary = bytes.slice(start, start + length);
        }
        offset = start + length;
    }
    // Bytes past the declared length are not read. The length field, not the
    // size of whatever buffer arrived, is what defines the file — a transport
    // that pads its payload is not a corrupt asset, while a chunk that claims to
    // extend into that padding is, and the walk above has already refused one.
    if (json === undefined)
        throw new Error(`${label}: GLB has no JSON chunk.`);
    return binary === undefined ? { json } : { json, binary };
}
