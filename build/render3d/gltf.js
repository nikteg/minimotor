import { addNode, createScene, node } from "./scene.js";
import { createClip } from "./animation.js";
import { isGlb, parseGlb } from "./glb.js";
/** Fetch and parse a glTF or GLB file, resolving its buffers.
 *
 * The container is decided by the first four bytes and not by the URL: a GLB
 * served as `.gltf`, or from a blob or a URL with no filename at all, is still
 * a GLB. */
export async function loadGltfAsset(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`glTF request failed (${response.status}): ${url}`);
    return parseGltfAsset(await response.arrayBuffer(), url);
}
/** Parse glTF or GLB bytes that are already in hand.
 *
 * `url` is what relative buffer and image URIs resolve against, and what names
 * the file in any error; bytes with no URL of their own can pass anything that
 * locates their siblings. */
export async function parseGltfAsset(bytes, url) {
    const container = isGlb(bytes) ? parseGlb(bytes, url) : undefined;
    const text = container ? container.json : new TextDecoder().decode(bytes);
    let document;
    try {
        document = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`glTF JSON is not parseable: ${url} (${error.message})`);
    }
    if (typeof document !== "object" || document === null) {
        throw new Error(`glTF document is not an object: ${url}`);
    }
    const buffers = await loadBuffers(document, url, container?.binary);
    return { document, buffers, baseUrl: url };
}
/** Load the useful, renderer-facing part of a glTF 2.0 file: geometry,
 * hierarchy, skins, transform animation, materials and their base-colour and
 * normal textures.
 *
 * An image that fails to decode is skipped rather than failing the load — a
 * missing texture should cost you a texture, not the whole scene. */
export async function loadGltf(url) {
    return instantiateGltf(await loadGltfAsset(url));
}
/** Build the render scene, materials, images and animation clips out of an
 * asset that has already been fetched and parsed. */
export async function instantiateGltf(asset) {
    const { document, buffers, baseUrl: url } = asset;
    const images = await loadImages(document, buffers, url);
    const scene = createScene({ background: [0, 0, 0, 0] });
    const nodes = document.nodes ?? [];
    const meshes = document.meshes ?? [];
    /** One `MeshData` per glTF mesh+primitive, however many nodes point at it.
     *
     *  A mesh referenced by thirty nodes is one set of vertices in the file, and
     *  reading it per node produced thirty of them: thirty GPU uploads of
     *  identical data. MEASURED on a consumer's level — 416 drawable nodes
     *  carrying 412 distinct meshes where the file holds 114.
     *
     *  Safe to share where a material is not: nothing edits a loaded mesh's
     *  vertices in place — a mesh that animates is a skin, which is a per-node
     *  pose over shared geometry, and one rewritten every frame is one the app
     *  built rather than one out of a file. */
    const meshCache = new Map();
    const meshFor = (meshIndex, primitiveIndex, primitive) => {
        const key = `${meshIndex}:${primitiveIndex}`;
        let found = meshCache.get(key);
        if (!found) {
            found = readPrimitive(document, buffers, primitive);
            meshCache.set(key, found);
        }
        return found;
    };
    const originalToPivot = new Map();
    const visualNodes = new Map();
    const visiting = new Set();
    const extras = new Map();
    const buildNode = (originalIndex, parent) => {
        if (visiting.has(originalIndex))
            throw new Error("glTF node hierarchy contains a cycle.");
        const source = nodes[originalIndex];
        if (!source)
            throw new Error(`glTF references missing node ${originalIndex}.`);
        visiting.add(originalIndex);
        const pivot = addNode(scene, node({
            name: source.name ?? `node-${originalIndex}`,
            parent,
            position: vec3(source.translation, [0, 0, 0]),
            rotation: quat(source.rotation, [0, 0, 0, 1]),
            scale: vec3(source.scale, [1, 1, 1]),
        }));
        originalToPivot.set(originalIndex, pivot);
        if (source.extras)
            extras.set(pivot, source.extras);
        const visuals = [];
        const mesh = source.mesh === undefined ? undefined : meshes[source.mesh];
        for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
            if ((primitive.mode ?? 4) !== 4)
                continue;
            const meshData = meshFor(source.mesh, primitiveIndex, primitive);
            visuals.push(addNode(scene, node({
                name: `${source.name ?? originalIndex}:primitive-${primitiveIndex}`,
                parent: pivot,
                mesh: meshData,
                material: materialFor(document, images, primitive.material),
            })));
        }
        visualNodes.set(originalIndex, visuals.length > 0 ? visuals : [pivot]);
        for (const child of source.children ?? [])
            buildNode(child, pivot);
        visiting.delete(originalIndex);
        return pivot;
    };
    // The default scene is the whole of what gets built. glTF keeps `nodes` as a
    // flat pool and a scene names the roots into it, so a document may carry
    // layers no viewer should show: a collision hull, a spawn locator, an
    // alternative dress for the same model. Instantiating the pool would read
    // their accessors and DRAW them. A document with no `scenes` at all has
    // expressed no opinion, and then everything in it is what it has.
    const selected = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
    for (const root of selected)
        if (!originalToPivot.has(root))
            buildNode(root);
    for (const [originalIndex, source] of nodes.entries()) {
        if (source.skin === undefined || !originalToPivot.has(originalIndex))
            continue;
        const skin = document.skins?.[source.skin];
        if (!skin)
            continue;
        // A joint outside the scene still poses a mesh inside it, and
        // `inverseBindMatrices` is positional — dropping joint 3 would shift every
        // matrix after it onto the wrong bone. So a skin reaches its joints even
        // where the scene graph does not, which is the one thing the pool pass
        // above was ever needed for.
        const joints = skin.joints
            .map((joint) => originalToPivot.get(joint) ?? (nodes[joint] ? buildNode(joint) : undefined))
            .filter(isNumber);
        const inverseBindMatrices = skin.inverseBindMatrices === undefined
            ? identityMatrices(joints.length)
            : readAccessor(document, buffers, skin.inverseBindMatrices);
        for (const visual of visualNodes.get(originalIndex) ?? []) {
            scene.nodes[visual].skin = { joints, inverseBindMatrices };
        }
    }
    return { scene, clips: readAnimations(document, buffers, originalToPivot), extras };
}
function readPrimitive(document, buffers, primitive) {
    const positions = readAccessor(document, buffers, required(primitive.attributes.POSITION, "POSITION"));
    const normals = optionalAccessor(document, buffers, primitive.attributes.NORMAL);
    const tangents = optionalAccessor(document, buffers, primitive.attributes.TANGENT);
    const uvs = optionalAccessor(document, buffers, primitive.attributes.TEXCOORD_0);
    const uvs1 = optionalAccessor(document, buffers, primitive.attributes.TEXCOORD_1);
    const colors = optionalAccessor(document, buffers, primitive.attributes.COLOR_0);
    const joints = optionalAccessor(document, buffers, primitive.attributes.JOINTS_0);
    const weights = optionalAccessor(document, buffers, primitive.attributes.WEIGHTS_0);
    const indices = primitive.indices === undefined
        ? new Uint16Array(Array.from({ length: positions.length / 3 }, (_, i) => i))
        : integerAccessor(document, buffers, primitive.indices);
    const mesh = { positions, indices };
    if (normals)
        mesh.normals = normals;
    // glTF defines `TANGENT` as VEC4 — xyz along the surface, w the bitangent's
    // handedness. Anything else is a malformed file, so drop it rather than feed
    // the backends a stride they will read off the end of.
    if (tangents && tangents.length === (positions.length / 3) * 4)
        mesh.tangents = tangents;
    if (uvs)
        mesh.uvs = uvs;
    if (uvs1)
        mesh.uvs1 = uvs1;
    if (colors)
        mesh.colors = colors.length === (positions.length / 3) * 4 ? colors : expandColors(colors);
    if (joints)
        mesh.joints = Uint16Array.from(joints);
    if (weights)
        mesh.weights = normalizeWeights(weights);
    return mesh;
}
function readAnimations(document, buffers, nodeMap) {
    return (document.animations ?? []).flatMap((animation, animationIndex) => {
        const tracks = animation.channels.flatMap((channel) => {
            const sampler = animation.samplers[channel.sampler];
            const target = nodeMap.get(channel.target.node);
            if (!sampler || target === undefined)
                return [];
            const path = channel.target.path;
            if (path !== "translation" && path !== "rotation" && path !== "scale")
                return [];
            const property = (path === "translation" ? "position" : path);
            return [
                {
                    node: target,
                    property,
                    times: readAccessor(document, buffers, sampler.input),
                    values: readAccessor(document, buffers, sampler.output),
                    interpolation: sampler.interpolation === "STEP" ? "step" : "linear",
                },
            ];
        });
        return [createClip(animation.name ?? `animation-${animationIndex}`, tracks)];
    });
}
function materialFor(document, images, index) {
    const source = document.materials?.[index ?? -1];
    const pbr = source?.pbrMetallicRoughness;
    const factor = pbr?.baseColorFactor;
    const material = {
        color: [factor?.[0] ?? 0.85, factor?.[1] ?? 0.9, factor?.[2] ?? 0.95, factor?.[3] ?? 1],
    };
    if (source?.doubleSided)
        material.doubleSided = true;
    // Only `BLEND` maps. `MASK` is an alpha test, which this renderer has no
    // equivalent for, and treating it as blending would turn a cutout leaf into
    // a depth-write-free surface that sorts against everything else in the scene
    // — a worse wrong answer than leaving it opaque.
    if (source?.alphaMode === "BLEND")
        material.transparent = true;
    const rim = source?.extras?.rimAlpha;
    if (rim?.length === 3 && rim.every((value) => Number.isFinite(value))) {
        material.rimAlpha = [rim[0], rim[1], rim[2]];
    }
    const base = pbr?.baseColorTexture;
    const normal = source?.normalTexture;
    const detail = source?.extras?.detailTexture;
    const baseImage = imageFor(document, images, base);
    const normalImage = imageFor(document, images, normal);
    const detailImage = imageFor(document, images, detail);
    if (baseImage)
        material.texture = baseImage;
    if (normalImage) {
        material.normalMap = normalImage;
        if (normal?.scale !== undefined)
            material.normalScale = normal.scale;
    }
    if (detailImage) {
        material.detailMap = detailImage;
        material.detailStrength = source?.extras?.detailStrength ?? 0;
        if (detail?.texCoord === 1)
            material.detailUv = 1;
    }
    const detailScale = source?.extras?.detailUvScale;
    const detailOffset = source?.extras?.detailUvOffset;
    const detailColorScale = source?.extras?.detailColorScale;
    if (source?.extras?.detailBlend === "over")
        material.detailBlend = "over";
    if (typeof detailColorScale === "number" && Number.isFinite(detailColorScale)) {
        material.detailColorScale = detailColorScale;
    }
    if (source?.extras?.detailUvProjection === "planarXZ") {
        material.detailUvProjection = "planarXZ";
    }
    if (detailScale?.length === 2 && detailScale.every((value) => Number.isFinite(value))) {
        material.detailUvScale = [detailScale[0], detailScale[1]];
    }
    if (detailOffset?.length === 2 && detailOffset.every((value) => Number.isFinite(value))) {
        material.detailUvOffset = [detailOffset[0], detailOffset[1]];
    }
    // The mask needs a uv scale to mean anything at all — it is a tiling pattern
    // read off the secondary map's own source — so an image with no scale beside
    // it is dropped rather than sampled once across the world.
    const maskScale = source?.extras?.detailMaskUvScale;
    const maskOffset = source?.extras?.detailMaskUvOffset;
    const maskImage = imageFor(document, images, source?.extras?.detailMaskTexture);
    if (maskImage && maskScale?.length === 2 && maskScale.every((value) => Number.isFinite(value))) {
        material.detailMask = maskImage;
        material.detailMaskUvScale = [maskScale[0], maskScale[1]];
        if (maskOffset?.length === 2 && maskOffset.every((value) => Number.isFinite(value))) {
            material.detailMaskUvOffset = [maskOffset[0], maskOffset[1]];
        }
    }
    // The MASK counts. It is a texture with a sampler like any other, and a
    // material that carries nothing else used to skip this block entirely and
    // keep the untextured defaults — nearest, and CLAMPED. A mask is a tiling
    // pattern by definition (see Material.detailMask), so clamping it reads the
    // sheet's edge texel across the whole surface; where that edge is
    // transparent the mask reads as absent everywhere and the `over` blend it
    // gates is switched off on a surface that looks fully textured. It is a
    // silent failure: the decal simply never appears, on exactly the materials
    // whose only map is the mask.
    if (baseImage || normalImage || detailImage || maskImage) {
        // A glTF texture is photographic by default; the engine's nearest-neighbour
        // default is for pixel art, which a loaded document is usually not.
        material.pixelated = false;
        // One sampler serves the whole material, so a document that wants two
        // different filters on one surface cannot have them. The base texture wins
        // when there is one, since that is the map the eye reads as the surface;
        // otherwise the detail map chooses, which is what a deliberately blocky
        // overlay over an untextured colour needs.
        //
        // The normal map is last on purpose, and in practice never decides
        // anything: both backends sample a normal map smoothly whatever this says,
        // because a nearest-sampled vector field turns a smooth surface into
        // faceted steps. Letting it outrank the detail map here is what quietly
        // filtered every wall's 32x32 detail grid into a soft wash.
        // The mask is LAST, after the normal map: it decides the sampler only for
        // a material that has no other map, which is the case this list was
        // extended for.
        const chosen = base ?? detail ?? normal ?? source?.extras?.detailMaskTexture;
        const sampler = document.samplers?.[document.textures?.[chosen?.index ?? -1]?.sampler ?? -1];
        if (sampler?.magFilter === NEAREST)
            material.pixelated = true;
        if (sampler?.wrapS === REPEAT || sampler?.wrapT === REPEAT)
            material.repeat = true;
        const transform = (base ?? normal)?.extensions?.KHR_texture_transform;
        if (transform?.scale) {
            material.uvScale = [transform.scale[0] ?? 1, transform.scale[1] ?? 1];
            // A tiling transform is pointless against a clamped sampler, and an
            // exporter that writes one usually leaves the sampler at its default.
            if (material.uvScale[0] !== 1 || material.uvScale[1] !== 1)
                material.repeat = true;
        }
        if (transform?.offset)
            material.uvOffset = [transform.offset[0] ?? 0, transform.offset[1] ?? 0];
        // glTF has no vocabulary for either of these, and `extras` is the slot the
        // format reserves for exactly that. Unknown values fall through to the
        // material defaults rather than throwing: extras are advisory by design.
        const extras = source?.extras;
        if (extras?.uvProjection === "planarXZ")
            material.uvProjection = "planarXZ";
        if (extras?.textureBlend === "over")
            material.textureBlend = "over";
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
    // …unless the document says otherwise. Core metallic-roughness has no
    // dielectric reflectance term at all, so an exporter that knows the real one
    // has nowhere to put it but `extras`, and standing metalness in for it is a
    // guess this should defer to. Read after `metallicFactor` so it overrides.
    if (typeof source?.extras?.specular === "number" && Number.isFinite(source.extras.specular)) {
        material.specular = Math.max(0, source.extras.specular);
    }
    return material;
}
const NEAREST = 9728;
const REPEAT = 10497;
/** The image behind a texture reference, or undefined when the reference, the
 * texture or the decode is missing. */
function imageFor(document, images, ref) {
    if (ref?.index === undefined)
        return undefined;
    const source = document.textures?.[ref.index]?.source;
    return source === undefined ? undefined : images[source];
}
/** Decode every image the document declares, in parallel.
 *
 * `createImageBitmap` is the only decode path that works off the main thread
 * and in a worker, and it is what both backends upload from. A decode failure
 * yields `undefined` rather than rejecting: one unreadable texture should not
 * take a whole scene down with it. */
async function loadImages(document, buffers, url) {
    if (!document.images?.length)
        return [];
    if (typeof createImageBitmap !== "function")
        return document.images.map(() => undefined);
    return Promise.all(document.images.map(async (image) => {
        try {
            if (image.bufferView !== undefined) {
                const view = document.bufferViews?.[image.bufferView];
                if (!view)
                    return undefined;
                const bytes = new Uint8Array(buffers[view.buffer], view.byteOffset ?? 0, view.byteLength);
                // Copy: the blob must not alias a buffer the mesh readers still use.
                return await createImageBitmap(new Blob([bytes.slice()], { type: image.mimeType ?? "image/png" }));
            }
            if (!image.uri)
                return undefined;
            const response = await fetch(image.uri.startsWith("data:") ? image.uri : resolveSibling(image.uri, url));
            if (!response.ok)
                return undefined;
            return await createImageBitmap(await response.blob());
        }
        catch {
            return undefined;
        }
    }));
}
/** Resolve every buffer the document declares.
 *
 * `binary` is a GLB's BIN chunk, and glTF gives it exactly one place to go:
 * the first buffer, and only if that buffer has no URI. A later buffer without
 * one is a malformed document rather than a second claim on the chunk. */
async function loadBuffers(document, url, binary) {
    return Promise.all((document.buffers ?? []).map(async (buffer, index) => {
        if (!buffer.uri) {
            if (index === 0 && binary)
                return binary;
            throw new Error(index === 0
                ? `glTF buffer 0 has no URI and the file carries no BIN chunk: ${url}`
                : `glTF buffer ${index} has no URI; only buffer 0 may take the BIN chunk: ${url}`);
        }
        if (buffer.uri.startsWith("data:"))
            return decodeDataUri(buffer.uri);
        const response = await fetch(resolveSibling(buffer.uri, url));
        if (!response.ok)
            throw new Error(`glTF buffer request failed (${response.status}).`);
        return response.arrayBuffer();
    }));
}
/** Resolve a glTF's `.bin` against the document it came from. `url` is often
 * relative (`assets/level.gltf`), which is not a valid `URL` base on its own,
 * so fall back to the document's own base before giving up on a plain join. */
function resolveSibling(uri, url) {
    const base = globalThis.document?.baseURI;
    try {
        return new URL(uri, new URL(url, base)).href;
    }
    catch {
        const directory = url.slice(0, url.lastIndexOf("/") + 1);
        return `${directory}${uri}`;
    }
}
/** Read an accessor out of a parsed asset as floats, de-interleaving a strided
 * buffer view and un-normalising integer components on the way.
 *
 * The same reader the mesh path uses, exposed so an application holding a
 * `GltfAsset` can get at data of its own — collision geometry, a spline, a
 * baked lightmap's uvs — without a second implementation of glTF's component
 * types drifting away from this one. */
export function readGltfAccessor(asset, index) {
    return readAccessor(asset.document, asset.buffers, index);
}
/** The same, for an accessor being used as a triangle index list: narrowed to
 * the smallest integer array that holds it, exactly as `readPrimitive` does. */
export function readGltfIndices(asset, index) {
    return integerAccessor(asset.document, asset.buffers, index);
}
function readAccessor(document, buffers, index) {
    const accessor = document.accessors?.[index];
    if (!accessor)
        throw new Error(`glTF references missing accessor ${index}.`);
    const view = accessor.bufferView === undefined ? undefined : document.bufferViews?.[accessor.bufferView];
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
            output[row * components + component] = readComponent(data, offset, accessor.componentType, accessor.normalized === true);
        }
    }
    return output;
}
function integerAccessor(document, buffers, index) {
    const values = readAccessor(document, buffers, index);
    return values.some((value) => value > 65535)
        ? Uint32Array.from(values)
        : Uint16Array.from(values);
}
function optionalAccessor(document, buffers, index) {
    return index === undefined ? undefined : readAccessor(document, buffers, index);
}
function readComponent(data, offset, componentType, normalized) {
    const raw = componentType === 5126
        ? data.getFloat32(offset, true)
        : componentType === 5125
            ? data.getUint32(offset, true)
            : componentType === 5123
                ? data.getUint16(offset, true)
                : componentType === 5121
                    ? data.getUint8(offset)
                    : data.getInt16(offset, true);
    if (!normalized)
        return raw;
    if (componentType === 5121)
        return raw / 255;
    if (componentType === 5123)
        return raw / 65535;
    return Math.max(-1, raw / 32767);
}
function componentCount(type) {
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
function bytesPerComponent(componentType) {
    return componentType === 5126 || componentType === 5125
        ? 4
        : componentType === 5123 || componentType === 5122
            ? 2
            : 1;
}
function expandColors(values) {
    const components = values.length % 4 === 0 ? 4 : 3;
    if (components === 4)
        return values;
    const colors = new Float32Array((values.length / 3) * 4);
    for (let i = 0; i < values.length / 3; i++)
        colors.set([values[i * 3], values[i * 3 + 1], values[i * 3 + 2], 1], i * 4);
    return colors;
}
function normalizeWeights(values) {
    const weights = Float32Array.from(values);
    for (let i = 0; i < weights.length; i += 4) {
        const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] || 1;
        for (let j = 0; j < 4; j++)
            weights[i + j] /= sum;
    }
    return weights;
}
function identityMatrices(count) {
    const matrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
        matrices[i * 16] = 1;
        matrices[i * 16 + 5] = 1;
        matrices[i * 16 + 10] = 1;
        matrices[i * 16 + 15] = 1;
    }
    return matrices;
}
function decodeDataUri(uri) {
    const comma = uri.indexOf(",");
    const payload = uri.slice(comma + 1);
    if (uri.slice(0, comma).endsWith(";base64")) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
}
function vec3(value, fallback) {
    return {
        x: value?.[0] ?? fallback[0],
        y: value?.[1] ?? fallback[1],
        z: value?.[2] ?? fallback[2],
    };
}
function quat(value, fallback) {
    return {
        x: value?.[0] ?? fallback[0],
        y: value?.[1] ?? fallback[1],
        z: value?.[2] ?? fallback[2],
        w: value?.[3] ?? fallback[3],
    };
}
function required(value, label) {
    if (value === undefined)
        throw new Error(`glTF primitive is missing ${label}.`);
    return value;
}
function isNumber(value) {
    return value !== undefined;
}
