import type { MeshData } from "./mesh.js";
/** OBJ import options. */
export interface ObjOptions {
    /** Flip the conventional OBJ bottom-up texture V coordinate. Default true. */
    flipV?: boolean;
}
/** Parse a Wavefront OBJ text into a triangulated MeshData.
 *
 * Supports positions (`v`), texture coordinates (`vt`), normals (`vn`),
 * positive and negative indices, and polygon faces (`f`). Objects, groups,
 * smoothing/material declarations and MTL references are accepted and ignored;
 * one OBJ file becomes one merged mesh with one material supplied by the
 * caller. Missing normals are generated from the resulting triangles. */
export declare function parseObj(source: string, options?: ObjOptions): MeshData;
