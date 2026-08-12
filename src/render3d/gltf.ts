import { addNode, createScene, node, type Material, type Scene3D } from "./scene.js";
import { createClip, type Clip, type Track } from "./animation.js";
import type { MeshData } from "./mesh.js";

interface GltfDocument {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: GltfPrimitive[] }[];
  materials?: GltfMaterial[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  textures?: { source?: number; sampler?: number }[];
  samplers?: { magFilter?: number; wrapS?: number; wrapT?: number }[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  animations?: GltfAnimation[];
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors?: GltfAccessor[];
}

/** A glTF texture reference, plus the `KHR_texture_transform` scale and offset
 *  that a tiling detail map needs. Rotation is not supported: the renderer's
 *  uv transform is a scale and an offset, and a rotated tiling map is rare
 *  enough that silently ignoring the angle would be worse than not reading it. */
interface GltfTextureRef {
  index?: number;
  scale?: number;
  extensions?: { KHR_texture_transform?: { offset?: number[]; scale?: number[] } };
}

interface GltfMaterial {
  doubleSided?: boolean;
  alphaMode?: string;
  normalTexture?: GltfTextureRef;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    metallicFactor?: number;
    roughnessFactor?: number;
    baseColorTexture?: GltfTextureRef;
  };
  /** The format's own escape hatch, used here to carry the material knobs glTF
   *  cannot express: `uvProjection`, `textureBlend` and `rimAlpha`. */
  extras?: { uvProjection?: string; textureBlend?: string; rimAlpha?: number[] };
}

interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  /** Whatever the exporter needed to say and glTF has no field for. Carried
   *  through untouched — see `LoadedGltf.extras`. */
  extras?: Record<string, unknown>;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
}

interface GltfAnimation {
  name?: string;
  samplers: { input: number; output: number; interpolation?: string }[];
  channels: { sampler: number; target: { node: number; path: string } }[];
}

export interface LoadedGltf {
  scene: Scene3D;
  clips: Clip[];
  /** Node `extras`, keyed by the scene node they became.
   *
   * A pipeline usually has a little to say that glTF has no field for — which
   * nodes a level's logic owns, which are spawn points, which belong to a
   * moving platform. The loader has no opinion on any of it and simply hands
   * the objects back attached to the nodes they came in on; nodes without
   * extras are absent from the map rather than present and empty. */
  extras: Map<number, Record<string, unknown>>;
}

/** Load the useful, renderer-facing part of a glTF 2.0 file: geometry,
 * hierarchy, skins, transform animation, materials and their base-colour and
 * normal textures.
 *
 * An image that fails to decode is skipped rather than failing the load — a
 * missing texture should cost you a texture, not the whole scene. */
export async function loadGltf(url: string): Promise<LoadedGltf> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`glTF request failed (${response.status}): ${url}`);
  const document = (await response.json()) as GltfDocument;
  const buffers = await loadBuffers(document, url);
  const images = await loadImages(document, buffers, url);
  const scene = createScene({ background: [0, 0, 0, 0] });
  const nodes = document.nodes ?? [];
  const meshes = document.meshes ?? [];
  const originalToPivot = new Map<number, number>();
  const visualNodes = new Map<number, number[]>();
  const visiting = new Set<number>();
  const extras = new Map<number, Record<string, unknown>>();

  const buildNode = (originalIndex: number, parent?: number): number => {
    if (visiting.has(originalIndex)) throw new Error("glTF node hierarchy contains a cycle.");
    const source = nodes[originalIndex];
    if (!source) throw new Error(`glTF references missing node ${originalIndex}.`);
    visiting.add(originalIndex);
    const pivot = addNode(
      scene,
      node({
        name: source.name ?? `node-${originalIndex}`,
        parent,
        position: vec3(source.translation, [0, 0, 0]),
        rotation: quat(source.rotation, [0, 0, 0, 1]),
        scale: vec3(source.scale, [1, 1, 1]),
      }),
    );
    originalToPivot.set(originalIndex, pivot);
    if (source.extras) extras.set(pivot, source.extras);

    const visuals: number[] = [];
    const mesh = source.mesh === undefined ? undefined : meshes[source.mesh];
    for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const meshData = readPrimitive(document, buffers, primitive);
      visuals.push(
        addNode(
          scene,
          node({
            name: `${source.name ?? originalIndex}:primitive-${primitiveIndex}`,
            parent: pivot,
            mesh: meshData,
            material: materialFor(document, images, primitive.material),
          }),
        ),
      );
    }
    visualNodes.set(originalIndex, visuals.length > 0 ? visuals : [pivot]);
    for (const child of source.children ?? []) buildNode(child, pivot);
    visiting.delete(originalIndex);
    return pivot;
  };

  const selected = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const root of selected) if (!originalToPivot.has(root)) buildNode(root);
  for (let i = 0; i < nodes.length; i++) if (!originalToPivot.has(i)) buildNode(i);

  for (const [originalIndex, source] of nodes.entries()) {
    if (source.skin === undefined) continue;
    const skin = document.skins?.[source.skin];
    if (!skin) continue;
    const joints = skin.joints.map((joint) => originalToPivot.get(joint)).filter(isNumber);
    const inverseBindMatrices =
      skin.inverseBindMatrices === undefined
        ? identityMatrices(joints.length)
        : readAccessor(document, buffers, skin.inverseBindMatrices);
    for (const visual of visualNodes.get(originalIndex) ?? []) {
      scene.nodes[visual].skin = { joints, inverseBindMatrices };
    }
  }

  return { scene, clips: readAnimations(document, buffers, originalToPivot), extras };
}

function readPrimitive(
  document: GltfDocument,
  buffers: ArrayBuffer[],
  primitive: GltfPrimitive,
): MeshData {
  const positions = readAccessor(
    document,
    buffers,
    required(primitive.attributes.POSITION, "POSITION"),
  );
  const normals = optionalAccessor(document, buffers, primitive.attributes.NORMAL);
  const uvs = optionalAccessor(document, buffers, primitive.attributes.TEXCOORD_0);
  const colors = optionalAccessor(document, buffers, primitive.attributes.COLOR_0);
  const joints = optionalAccessor(document, buffers, primitive.attributes.JOINTS_0);
  const weights = optionalAccessor(document, buffers, primitive.attributes.WEIGHTS_0);
  const indices =
    primitive.indices === undefined
      ? new Uint16Array(Array.from({ length: positions.length / 3 }, (_, i) => i))
      : integerAccessor(document, buffers, primitive.indices);
  const mesh: MeshData = { positions, indices };
  if (normals) mesh.normals = normals;
  if (uvs) mesh.uvs = uvs;
  if (colors)
    mesh.colors = colors.length === (positions.length / 3) * 4 ? colors : expandColors(colors);
  if (joints) mesh.joints = Uint16Array.from(joints);
  if (weights) mesh.weights = normalizeWeights(weights);
  return mesh;
}

function readAnimations(
  document: GltfDocument,
  buffers: ArrayBuffer[],
  nodeMap: Map<number, number>,
): Clip[] {
  return (document.animations ?? []).flatMap((animation, animationIndex) => {
    const tracks = animation.channels.flatMap((channel) => {
      const sampler = animation.samplers[channel.sampler];
      const target = nodeMap.get(channel.target.node);
      if (!sampler || target === undefined) return [];
      const path = channel.target.path;
      if (path !== "translation" && path !== "rotation" && path !== "scale") return [];
      const property = (path === "translation" ? "position" : path) as Track["property"];
      return [
        {
          node: target,
          property,
          times: readAccessor(document, buffers, sampler.input),
          values: readAccessor(document, buffers, sampler.output),
          interpolation: sampler.interpolation === "STEP" ? ("step" as const) : ("linear" as const),
        },
      ];
    });
    return [createClip(animation.name ?? `animation-${animationIndex}`, tracks)];
  });
}

function materialFor(
  document: GltfDocument,
  images: (TexImageSource | undefined)[],
  index: number | undefined,
): Material {
  const source = document.materials?.[index ?? -1];
  const pbr = source?.pbrMetallicRoughness;
  const factor = pbr?.baseColorFactor;
  const material: Material = {
    color: [factor?.[0] ?? 0.85, factor?.[1] ?? 0.9, factor?.[2] ?? 0.95, factor?.[3] ?? 1],
  };
  if (source?.doubleSided) material.doubleSided = true;
  // Only `BLEND` maps. `MASK` is an alpha test, which this renderer has no
  // equivalent for, and treating it as blending would turn a cutout leaf into
  // a depth-write-free surface that sorts against everything else in the scene
  // — a worse wrong answer than leaving it opaque.
  if (source?.alphaMode === "BLEND") material.transparent = true;
  const rim = source?.extras?.rimAlpha;
  if (rim?.length === 3 && rim.every((value) => Number.isFinite(value))) {
    material.rimAlpha = [rim[0]!, rim[1]!, rim[2]!];
  }

  const base = pbr?.baseColorTexture;
  const normal = source?.normalTexture;
  const baseImage = imageFor(document, images, base);
  const normalImage = imageFor(document, images, normal);
  if (baseImage) material.texture = baseImage;
  if (normalImage) {
    material.normalMap = normalImage;
    if (normal?.scale !== undefined) material.normalScale = normal.scale;
  }
  if (baseImage || normalImage) {
    // A glTF texture is photographic by default; the engine's nearest-neighbour
    // default is for pixel art, which a loaded document is usually not.
    material.pixelated = false;
    const sampler =
      document.samplers?.[document.textures?.[(base ?? normal)?.index ?? -1]?.sampler ?? -1];
    if (sampler?.magFilter === NEAREST) material.pixelated = true;
    if (sampler?.wrapS === REPEAT || sampler?.wrapT === REPEAT) material.repeat = true;
    const transform = (base ?? normal)?.extensions?.KHR_texture_transform;
    if (transform?.scale) {
      material.uvScale = [transform.scale[0] ?? 1, transform.scale[1] ?? 1];
      // A tiling transform is pointless against a clamped sampler, and an
      // exporter that writes one usually leaves the sampler at its default.
      if (material.uvScale[0] !== 1 || material.uvScale[1] !== 1) material.repeat = true;
    }
    if (transform?.offset) material.uvOffset = [transform.offset[0] ?? 0, transform.offset[1] ?? 0];
    // glTF has no vocabulary for either of these, and `extras` is the slot the
    // format reserves for exactly that. Unknown values fall through to the
    // material defaults rather than throwing: extras are advisory by design.
    const extras = source?.extras;
    if (extras?.uvProjection === "planarXZ") material.uvProjection = "planarXZ";
    if (extras?.textureBlend === "over") material.textureBlend = "over";
  }
  // glTF describes a microfacet surface and this renderer shades Blinn-Phong,
  // so the two roughness/exponent parameterisations have to be bridged. The
  // textbook `2/α² − 2` maps a polished surface to an exponent in the
  // thousands, which on a low-poly scene reads as a single blown-out pixel;
  // the exponential curve below spans the range the engine's own materials
  // are authored in (a rough surface near 2, a polished one near 256) and
  // keeps the ordering roughness implies.
  if (pbr?.roughnessFactor !== undefined) {
    const roughness = Math.min(1, Math.max(0, pbr.roughnessFactor));
    material.shininess = 2 ** (7 * (1 - roughness) + 1);
  }
  if (pbr?.metallicFactor !== undefined) {
    const metallic = Math.min(1, Math.max(0, pbr.metallicFactor));
    material.metallic = metallic;
    // Metalness is not highlight strength, and `Material.metallic` above is
    // where it belongs. It is still the only "how much does this surface
    // reflect" signal a metallic-roughness document carries, though, and the
    // direct model has nowhere else to get one — without a strength term every
    // lit face bleaches toward white. So it goes in both, and the field that
    // means metalness is the one the physical path reads.
    material.specular = metallic;
  }
  return material;
}

const NEAREST = 9728;
const REPEAT = 10497;

/** The image behind a texture reference, or undefined when the reference, the
 * texture or the decode is missing. */
function imageFor(
  document: GltfDocument,
  images: (TexImageSource | undefined)[],
  ref: GltfTextureRef | undefined,
): TexImageSource | undefined {
  if (ref?.index === undefined) return undefined;
  const source = document.textures?.[ref.index]?.source;
  return source === undefined ? undefined : images[source];
}

/** Decode every image the document declares, in parallel.
 *
 * `createImageBitmap` is the only decode path that works off the main thread
 * and in a worker, and it is what both backends upload from. A decode failure
 * yields `undefined` rather than rejecting: one unreadable texture should not
 * take a whole scene down with it. */
async function loadImages(
  document: GltfDocument,
  buffers: ArrayBuffer[],
  url: string,
): Promise<(TexImageSource | undefined)[]> {
  if (!document.images?.length) return [];
  if (typeof createImageBitmap !== "function") return document.images.map(() => undefined);
  return Promise.all(
    document.images.map(async (image) => {
      try {
        if (image.bufferView !== undefined) {
          const view = document.bufferViews?.[image.bufferView];
          if (!view) return undefined;
          const bytes = new Uint8Array(buffers[view.buffer], view.byteOffset ?? 0, view.byteLength);
          // Copy: the blob must not alias a buffer the mesh readers still use.
          return await createImageBitmap(
            new Blob([bytes.slice()], { type: image.mimeType ?? "image/png" }),
          );
        }
        if (!image.uri) return undefined;
        const response = await fetch(
          image.uri.startsWith("data:") ? image.uri : resolveSibling(image.uri, url),
        );
        if (!response.ok) return undefined;
        return await createImageBitmap(await response.blob());
      } catch {
        return undefined;
      }
    }),
  );
}

async function loadBuffers(document: GltfDocument, url: string): Promise<ArrayBuffer[]> {
  return Promise.all(
    (document.buffers ?? []).map(async (buffer) => {
      if (!buffer.uri)
        throw new Error("Binary .glb buffers are not supported by the JSON loader yet.");
      if (buffer.uri.startsWith("data:")) return decodeDataUri(buffer.uri);
      const response = await fetch(resolveSibling(buffer.uri, url));
      if (!response.ok) throw new Error(`glTF buffer request failed (${response.status}).`);
      return response.arrayBuffer();
    }),
  );
}

/** Resolve a glTF's `.bin` against the document it came from. `url` is often
 * relative (`assets/level.gltf`), which is not a valid `URL` base on its own,
 * so fall back to the document's own base before giving up on a plain join. */
function resolveSibling(uri: string, url: string): string {
  const base = globalThis.document?.baseURI;
  try {
    return new URL(uri, new URL(url, base)).href;
  } catch {
    const directory = url.slice(0, url.lastIndexOf("/") + 1);
    return `${directory}${uri}`;
  }
}

function readAccessor(document: GltfDocument, buffers: ArrayBuffer[], index: number): Float32Array {
  const accessor = document.accessors?.[index];
  if (!accessor) throw new Error(`glTF references missing accessor ${index}.`);
  const view =
    accessor.bufferView === undefined ? undefined : document.bufferViews?.[accessor.bufferView];
  const source = view
    ? buffers[view.buffer]
    : new ArrayBuffer(accessor.count * componentCount(accessor.type) * 4);
  const components = componentCount(accessor.type);
  const componentBytes = bytesPerComponent(accessor.componentType);
  const stride = view?.byteStride ?? components * componentBytes;
  const start = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const output = new Float32Array(accessor.count * components);
  const data = new DataView(source);
  for (let row = 0; row < accessor.count; row++) {
    for (let component = 0; component < components; component++) {
      const offset = start + row * stride + component * componentBytes;
      output[row * components + component] = readComponent(
        data,
        offset,
        accessor.componentType,
        accessor.normalized === true,
      );
    }
  }
  return output;
}

function integerAccessor(
  document: GltfDocument,
  buffers: ArrayBuffer[],
  index: number,
): Uint16Array | Uint32Array {
  const values = readAccessor(document, buffers, index);
  return values.some((value) => value > 65535)
    ? Uint32Array.from(values)
    : Uint16Array.from(values);
}

function optionalAccessor(
  document: GltfDocument,
  buffers: ArrayBuffer[],
  index: number | undefined,
): Float32Array | undefined {
  return index === undefined ? undefined : readAccessor(document, buffers, index);
}

function readComponent(
  data: DataView,
  offset: number,
  componentType: number,
  normalized: boolean,
): number {
  const raw =
    componentType === 5126
      ? data.getFloat32(offset, true)
      : componentType === 5125
        ? data.getUint32(offset, true)
        : componentType === 5123
          ? data.getUint16(offset, true)
          : componentType === 5121
            ? data.getUint8(offset)
            : data.getInt16(offset, true);
  if (!normalized) return raw;
  if (componentType === 5121) return raw / 255;
  if (componentType === 5123) return raw / 65535;
  return Math.max(-1, raw / 32767);
}

function componentCount(type: string): number {
  return type === "SCALAR"
    ? 1
    : type === "VEC2"
      ? 2
      : type === "VEC3"
        ? 3
        : type === "VEC4"
          ? 4
          : 16;
}

function bytesPerComponent(componentType: number): number {
  return componentType === 5126 || componentType === 5125
    ? 4
    : componentType === 5123 || componentType === 5122
      ? 2
      : 1;
}

function expandColors(values: Float32Array): Float32Array {
  const components = values.length % 4 === 0 ? 4 : 3;
  if (components === 4) return values;
  const colors = new Float32Array((values.length / 3) * 4);
  for (let i = 0; i < values.length / 3; i++)
    colors.set([values[i * 3], values[i * 3 + 1], values[i * 3 + 2], 1], i * 4);
  return colors;
}

function normalizeWeights(values: Float32Array): Float32Array {
  const weights = Float32Array.from(values);
  for (let i = 0; i < weights.length; i += 4) {
    const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] || 1;
    for (let j = 0; j < 4; j++) weights[i + j] /= sum;
  }
  return weights;
}

function identityMatrices(count: number): Float32Array {
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    matrices[i * 16] = 1;
    matrices[i * 16 + 5] = 1;
    matrices[i * 16 + 10] = 1;
    matrices[i * 16 + 15] = 1;
  }
  return matrices;
}

function decodeDataUri(uri: string): ArrayBuffer {
  const comma = uri.indexOf(",");
  const payload = uri.slice(comma + 1);
  if (uri.slice(0, comma).endsWith(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
}

function vec3(
  value: number[] | undefined,
  fallback: number[],
): { x: number; y: number; z: number } {
  return {
    x: value?.[0] ?? fallback[0],
    y: value?.[1] ?? fallback[1],
    z: value?.[2] ?? fallback[2],
  };
}

function quat(
  value: number[] | undefined,
  fallback: number[],
): { x: number; y: number; z: number; w: number } {
  return {
    x: value?.[0] ?? fallback[0],
    y: value?.[1] ?? fallback[1],
    z: value?.[2] ?? fallback[2],
    w: value?.[3] ?? fallback[3],
  };
}

function required(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`glTF primitive is missing ${label}.`);
  return value;
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}
