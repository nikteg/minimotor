import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGltf } from "../gltf.js";

/** The smallest document that still produces one drawable primitive. */
function documentWith(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
    ],
    buffers: [{ byteLength: 60, uri: "geometry.bin" }],
    ...extra,
  };
}

/** Two drawable nodes, one per material, so a pair of cases can be compared in
 * one load. */
function twoMaterials(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): Record<string, unknown> {
  return documentWith({
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 1 }] },
    ],
    materials: [first, second],
  });
}

const GEOMETRY = new ArrayBuffer(60);

/** Serve the document, its buffer and any image by path. */
function serve(document: Record<string, unknown>, images: string[] = []): void {
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    if (url.endsWith(".gltf")) return new Response(JSON.stringify(document));
    if (url.endsWith(".bin")) return new Response(GEOMETRY);
    if (images.some((name) => url.endsWith(name)))
      return new Response(new Blob([new Uint8Array(4)]));
    return new Response(null, { status: 404 });
  });
}

/** Stand in for the browser decoder; the renderer only ever hands the result
 * to the GPU, so a tagged object is enough to assert wiring. */
function stubDecoder(): { calls: number } {
  const state = { calls: 0 };
  vi.stubGlobal("createImageBitmap", async () => {
    state.calls++;
    return { width: 2, height: 2, close() {} } as unknown as ImageBitmap;
  });
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadGltf materials", () => {
  it("bridges metallic-roughness onto the renderer's Blinn-Phong terms", async () => {
    serve(
      documentWith({
        materials: [
          {
            doubleSided: true,
            pbrMetallicRoughness: {
              baseColorFactor: [0.2, 0.4, 0.6, 1],
              roughnessFactor: 0,
              metallicFactor: 0.5,
            },
          },
        ],
      }),
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.material?.doubleSided)?.material;
    expect(material?.color).toEqual([0.2, 0.4, 0.6, 1]);
    // A mirror-smooth surface takes the tight end of the exponent range, and
    // metalness becomes the highlight's strength.
    expect(material?.shininess).toBe(256);
    expect(material?.specular).toBe(0.5);
  });

  it("leaves the exponent unset when the document says nothing about roughness", async () => {
    serve(
      documentWith({ materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }] }),
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.shininess).toBeUndefined();
    expect(material?.specular).toBeUndefined();
  });

  it("loads base-colour and normal textures and marks them photographic", async () => {
    const decoder = stubDecoder();
    serve(
      documentWith({
        materials: [
          {
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
            normalTexture: { index: 1, scale: 0.5 },
          },
        ],
        textures: [{ source: 0 }, { source: 1 }],
        images: [{ uri: "detail.png" }, { uri: "normal.png" }],
      }),
      ["detail.png", "normal.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(decoder.calls).toBe(2);
    expect(material?.texture).toBeDefined();
    expect(material?.normalMap).toBeDefined();
    expect(material?.normalScale).toBe(0.5);
    // Nearest-neighbour is the engine's pixel-art default, not a glTF's.
    expect(material?.pixelated).toBe(false);
  });

  it("reads an overlay detail map out of extras, with its own uv set", async () => {
    const decoder = stubDecoder();
    serve(
      documentWith({
        meshes: [
          {
            primitives: [
              { attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 1 }, material: 0 },
            ],
          },
        ],
        materials: [
          {
            pbrMetallicRoughness: { baseColorFactor: [0.9, 0.4, 0.4, 1] },
            extras: { detailTexture: { index: 0, texCoord: 1 }, detailStrength: 0.05 },
          },
        ],
        textures: [{ source: 0, sampler: 0 }],
        samplers: [{ magFilter: 9728, wrapS: 10497 }],
        images: [{ uri: "grid.png" }],
      }),
      ["grid.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const node = scene.nodes.find((n) => n.mesh);
    expect(decoder.calls).toBe(1);
    expect(node?.material?.detailMap).toBeDefined();
    expect(node?.material?.detailStrength).toBe(0.05);
    expect(node?.material?.detailUv).toBe(1);
    expect(node?.mesh?.uvs1).toBeDefined();
    // With no base texture the detail map is the only thing the one sampler
    // has to serve, so a nearest, wrapping detail map gets to be both.
    expect(node?.material?.pixelated).toBe(true);
    expect(node?.material?.repeat).toBe(true);
  });

  it("lets the detail map outrank the normal map when choosing the sampler", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [
          {
            normalTexture: { index: 0 },
            extras: { detailTexture: { index: 1 }, detailStrength: 0.2 },
          },
        ],
        textures: [
          { source: 0, sampler: 0 },
          { source: 1, sampler: 1 },
        ],
        samplers: [{}, { magFilter: 9728 }],
        images: [{ uri: "normal.png" }, { uri: "grid.png" }],
      }),
      ["normal.png", "grid.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    // Both backends sample a normal map smoothly whatever this flag says, so
    // a normal map that outranks the detail map decides the one thing it has
    // no stake in — and silently filters the detail grid into a soft wash.
    expect(scene.nodes.find((n) => n.mesh)?.material?.pixelated).toBe(true);
  });

  it("leaves a detail map with no strength inert", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [{ extras: { detailTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
        images: [{ uri: "grid.png" }],
      }),
      ["grid.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    // Loaded but weightless: both backends test the strength, not the map, so
    // an exporter that writes the texture and forgets the number changes
    // nothing rather than blending at some default.
    expect(material?.detailMap).toBeDefined();
    expect(material?.detailStrength).toBe(0);
    expect(material?.detailUv).toBeUndefined();
  });

  it("reads an independently projected alpha-over detail map", async () => {
    serve(
      documentWith({
        materials: [
          {
            extras: {
              detailBlend: "over",
              detailColorScale: 2,
              detailUvProjection: "planarXZ",
              detailUvScale: [1 / 256, 1 / 256],
              detailUvOffset: [40 / 256, -7 / 256],
            },
          },
        ],
      }),
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.detailBlend).toBe("over");
    expect(material?.detailColorScale).toBe(2);
    expect(material?.detailUvProjection).toBe("planarXZ");
    expect(material?.detailUvScale).toEqual([1 / 256, 1 / 256]);
    expect(material?.detailUvOffset).toEqual([40 / 256, -7 / 256]);
  });

  it("reads a detail mask on its own frequency over the same projection", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [
          {
            extras: {
              detailBlend: "over",
              detailUvProjection: "planarXZ",
              detailUvScale: [1 / 256, -1 / 256],
              detailMaskTexture: { index: 0 },
              detailMaskUvScale: [2, -2],
              detailMaskUvOffset: [92, -52],
            },
          },
        ],
        textures: [{ source: 0 }],
        images: [{ uri: "disc.png" }],
      }),
      ["disc.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.detailMask).toBeDefined();
    // 512 times the decal's own scale, which is what puts one mask tile in
    // each texel of a 512-square canvas projected over 256 world units.
    expect(material?.detailMaskUvScale).toEqual([2, -2]);
    expect(material?.detailMaskUvOffset).toEqual([92, -52]);
  });

  it("drops a detail mask that came without a uv scale", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [{ extras: { detailBlend: "over", detailMaskTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
        images: [{ uri: "disc.png" }],
      }),
      ["disc.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    // A mask is a tiling pattern by definition. With no scale it would stretch
    // one texel over the whole world, which is never what one is for, so the
    // backends' `scale != 0` test reads it as absent — and so does the loader,
    // rather than handing them a texture they will not sample.
    expect(scene.nodes.find((n) => n.mesh)?.material?.detailMask).toBeUndefined();
  });

  it("turns a KHR_texture_transform scale into uv tiling and enables repeat", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [
          {
            pbrMetallicRoughness: {
              baseColorTexture: {
                index: 0,
                extensions: { KHR_texture_transform: { scale: [8, 4], offset: [0.5, 0] } },
              },
            },
          },
        ],
        textures: [{ source: 0 }],
        images: [{ uri: "detail.png" }],
      }),
      ["detail.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.uvScale).toEqual([8, 4]);
    expect(material?.uvOffset).toEqual([0.5, 0]);
    expect(material?.repeat).toBe(true);
  });

  it("reads the two knobs glTF has no vocabulary for out of material extras", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [
          {
            extras: { uvProjection: "planarXZ", textureBlend: "over" },
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
          },
        ],
        textures: [{ source: 0 }],
        images: [{ uri: "detail.png" }],
      }),
      ["detail.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.uvProjection).toBe("planarXZ");
    expect(material?.textureBlend).toBe("over");
  });

  it("ignores extras it does not recognise rather than failing the load", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [
          {
            extras: { uvProjection: "triplanar", textureBlend: "screen" },
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
          },
        ],
        textures: [{ source: 0 }],
        images: [{ uri: "detail.png" }],
      }),
      ["detail.png"],
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.uvProjection).toBeUndefined();
    expect(material?.textureBlend).toBeUndefined();
  });

  it("blends a BLEND material and leaves a MASK one opaque", async () => {
    serve(
      twoMaterials(
        { alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 0.35] } },
        { alphaMode: "MASK", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
      ),
    );

    const [blended, masked] = (await loadGltf("assets/level.gltf")).scene.nodes.filter(
      (n) => n.mesh,
    );
    expect(blended?.material?.transparent).toBe(true);
    expect(masked?.material?.transparent).toBeUndefined();
  });

  it("reads a rim-alpha ramp out of extras and rejects a malformed one", async () => {
    serve(
      twoMaterials(
        { alphaMode: "BLEND", extras: { rimAlpha: [0.27, 1, 0.93] } },
        { alphaMode: "BLEND", extras: { rimAlpha: [0.27, 1] } },
      ),
    );

    const [ramped, malformed] = (await loadGltf("assets/level.gltf")).scene.nodes.filter(
      (n) => n.mesh,
    );
    expect(ramped?.material?.rimAlpha).toEqual([0.27, 1, 0.93]);
    expect(malformed?.material?.rimAlpha).toBeUndefined();
  });

  it("keeps the scene when an image cannot be fetched", async () => {
    stubDecoder();
    serve(
      documentWith({
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
        images: [{ uri: "missing.png" }],
      }),
    );

    const { scene } = await loadGltf("assets/level.gltf");
    const material = scene.nodes.find((n) => n.mesh)?.material;
    expect(material?.texture).toBeUndefined();
    expect(scene.nodes.some((n) => n.mesh)).toBe(true);
  });

  it("decodes an image embedded in a buffer view", async () => {
    const decoder = stubDecoder();
    serve(
      documentWith({
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
        images: [{ bufferView: 2, mimeType: "image/png" }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: 24 },
          { buffer: 0, byteOffset: 0, byteLength: 8 },
        ],
      }),
    );

    const { scene } = await loadGltf("assets/level.gltf");
    expect(decoder.calls).toBe(1);
    expect(scene.nodes.find((n) => n.mesh)?.material?.texture).toBeDefined();
  });
});

describe("loadGltf node extras", () => {
  it("hands node extras back keyed by the scene node they landed on", async () => {
    serve(
      documentWith({
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { name: "static" },
          { name: "platform", mesh: 0, extras: { mover: 3, tags: ["solid"] } },
        ],
      }),
    );

    const { scene, extras } = await loadGltf("assets/level.gltf");
    const platform = scene.nodes.findIndex((node) => node.name === "platform");
    expect(extras.get(platform)).toEqual({ mover: 3, tags: ["solid"] });
    // The node's own primitives are children of it, so moving the pivot moves
    // them; only the pivot carries the annotation.
    expect([...extras.keys()]).toEqual([platform]);
  });
});
