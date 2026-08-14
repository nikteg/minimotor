import { type Scene3D } from "./scene.js";
import { type Clip } from "./animation.js";
/** The parts of the glTF document this loader reads.
 *
 * Exported because a caller that keeps a `GltfAsset` around — to read its own
 * data out of the same file rather than fetch it twice — needs to be able to
 * say what it is holding. It is not a complete glTF 2.0 typing and does not
 * try to be: fields nothing here consumes are simply absent. */
export interface GltfDocument {
    asset?: {
        version?: string;
        generator?: string;
    };
    scene?: number;
    scenes?: {
        nodes?: number[];
    }[];
    nodes?: GltfNode[];
    meshes?: {
        primitives?: GltfPrimitive[];
    }[];
    materials?: GltfMaterial[];
    images?: {
        uri?: string;
        bufferView?: number;
        mimeType?: string;
    }[];
    textures?: {
        source?: number;
        sampler?: number;
    }[];
    samplers?: {
        magFilter?: number;
        wrapS?: number;
        wrapT?: number;
    }[];
    skins?: {
        joints: number[];
        inverseBindMatrices?: number;
    }[];
    animations?: GltfAnimation[];
    buffers?: {
        uri?: string;
        byteLength: number;
    }[];
    bufferViews?: {
        buffer: number;
        byteOffset?: number;
        byteLength: number;
        byteStride?: number;
    }[];
    accessors?: GltfAccessor[];
    /** Root extension objects, untouched. This loader implements none of them at
     * the root — it reads `KHR_texture_transform` where it appears on a texture
     * reference and nothing else — and carries the rest so an application that
     * owns an extension of its own can read it off the parsed document instead
     * of fetching and parsing the file a second time. */
    extensions?: Record<string, unknown>;
    extensionsUsed?: string[];
    extensionsRequired?: string[];
}
/** A glTF texture reference, plus the `KHR_texture_transform` scale and offset
 *  that a tiling detail map needs. Rotation is not supported: the renderer's
 *  uv transform is a scale and an offset, and a rotated tiling map is rare
 *  enough that silently ignoring the angle would be worse than not reading it. */
interface GltfTextureRef {
    index?: number;
    scale?: number;
    /** Which uv set the map reads. Only the detail map acts on this; everything
     *  else in this loader is TEXCOORD_0 whatever the document says, because
     *  nothing has needed otherwise. */
    texCoord?: number;
    extensions?: {
        KHR_texture_transform?: {
            offset?: number[];
            scale?: number[];
        };
    };
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
     *  cannot express: `uvProjection`, `textureBlend`, `rimAlpha`, `specular` —
     *  the dielectric reflectance, which core metallic-roughness simply has no
     *  field for — and the overlay detail map, which no ratified extension
     *  covers either. `detailTexture` is an ordinary texture reference so it can
     *  carry `texCoord: 1` the way the rest of the format does. */
    extras?: {
        uvProjection?: string;
        textureBlend?: string;
        rimAlpha?: number[];
        specular?: number;
        detailTexture?: GltfTextureRef;
        detailStrength?: number;
        detailBlend?: string;
        detailColorScale?: number;
        detailUvProjection?: string;
        detailUvScale?: number[];
        detailUvOffset?: number[];
        detailMaskTexture?: GltfTextureRef;
        detailMaskUvScale?: number[];
        detailMaskUvOffset?: number[];
    };
}
export interface GltfNode {
    name?: string;
    mesh?: number;
    skin?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    /** glTF's other way of writing a local transform. Declared so a caller can
     * SEE one; this loader does not implement it and builds every node from
     * translation/rotation/scale, so a document that uses `matrix` loads at the
     * identity. Nothing this engine exports writes one. */
    matrix?: number[];
    /** Whatever the exporter needed to say and glTF has no field for. Carried
     *  through untouched — see `LoadedGltf.extras`. */
    extras?: Record<string, unknown>;
}
export interface GltfPrimitive {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
}
export interface GltfAccessor {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
}
interface GltfAnimation {
    name?: string;
    samplers: {
        input: number;
        output: number;
        interpolation?: string;
    }[];
    channels: {
        sampler: number;
        target: {
            node: number;
            path: string;
        };
    }[];
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
/** A glTF file, fetched and parsed, but not yet made into anything.
 *
 * The two halves of loading are genuinely separate jobs. Getting to this — the
 * document and the bytes its accessors index into — is all a caller needs to
 * read its own data out of a file; building a scene graph, decoding images and
 * compiling animation is the other half, and an application that only wants
 * the first should not have to pay for the second or fetch the file twice to
 * avoid it. */
export interface GltfAsset {
    document: GltfDocument;
    /** One entry per `document.buffers`, in order. A GLB's BIN chunk is buffer
     * 0, matching the specification's rule that only the first buffer may omit
     * its URI. */
    buffers: ArrayBuffer[];
    /** What relative URIs inside the document resolve against — the URL the
     * asset itself came from. */
    baseUrl: string;
}
/** Fetch and parse a glTF or GLB file, resolving its buffers.
 *
 * The container is decided by the first four bytes and not by the URL: a GLB
 * served as `.gltf`, or from a blob or a URL with no filename at all, is still
 * a GLB. */
export declare function loadGltfAsset(url: string): Promise<GltfAsset>;
/** Parse glTF or GLB bytes that are already in hand.
 *
 * `url` is what relative buffer and image URIs resolve against, and what names
 * the file in any error; bytes with no URL of their own can pass anything that
 * locates their siblings. */
export declare function parseGltfAsset(bytes: ArrayBuffer, url: string): Promise<GltfAsset>;
/** Load the useful, renderer-facing part of a glTF 2.0 file: geometry,
 * hierarchy, skins, transform animation, materials and their base-colour and
 * normal textures.
 *
 * An image that fails to decode is skipped rather than failing the load — a
 * missing texture should cost you a texture, not the whole scene. */
export declare function loadGltf(url: string): Promise<LoadedGltf>;
/** Build the render scene, materials, images and animation clips out of an
 * asset that has already been fetched and parsed. */
export declare function instantiateGltf(asset: GltfAsset): Promise<LoadedGltf>;
/** Read an accessor out of a parsed asset as floats, de-interleaving a strided
 * buffer view and un-normalising integer components on the way.
 *
 * The same reader the mesh path uses, exposed so an application holding a
 * `GltfAsset` can get at data of its own — collision geometry, a spline, a
 * baked lightmap's uvs — without a second implementation of glTF's component
 * types drifting away from this one. */
export declare function readGltfAccessor(asset: GltfAsset, index: number): Float32Array;
/** The same, for an accessor being used as a triangle index list: narrowed to
 * the smallest integer array that holds it, exactly as `readPrimitive` does. */
export declare function readGltfIndices(asset: GltfAsset, index: number): Uint16Array | Uint32Array;
export {};
