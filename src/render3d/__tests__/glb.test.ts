import { afterEach, describe, expect, it, vi } from "vitest";
import { isGlb, parseGlb } from "../glb.js";
import { loadGltf, loadGltfAsset, readGltfAccessor, readGltfIndices } from "../gltf.js";

/** One triangle: three VEC3 positions and three unsigned-short indices, padded
 * to the four-byte boundary a GLB chunk has to end on. */
const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const INDICES = new Uint16Array([0, 1, 2, 0]);
const GEOMETRY = new Uint8Array(POSITIONS.byteLength + INDICES.byteLength);
GEOMETRY.set(new Uint8Array(POSITIONS.buffer), 0);
GEOMETRY.set(new Uint8Array(INDICES.buffer), POSITIONS.byteLength);

/** The document that reads that buffer, with `buffers[0]` left URI-less the
 * way a GLB's own buffer is. */
function embeddedDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "triangle", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: POSITIONS.byteLength },
      { buffer: 0, byteOffset: POSITIONS.byteLength, byteLength: 6 },
    ],
    buffers: [{ byteLength: GEOMETRY.byteLength }],
    ...extra,
  };
}

interface ChunkSpec {
  type: number;
  bytes: Uint8Array;
  /** Written into the chunk header in place of the real byte length, for the
   * malformed cases. */
  declaredLength?: number;
}

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Assemble a GLB from chunks, so a test can build a malformed one as easily
 * as a valid one. Every field the header carries is overridable. */
function container(
  chunks: ChunkSpec[],
  header: { magic?: number; version?: number; length?: number } = {},
): ArrayBuffer {
  const body = chunks.reduce((total, chunk) => total + 8 + chunk.bytes.byteLength, 0);
  const bytes = new Uint8Array(12 + body);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, header.magic ?? 0x46546c67, true);
  view.setUint32(4, header.version ?? 2, true);
  view.setUint32(8, header.length ?? bytes.byteLength, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.declaredLength ?? chunk.bytes.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    bytes.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.byteLength;
  }
  return bytes.buffer;
}

/** A JSON chunk: UTF-8, padded with the spaces the specification asks for. */
function jsonChunk(document: unknown): ChunkSpec {
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const padded = new Uint8Array(align(encoded.byteLength)).fill(0x20);
  padded.set(encoded);
  return { type: CHUNK_JSON, bytes: padded };
}

function binChunk(data: Uint8Array): ChunkSpec {
  const padded = new Uint8Array(align(data.byteLength));
  padded.set(data);
  return { type: CHUNK_BIN, bytes: padded };
}

function align(length: number): number {
  return length + ((4 - (length % 4)) % 4);
}

/** A GLB carrying `embeddedDocument()` and the triangle behind it. */
function triangleGlb(extra: Record<string, unknown> = {}): ArrayBuffer {
  return container([jsonChunk(embeddedDocument(extra)), binChunk(GEOMETRY)]);
}

/** Serve one file per URL. Anything unlisted 404s, so a test that expects a
 * particular resolved URL fails loudly rather than quietly loading nothing. */
function serve(files: Record<string, ArrayBuffer | string>): string[] {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    requested.push(url);
    const body = files[url];
    if (body === undefined) return new Response(null, { status: 404 });
    return new Response(body);
  });
  return requested;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseGlb", () => {
  it("recognises the container by its magic and not by a file name", () => {
    expect(isGlb(triangleGlb())).toBe(true);
    expect(isGlb(new TextEncoder().encode('{"asset":{}}').buffer)).toBe(false);
    expect(isGlb(new ArrayBuffer(2))).toBe(false);
  });

  it("splits a valid container into its JSON text and its BIN chunk", () => {
    const parsed = parseGlb(triangleGlb());
    expect(JSON.parse(parsed.json)).toMatchObject({ asset: { version: "2.0" } });
    expect(parsed.binary?.byteLength).toBe(align(GEOMETRY.byteLength));
    // Sliced out of the file, so the document's offsets — which are measured
    // from the start of the buffer — land where the document says they do.
    expect(new Float32Array(parsed.binary!, 0, 9)).toEqual(POSITIONS);
  });

  it("accepts a container with no BIN chunk at all", () => {
    const parsed = parseGlb(container([jsonChunk({ asset: { version: "2.0" } })]));
    expect(parsed.binary).toBeUndefined();
  });

  it("skips a chunk of a type it does not know", () => {
    const parsed = parseGlb(
      container([
        jsonChunk(embeddedDocument()),
        { type: 0x12345678, bytes: new Uint8Array(8) },
        binChunk(GEOMETRY),
      ]),
    );
    expect(parsed.binary?.byteLength).toBe(align(GEOMETRY.byteLength));
  });

  it("rejects a malformed header", () => {
    expect(() => parseGlb(new ArrayBuffer(8))).toThrow(/too short/);
    expect(() => parseGlb(container([jsonChunk({})], { magic: 0x11223344 }))).toThrow(/not a GLB/);
    expect(() => parseGlb(container([jsonChunk({})], { version: 1 }))).toThrow(/version 1/);
    // A truncated download: the file says how long it is, and fewer bytes
    // arrived than that.
    expect(() => parseGlb(container([jsonChunk({})], { length: 4096 }))).toThrow(
      /declares 4096 bytes/,
    );
    expect(() => parseGlb(container([jsonChunk({})], { length: 4 }))).toThrow(/impossible length/);
  });

  it("rejects malformed chunks", () => {
    // A chunk whose length is not a multiple of four misaligns every header
    // after it, so it is refused rather than read.
    expect(() => parseGlb(container([{ type: CHUNK_JSON, bytes: new Uint8Array(6) }]))).toThrow(
      /unaligned length 6/,
    );
    expect(() => parseGlb(container([{ ...jsonChunk({}), declaredLength: 1024 }]))).toThrow(
      /runs past the end/,
    );
    expect(() => parseGlb(container([binChunk(GEOMETRY), jsonChunk({})]))).toThrow(
      /does not open with a JSON chunk/,
    );
    expect(() => parseGlb(container([jsonChunk({}), jsonChunk({})]))).toThrow(
      /more than one JSON chunk/,
    );
    expect(() =>
      parseGlb(container([jsonChunk({}), binChunk(GEOMETRY), binChunk(GEOMETRY)])),
    ).toThrow(/more than one BIN chunk/);
    // Eight bytes short of a chunk header, with the length field claiming they
    // are there.
    const stub = new Uint8Array(16);
    new DataView(stub.buffer).setUint32(0, 0x46546c67, true);
    new DataView(stub.buffer).setUint32(4, 2, true);
    new DataView(stub.buffer).setUint32(8, 16, true);
    expect(() => parseGlb(stub.buffer)).toThrow(/mid-chunk-header/);
  });

  it("names the source in its errors", () => {
    expect(() => parseGlb(new ArrayBuffer(8), "assets/level.glb")).toThrow(/assets\/level\.glb/);
  });
});

describe("loadGltfAsset", () => {
  it("loads a GLB's embedded geometry through its BIN chunk", async () => {
    serve({ "https://example.test/level.glb": triangleGlb() });
    const asset = await loadGltfAsset("https://example.test/level.glb");
    expect(asset.buffers).toHaveLength(1);
    expect(readGltfAccessor(asset, 0)).toEqual(POSITIONS);
    expect(readGltfIndices(asset, 1)).toEqual(Uint16Array.from([0, 1, 2]));
    expect(asset.document.nodes?.[0]?.name).toBe("triangle");
  });

  it("still loads plain JSON glTF with an external buffer", async () => {
    const document = embeddedDocument({ buffers: [{ byteLength: 48, uri: "geometry.bin" }] });
    const requested = serve({
      "https://example.test/assets/level.gltf": JSON.stringify(document),
      "https://example.test/assets/geometry.bin": GEOMETRY.buffer,
    });
    const asset = await loadGltfAsset("https://example.test/assets/level.gltf");
    expect(readGltfAccessor(asset, 0)).toEqual(POSITIONS);
    // Resolved against the document's own URL, not the page's.
    expect(requested).toContain("https://example.test/assets/geometry.bin");
  });

  it("resolves an external buffer beside a relative document URL", async () => {
    // A relative URL is not a `URL` base on its own, so the sibling is
    // resolved through the page's own base — which is what a browser loading
    // `assets/courses/level.gltf` off a served page does.
    const sibling = new URL("assets/courses/geometry.bin", globalThis.document.baseURI).href;
    const json = embeddedDocument({ buffers: [{ byteLength: 48, uri: "geometry.bin" }] });
    const requested = serve({
      "assets/courses/level.gltf": JSON.stringify(json),
      [sibling]: GEOMETRY.buffer,
    });
    await loadGltfAsset("assets/courses/level.gltf");
    expect(requested).toContain(sibling);
  });

  it("reads a buffer out of a data URI", async () => {
    const base64 = Buffer.from(GEOMETRY).toString("base64");
    const document = embeddedDocument({
      buffers: [{ byteLength: 48, uri: `data:application/octet-stream;base64,${base64}` }],
    });
    serve({ "level.gltf": JSON.stringify(document) });
    const asset = await loadGltfAsset("level.gltf");
    expect(readGltfAccessor(asset, 0)).toEqual(POSITIONS);
  });

  it("refuses a URI-less buffer with no BIN chunk behind it", async () => {
    serve({ "level.glb": container([jsonChunk(embeddedDocument())]) });
    await expect(loadGltfAsset("level.glb")).rejects.toThrow(/no BIN chunk/);
  });

  it("refuses a second URI-less buffer", async () => {
    const document = embeddedDocument({
      buffers: [{ byteLength: GEOMETRY.byteLength }, { byteLength: 4 }],
    });
    serve({ "level.glb": container([jsonChunk(document), binChunk(GEOMETRY)]) });
    await expect(loadGltfAsset("level.glb")).rejects.toThrow(/only buffer 0/);
  });

  it("reports unparseable JSON with the URL that carried it", async () => {
    serve({ "broken.gltf": "{ not json" });
    await expect(loadGltfAsset("broken.gltf")).rejects.toThrow(/broken\.gltf/);
  });

  it("reports a failed request", async () => {
    serve({});
    await expect(loadGltfAsset("missing.glb")).rejects.toThrow(/404/);
  });
});

describe("loadGltf over a GLB", () => {
  it("builds the same scene the JSON path builds", async () => {
    serve({ "level.glb": triangleGlb() });
    const loaded = await loadGltf("level.glb");
    const drawn = loaded.scene.nodes.filter((entry) => entry.mesh);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.mesh?.positions).toEqual(POSITIONS);
    expect(drawn[0]!.mesh?.indices).toEqual(Uint16Array.from([0, 1, 2]));
  });

  it("carries node extras through, so an application can find its own nodes", async () => {
    serve({
      "level.glb": triangleGlb({
        nodes: [{ name: "triangle", mesh: 0, extras: { spawn: 3 } }],
      }),
    });
    const loaded = await loadGltf("level.glb");
    expect([...loaded.extras.values()]).toEqual([{ spawn: 3 }]);
  });

  it("decodes an image stored in a buffer view", async () => {
    const decoded: number[] = [];
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
      decoded.push(blob.size);
      return { width: 1, height: 1, close() {} } as unknown as ImageBitmap;
    });
    serve({
      "level.glb": triangleGlb({
        images: [{ bufferView: 2, mimeType: "image/png" }],
        textures: [{ source: 0 }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: POSITIONS.byteLength },
          { buffer: 0, byteOffset: POSITIONS.byteLength, byteLength: 6 },
          { buffer: 0, byteOffset: POSITIONS.byteLength, byteLength: 8 },
        ],
      }),
    });
    const loaded = await loadGltf("level.glb");
    expect(decoded).toEqual([8]);
    expect(loaded.scene.nodes.find((entry) => entry.mesh)?.material?.texture).toBeDefined();
  });

  it("resolves an external image beside the GLB", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      return { width: 1, height: 1, close() {} } as unknown as ImageBitmap;
    });
    const requested = serve({
      "https://example.test/courses/level.glb": triangleGlb({
        images: [{ uri: "textures/grass.png" }],
        textures: [{ source: 0 }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      }),
      "https://example.test/courses/textures/grass.png": new ArrayBuffer(4),
    });
    await loadGltf("https://example.test/courses/level.glb");
    expect(requested).toContain("https://example.test/courses/textures/grass.png");
  });
});
