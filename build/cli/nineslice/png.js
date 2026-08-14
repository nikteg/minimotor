// ---------- PNG pixels for Node ----------
//
// The browser gets pixels from `drawImage` + `getImageData`; Node has no image
// decoder at all, which is why every asset check in this repo so far could only
// read the PNG *header*. Nine-slice verification needs the actual samples, so
// this module decodes and re-encodes PNG with nothing but `node:zlib`.
//
// Scope is deliberately narrow — what game atlases actually ship as:
// non-interlaced, bit depth 1/2/4/8/16, colour types 0/2/3/4/6, `tRNS`.
// Adam7 is rejected with a message rather than half-supported. Everything is
// normalised to straight (non-premultiplied) 8-bit RGBA, matching canvas.
import { deflateSync, inflateSync } from "node:zlib";
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Undo the per-scanline filter PNG applies before compression. */
function unfilter(raw, height, stride, bpp) {
    const out = new Uint8Array(height * stride);
    let read = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[read++];
        const line = y * stride;
        const previous = line - stride;
        for (let i = 0; i < stride; i++) {
            const value = raw[read++];
            const a = i >= bpp ? out[line + i - bpp] : 0;
            const b = y > 0 ? out[previous + i] : 0;
            const c = y > 0 && i >= bpp ? out[previous + i - bpp] : 0;
            let restored;
            switch (filter) {
                case 0:
                    restored = value;
                    break;
                case 1:
                    restored = value + a;
                    break;
                case 2:
                    restored = value + b;
                    break;
                case 3:
                    restored = value + ((a + b) >> 1);
                    break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a);
                    const pb = Math.abs(p - b);
                    const pc = Math.abs(p - c);
                    restored = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                    break;
                }
                default:
                    throw new Error(`unsupported PNG scanline filter ${filter}`);
            }
            out[line + i] = restored & 0xff;
        }
    }
    return out;
}
/** Read one sample of `depth` bits from a packed scanline. */
const sample = (line, index, depth) => {
    if (depth === 8)
        return line[index];
    if (depth === 16)
        return line[index * 2];
    const perByte = 8 / depth;
    const byte = line[Math.floor(index / perByte)];
    const shift = 8 - depth * ((index % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
};
/** Decode a PNG file into straight-alpha RGBA pixels. */
export function decodePng(file) {
    for (let i = 0; i < SIGNATURE.length; i++) {
        if (file[i] !== SIGNATURE[i])
            throw new Error("not a PNG file");
    }
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    let depth = 8;
    let colorType = 6;
    let palette;
    let transparency;
    const idat = [];
    while (offset + 8 <= file.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8));
        const body = file.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
        if (type === "IHDR") {
            width = ((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) >>> 0;
            height = ((body[4] << 24) | (body[5] << 16) | (body[6] << 8) | body[7]) >>> 0;
            depth = body[8];
            colorType = body[9];
            if (body[12] !== 0)
                throw new Error("interlaced (Adam7) PNG is not supported");
        }
        else if (type === "PLTE")
            palette = body.slice();
        else if (type === "tRNS")
            transparency = body.slice();
        else if (type === "IDAT")
            idat.push(body);
        else if (type === "IEND")
            break;
    }
    const channels = CHANNELS[colorType];
    if (!channels)
        throw new Error(`unsupported PNG colour type ${colorType}`);
    if (width <= 0 || height <= 0)
        throw new Error("PNG has no IHDR");
    const merged = Buffer.concat(idat.map((chunk) => Buffer.from(chunk)));
    const stride = Math.ceil((width * channels * depth) / 8);
    const raw = unfilter(new Uint8Array(inflateSync(merged)), height, stride, Math.ceil((channels * depth) / 8));
    const max = (1 << depth) - 1;
    const scale = depth === 16 ? 1 : 255 / max;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const line = raw.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            const read = (channel) => sample(line, x * channels + channel, depth);
            if (colorType === 3) {
                const index = read(0);
                const source = palette ? index * 3 : 0;
                data[at] = palette ? palette[source] : 0;
                data[at + 1] = palette ? palette[source + 1] : 0;
                data[at + 2] = palette ? palette[source + 2] : 0;
                data[at + 3] = transparency && index < transparency.length ? transparency[index] : 255;
                continue;
            }
            if (colorType === 0 || colorType === 4) {
                const grey = Math.round(read(0) * scale);
                data[at] = grey;
                data[at + 1] = grey;
                data[at + 2] = grey;
                data[at + 3] = colorType === 4 ? Math.round(read(1) * scale) : 255;
            }
            else {
                data[at] = Math.round(read(0) * scale);
                data[at + 1] = Math.round(read(1) * scale);
                data[at + 2] = Math.round(read(2) * scale);
                data[at + 3] = colorType === 6 ? Math.round(read(3) * scale) : 255;
            }
            // A `tRNS` entry on a truecolour or greyscale image names one fully
            // transparent sample value rather than carrying an alpha channel.
            if (transparency && colorType !== 4 && colorType !== 6) {
                const keyed = colorType === 0
                    ? read(0) === ((transparency[0] << 8) | transparency[1])
                    : read(0) === ((transparency[0] << 8) | transparency[1]) &&
                        read(1) === ((transparency[2] << 8) | transparency[3]) &&
                        read(2) === ((transparency[4] << 8) | transparency[5]);
                if (keyed)
                    data[at + 3] = 0;
            }
        }
    }
    return { width, height, data };
}
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes)
        c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), Buffer.from(body)])), 0);
    return Buffer.concat([head, Buffer.from(body), crc]);
};
/** Encode straight-alpha RGBA pixels as an 8-bit RGBA PNG. */
export function encodePng(image) {
    const { width, height, data } = image;
    const raw = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        Buffer.from(data.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from(SIGNATURE),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", new Uint8Array(0)),
    ]);
}
/** Allocate a transparent image. */
export const blank = (width, height) => ({
    width,
    height,
    data: new Uint8Array(width * height * 4),
});
