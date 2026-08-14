import { Vec3 } from "../math/vec3.js";
/** Geometry as plain typed arrays: positions and indices are required, the
 *  rest are optional and filled in with sensible defaults at upload. */
export interface MeshData {
    /** `[x, y, z]` per vertex. */
    positions: Float32Array;
    /** `[x, y, z]` per vertex, unit length. Generate with `computeNormals` when
     *  a source doesn't provide them. */
    normals?: Float32Array;
    /** `[x, y, z, w]` per vertex: the surface tangent the normal map was baked
     *  against, plus the bitangent's handedness in w (+1 or -1), exactly as
     *  glTF's `TANGENT` defines it.
     *
     *  Optional, and worth supplying whenever an authoring tool has one. Without
     *  it the backends rebuild a frame per pixel from screen-space derivatives,
     *  which needs no attribute and cannot disagree with the mesh's own uvs, but
     *  reads the frame off however the unwrap happens to be laid out locally: a
     *  uv island that changes texel density across a flat face leaves a visible
     *  step in the shading at the change. A shipped tangent is continuous across
     *  the face whatever the packing behind it does. Ignored when there is no
     *  `normalMap`. */
    tangents?: Float32Array;
    /** `[u, v]` per vertex. `v = 0` is the TOP of a texture, as in glTF and as
     *  `drawImage` sees an image — not OpenGL's bottom-up convention. Both
     *  backends upload an image's first row at v = 0, so this needs no flip
     *  anywhere; see the note at the top of `webgl2.ts`. */
    uvs?: Float32Array;
    /** A SECOND `[u, v]` per vertex, same convention as `uvs`.
     *
     *  One unwrap rarely serves two purposes. A surface texture wants islands
     *  packed tightly into an atlas, wherever they land and at whatever
     *  orientation; a detail overlay wants a layout that follows the shape — up
     *  the face, around the barrel — because the pattern's direction is the
     *  point of it. Authoring tools solve that by shipping both, and glTF's
     *  `texCoord: 1` on a texture reference is how a document says which one a
     *  given map reads. Only `Material.detailUv` selects it here; there is no
     *  second set for the base colour or the normal map, because nothing has
     *  needed one and an unused attribute is still a buffer per mesh. */
    uvs1?: Float32Array;
    /** `[r, g, b, a]` per vertex, 0..1. Multiplied with the material colour. */
    colors?: Float32Array;
    /** Four joint indices per vertex, used by a glTF-style skin. */
    joints?: Uint16Array;
    /** Four normalized joint weights per vertex. Each group of four should sum
     *  to one; loaders normalize them so authored files do not have to be
     *  perfect. */
    weights?: Float32Array;
    /** Indices into the vertex arrays. Three per face for `"triangles"`, two per
     *  segment for `"lines"` — see `topology`. Triangles are counter-clockwise
     *  when seen from the front. */
    indices: Uint16Array | Uint32Array;
    /** Bump this whenever the vertex or index DATA changes in place.
     *
     *  Meshes are cached against the `MeshData` object's identity, so a mesh
     *  whose arrays are rewritten looks unchanged to a backend and would keep
     *  drawing its first upload forever. That is exactly what a mesh rebuilt
     *  every frame is — a particle batch, a stroked path, a deforming ribbon —
     *  and for those this is the difference between animation and a still.
     *
     *  Leave it undefined for geometry that never changes and the upload happens
     *  once. Changing the ARRAY LENGTHS is allowed too, but reallocates rather
     *  than rewriting, so a batch that varies in size is cheapest kept at a
     *  fixed capacity with the unused tail degenerate. */
    version?: number;
    /** What the indices describe. `"triangles"` (the default) is surfaces;
     *  `"lines"` is a list of independent segments, two indices each.
     *
     *  Lines are for geometry that is a READOUT rather than a surface — a
     *  collider outline, a path, a grid, an axis gizmo, a normal. Nothing is
     *  filled, so nothing occludes what you are trying to see through it, which
     *  is the whole reason to reach for them. Pair them with `unlit` on the
     *  material: a segment has no facing and lighting it is meaningless.
     *
     *  Both backends draw a segment one pixel wide. That is a hardware floor, not
     *  a policy — WebGPU has no line width at all and WebGL2 drivers almost
     *  universally clamp `lineWidth` to 1 — so a thick line has to be built out
     *  of triangles instead. */
    topology?: "triangles" | "lines";
}
/** Whether a mesh carries the attributes needed for GPU skinning. */
export declare function isSkinned(mesh: MeshData): boolean;
/** Number of vertices in a mesh. */
export declare function vertexCount(mesh: MeshData): number;
/** Number of triangles in a mesh. A line mesh has none, and reporting its
 *  segments as thirds of triangles would only corrupt the frame stats. */
export declare function triangleCount(mesh: MeshData): number;
/** Area-weighted smooth vertex normals, computed in place and returned. Shared
 *  vertices average their faces, so this produces a SMOOTH shading result — a
 *  cube built with shared corners comes out looking like a ball. Primitives
 *  that need hard edges duplicate their vertices per face instead, which is
 *  what `box` below does. */
export declare function computeNormals(mesh: MeshData): MeshData;
/** Reverse triangle winding and flip the normals — turns a mesh authored for
 *  clockwise-front inside out, and is also how you make a skybox out of an
 *  ordinary box. */
export declare function flipWinding(mesh: MeshData): MeshData;
/** The edges of a triangle mesh as a line mesh — every triangle's three sides,
 *  each drawn once no matter how many faces share it.
 *
 *  This is how you SEE geometry that is otherwise invisible or in the way: a
 *  collider that has no renderable of its own, a level's collision hull over
 *  the art it is supposed to match, a mesh whose winding you suspect. Nothing
 *  is filled, so the thing behind it stays readable, which is the entire point.
 *
 *  Only positions carry over. Normals and uvs describe a surface and there is
 *  no surface left, so pair the result with an `unlit` material. Vertices are
 *  shared with the source mesh's own numbering rather than re-welded, so a mesh
 *  with split vertices — a hard-edged box, say — draws each seam once per copy
 *  of it. That is a faithful picture of what the mesh actually is. */
export declare function wireframe(mesh: MeshData): MeshData;
/** The axis-aligned bounds of a mesh, as `min`/`max` corners. Used to frame a
 *  camera on an unfamiliar model — see `Camera3D.frame`. */
export declare function bounds(mesh: MeshData): {
    min: Vec3;
    max: Vec3;
};
/** Concatenate meshes into one, offsetting indices. Fewer draw calls for
 *  static geometry that shares a material. Attributes present in ANY input are
 *  present in the output; inputs missing one contribute a default (an up
 *  normal, a zero uv, opaque white). */
export declare function mergeMeshes(meshes: readonly MeshData[]): MeshData;
/** A box with HARD edges: each face has its own four vertices so the normals
 *  are per-face and the corners stay crisp. 24 vertices, 12 triangles. */
export declare function box(width?: number, height?: number, depth?: number): MeshData;
/** A UV sphere. `segments` divides the equator, `rings` the pole-to-pole arc;
 *  the defaults look smooth at preview sizes without wasting vertices. */
export declare function sphere(radius?: number, segments?: number, rings?: number): MeshData;
/** A flat plane in the XZ ground plane, facing +Y. `subdivisions` adds
 *  interior vertices, which matters only if something displaces them. */
export declare function plane(width?: number, depth?: number, subdivisions?: number): MeshData;
/** A cylinder along Y, optionally capped. A `topRadius` of 0 gives a cone. */
export declare function cylinder(radius?: number, height?: number, segments?: number, topRadius?: number, capped?: boolean): MeshData;
/** A torus in the XZ plane. `radius` is to the centre of the tube. */
export declare function torus(radius?: number, tube?: number, segments?: number, tubeSegments?: number): MeshData;
