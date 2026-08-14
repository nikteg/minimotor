// ---------- Wavefront OBJ importer ----------
// OBJ is deliberately parsed into the renderer's plain MeshData shape. The
// asset store can therefore load a model once, while WebGL2/WebGPU remain
// unaware of where its typed arrays came from.
import { computeNormals } from "./mesh.js";
/** Parse a Wavefront OBJ text into a triangulated MeshData.
 *
 * Supports positions (`v`), texture coordinates (`vt`), normals (`vn`),
 * positive and negative indices, and polygon faces (`f`). Objects, groups,
 * smoothing/material declarations and MTL references are accepted and ignored;
 * one OBJ file becomes one merged mesh with one material supplied by the
 * caller. Missing normals are generated from the resulting triangles. */
export function parseObj(source, options = {}) {
    const sourcePositions = [];
    const sourceUvs = [];
    const sourceNormals = [];
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    const vertexByKey = new Map();
    let hasUvs = false;
    let hasNormals = false;
    let missingNormals = false;
    const resolveIndex = (value, count, kind, line) => {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed === 0) {
            throw new Error(`OBJ line ${line}: invalid ${kind} index "${value}"`);
        }
        const index = parsed > 0 ? parsed - 1 : count + parsed;
        if (index < 0 || index >= count) {
            throw new Error(`OBJ line ${line}: ${kind} index "${value}" is out of range`);
        }
        return index;
    };
    const vertexFor = (token, line) => {
        const cached = vertexByKey.get(token);
        if (cached !== undefined)
            return cached;
        const parts = token.split("/");
        if (parts.length > 3 || !parts[0]) {
            throw new Error(`OBJ line ${line}: invalid face vertex "${token}"`);
        }
        const positionIndex = resolveIndex(parts[0], sourcePositions.length, "position", line);
        const uvIndex = parts[1] ? resolveIndex(parts[1], sourceUvs.length, "UV", line) : undefined;
        const normalIndex = parts[2]
            ? resolveIndex(parts[2], sourceNormals.length, "normal", line)
            : undefined;
        const position = sourcePositions[positionIndex];
        positions.push(position[0], position[1], position[2]);
        if (uvIndex !== undefined) {
            const uv = sourceUvs[uvIndex];
            uvs.push(uv[0], options.flipV === false ? uv[1] : 1 - uv[1]);
            hasUvs = true;
        }
        else {
            uvs.push(0, 0);
        }
        if (normalIndex !== undefined) {
            const normal = sourceNormals[normalIndex];
            normals.push(normal[0], normal[1], normal[2]);
            hasNormals = true;
        }
        else {
            normals.push(0, 0, 0);
            missingNormals = true;
        }
        const index = positions.length / 3 - 1;
        vertexByKey.set(token, index);
        return index;
    };
    source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
        const lineNumber = lineIndex + 1;
        const comment = rawLine.indexOf("#");
        const line = (comment < 0 ? rawLine : rawLine.slice(0, comment)).trim();
        if (!line)
            return;
        const parts = line.split(/\s+/);
        const command = parts.shift();
        if (!command)
            return;
        switch (command) {
            case "v": {
                if (parts.length < 3)
                    throw new Error(`OBJ line ${lineNumber}: vertex needs x y z`);
                sourcePositions.push([Number(parts[0]), Number(parts[1]), Number(parts[2])]);
                break;
            }
            case "vt": {
                if (parts.length < 1)
                    throw new Error(`OBJ line ${lineNumber}: UV needs u`);
                sourceUvs.push([Number(parts[0]), Number(parts[1] ?? 0)]);
                break;
            }
            case "vn": {
                if (parts.length < 3)
                    throw new Error(`OBJ line ${lineNumber}: normal needs x y z`);
                sourceNormals.push([Number(parts[0]), Number(parts[1]), Number(parts[2])]);
                break;
            }
            case "f": {
                if (parts.length < 3)
                    throw new Error(`OBJ line ${lineNumber}: face needs at least 3 vertices`);
                const face = parts.map((token) => vertexFor(token, lineNumber));
                for (let i = 1; i < face.length - 1; i++) {
                    indices.push(face[0], face[i], face[i + 1]);
                }
                break;
            }
            // Geometry declarations that need no MeshData representation here.
            case "o":
            case "g":
            case "s":
            case "usemtl":
            case "mtllib":
            case "vp":
                break;
            default:
                // Be liberal with exporter-specific extensions. Unknown records do
                // not affect the geometry we can represent.
                break;
        }
    });
    if (indices.length === 0)
        throw new Error("OBJ contains no faces");
    const mesh = {
        positions: new Float32Array(positions),
        indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    };
    if (hasUvs)
        mesh.uvs = new Float32Array(uvs);
    if (hasNormals && !missingNormals)
        mesh.normals = new Float32Array(normals);
    else
        computeNormals(mesh);
    return mesh;
}
