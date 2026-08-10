// ---------- Mesh data ----------
// Plain typed arrays, no GPU objects. A `MeshData` is what a loader produces
// and what a `Renderer3D` uploads; it can be built, inspected and unit-tested
// with no canvas in sight, which is the whole reason this file has no imports
// from the backends.
//
// Attribute layout is SEPARATE arrays here and interleaved at upload time. The
// GPU wants one interleaved buffer, but authoring code wants named arrays, and
// the conversion is a one-off cost paid when the mesh is created rather than
// per frame.
//
// Winding is COUNTER-CLOCKWISE for a front face, matching glTF and the WebGL
// default. Backface culling is on by default, so a mesh built with the opposite
// winding renders inside-out — visible as a shape that looks hollow, or that
// disappears when it should be nearest. `flipWinding` is here for exactly that.

import { Vec3 } from "@src/math/vec3.js";

/** Geometry as plain typed arrays: positions and indices are required, the
 *  rest are optional and filled in with sensible defaults at upload. */
export interface MeshData {
  /** `[x, y, z]` per vertex. */
  positions: Float32Array;
  /** `[x, y, z]` per vertex, unit length. Generate with `computeNormals` when
   *  a source doesn't provide them. */
  normals?: Float32Array;
  /** `[u, v]` per vertex. `v = 0` is the TOP of a texture, as in glTF and as
   *  `drawImage` sees an image — not OpenGL's bottom-up convention. Both
   *  backends upload an image's first row at v = 0, so this needs no flip
   *  anywhere; see the note at the top of `webgl2.ts`. */
  uvs?: Float32Array;
  /** `[r, g, b, a]` per vertex, 0..1. Multiplied with the material colour. */
  colors?: Float32Array;
  /** Four joint indices per vertex, used by a glTF-style skin. */
  joints?: Uint16Array;
  /** Four normalized joint weights per vertex. Each group of four should sum
   *  to one; loaders normalize them so authored files do not have to be
   *  perfect. */
  weights?: Float32Array;
  /** Triangle indices, three per face, counter-clockwise when seen from the
   *  front. */
  indices: Uint16Array | Uint32Array;
}

/** Whether a mesh carries the attributes needed for GPU skinning. */
export function isSkinned(mesh: MeshData): boolean {
  return mesh.joints !== undefined && mesh.weights !== undefined;
}

/** Number of vertices in a mesh. */
export function vertexCount(mesh: MeshData): number {
  return mesh.positions.length / 3;
}

/** Number of triangles in a mesh. */
export function triangleCount(mesh: MeshData): number {
  return mesh.indices.length / 3;
}

/** Area-weighted smooth vertex normals, computed in place and returned. Shared
 *  vertices average their faces, so this produces a SMOOTH shading result — a
 *  cube built with shared corners comes out looking like a ball. Primitives
 *  that need hard edges duplicate their vertices per face instead, which is
 *  what `box` below does. */
export function computeNormals(mesh: MeshData): MeshData {
  const n = vertexCount(mesh);
  const normals = mesh.normals?.length === n * 3 ? mesh.normals : new Float32Array(n * 3);
  normals.fill(0);
  const p = mesh.positions;
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const abx = p[b] - p[a];
    const aby = p[b + 1] - p[a + 1];
    const abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a];
    const acy = p[c + 1] - p[a + 1];
    const acz = p[c + 2] - p[a + 2];
    // The cross product's LENGTH is twice the triangle's area, so accumulating
    // it unnormalized weights each face by its size — a large face should
    // influence a shared vertex more than a sliver does.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (l === 0) {
      // A degenerate vertex (unreferenced, or on zero-area faces only) would
      // otherwise become NaN and blacken every pixel that touches it.
      normals[i + 1] = 1;
      continue;
    }
    normals[i] /= l;
    normals[i + 1] /= l;
    normals[i + 2] /= l;
  }
  mesh.normals = normals;
  return mesh;
}

/** Reverse triangle winding and flip the normals — turns a mesh authored for
 *  clockwise-front inside out, and is also how you make a skybox out of an
 *  ordinary box. */
export function flipWinding(mesh: MeshData): MeshData {
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  if (mesh.normals)
    for (let i = 0; i < mesh.normals.length; i++) mesh.normals[i] = -mesh.normals[i];
  return mesh;
}

/** The axis-aligned bounds of a mesh, as `min`/`max` corners. Used to frame a
 *  camera on an unfamiliar model — see `Camera3D.frame`. */
export function bounds(mesh: MeshData): { min: Vec3; max: Vec3 } {
  const p = mesh.positions;
  if (p.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    min.x = Math.min(min.x, p[i]);
    min.y = Math.min(min.y, p[i + 1]);
    min.z = Math.min(min.z, p[i + 2]);
    max.x = Math.max(max.x, p[i]);
    max.y = Math.max(max.y, p[i + 1]);
    max.z = Math.max(max.z, p[i + 2]);
  }
  return { min, max };
}

/** Concatenate meshes into one, offsetting indices. Fewer draw calls for
 *  static geometry that shares a material. Attributes present in ANY input are
 *  present in the output; inputs missing one contribute a default (an up
 *  normal, a zero uv, opaque white). */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const verts = meshes.reduce((n, m) => n + vertexCount(m), 0);
  const tris = meshes.reduce((n, m) => n + triangleCount(m), 0);
  const anyNormals = meshes.some((m) => m.normals);
  const anyUvs = meshes.some((m) => m.uvs);
  const anyColors = meshes.some((m) => m.colors);

  const out: MeshData = {
    positions: new Float32Array(verts * 3),
    indices: verts > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3),
  };
  if (anyNormals) out.normals = new Float32Array(verts * 3);
  if (anyUvs) out.uvs = new Float32Array(verts * 2);
  if (anyColors) out.colors = new Float32Array(verts * 4);

  let v = 0;
  let i = 0;
  for (const m of meshes) {
    const n = vertexCount(m);
    out.positions.set(m.positions, v * 3);
    if (out.normals) {
      if (m.normals) out.normals.set(m.normals, v * 3);
      else for (let k = 0; k < n; k++) out.normals[(v + k) * 3 + 1] = 1;
    }
    if (out.uvs && m.uvs) out.uvs.set(m.uvs, v * 2);
    if (out.colors) {
      if (m.colors) out.colors.set(m.colors, v * 4);
      else out.colors.fill(1, v * 4, (v + n) * 4);
    }
    for (let k = 0; k < m.indices.length; k++) out.indices[i + k] = m.indices[k] + v;
    v += n;
    i += m.indices.length;
  }
  return out;
}

// ---------- Primitives ----------
// Every one is centred on the origin and sized in world units, so a node's
// scale reads as a multiplier rather than a correction.

/** A box with HARD edges: each face has its own four vertices so the normals
 *  are per-face and the corners stay crisp. 24 vertices, 12 triangles. */
export function box(width = 1, height = width, depth = width): MeshData {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  // Per face: normal, then four corners counter-clockwise seen from outside.
  const faces: [Vec3, number[][]][] = [
    [
      { x: 0, y: 0, z: 1 },
      [
        [-x, -y, z],
        [x, -y, z],
        [x, y, z],
        [-x, y, z],
      ],
    ], // +Z
    [
      { x: 0, y: 0, z: -1 },
      [
        [x, -y, -z],
        [-x, -y, -z],
        [-x, y, -z],
        [x, y, -z],
      ],
    ], // −Z
    [
      { x: 1, y: 0, z: 0 },
      [
        [x, -y, z],
        [x, -y, -z],
        [x, y, -z],
        [x, y, z],
      ],
    ], // +X
    [
      { x: -1, y: 0, z: 0 },
      [
        [-x, -y, -z],
        [-x, -y, z],
        [-x, y, z],
        [-x, y, -z],
      ],
    ], // −X
    [
      { x: 0, y: 1, z: 0 },
      [
        [-x, y, z],
        [x, y, z],
        [x, y, -z],
        [-x, y, -z],
      ],
    ], // +Y
    [
      { x: 0, y: -1, z: 0 },
      [
        [-x, -y, -z],
        [x, -y, -z],
        [x, -y, z],
        [-x, -y, z],
      ],
    ], // −Y
  ];

  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const uvs = new Float32Array(24 * 2);
  const indices = new Uint16Array(36);
  const uvCorners = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  faces.forEach(([n, corners], f) => {
    corners.forEach((c, k) => {
      const v = f * 4 + k;
      positions.set(c, v * 3);
      normals.set([n.x, n.y, n.z], v * 3);
      uvs.set(uvCorners[k], v * 2);
    });
    const base = f * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], f * 6);
  });
  return { positions, normals, uvs, indices };
}

/** A UV sphere. `segments` divides the equator, `rings` the pole-to-pole arc;
 *  the defaults look smooth at preview sizes without wasting vertices. */
export function sphere(radius = 0.5, segments = 24, rings = 16): MeshData {
  const cols = Math.max(3, Math.floor(segments));
  const rows = Math.max(2, Math.floor(rings));
  const verts = (cols + 1) * (rows + 1);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint16Array(cols * rows * 6);

  let v = 0;
  for (let r = 0; r <= rows; r++) {
    const phi = (r / rows) * Math.PI; // 0 at the north pole
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let c = 0; c <= cols; c++) {
      // The seam column is duplicated (c === cols repeats c === 0) so the u
      // coordinate can reach 1 instead of wrapping to 0 mid-triangle.
      const theta = (c / cols) * Math.PI * 2;
      const nx = sp * Math.sin(theta);
      const ny = cp;
      const nz = sp * Math.cos(theta);
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      positions[v * 3] = nx * radius;
      positions[v * 3 + 1] = ny * radius;
      positions[v * 3 + 2] = nz * radius;
      uvs[v * 2] = c / cols;
      uvs[v * 2 + 1] = r / rows;
      v++;
    }
  }
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      indices.set([a, b, a + 1, a + 1, b, b + 1], i);
      i += 6;
    }
  }
  return { positions, normals, uvs, indices };
}

/** A flat plane in the XZ ground plane, facing +Y. `subdivisions` adds
 *  interior vertices, which matters only if something displaces them. */
export function plane(width = 1, depth = width, subdivisions = 1): MeshData {
  const n = Math.max(1, Math.floor(subdivisions));
  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint16Array(n * n * 6);
  let v = 0;
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) {
      positions[v * 3] = (c / n - 0.5) * width;
      positions[v * 3 + 1] = 0;
      positions[v * 3 + 2] = (r / n - 0.5) * depth;
      normals[v * 3 + 1] = 1;
      uvs[v * 2] = c / n;
      uvs[v * 2 + 1] = r / n;
      v++;
    }
  }
  let i = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * (n + 1) + c;
      const b = a + n + 1;
      // Counter-clockwise seen from +Y (above), which is where the normal
      // points.
      indices.set([a, b, a + 1, a + 1, b, b + 1], i);
      i += 6;
    }
  }
  return { positions, normals, uvs, indices };
}

/** A cylinder along Y, optionally capped. A `topRadius` of 0 gives a cone. */
export function cylinder(
  radius = 0.5,
  height = 1,
  segments = 24,
  topRadius = radius,
  capped = true,
): MeshData {
  const cols = Math.max(3, Math.floor(segments));
  const y = height / 2;
  const parts: MeshData[] = [];

  // Side: a ring at each end, seam duplicated as in `sphere`.
  const sideVerts = (cols + 1) * 2;
  const positions = new Float32Array(sideVerts * 3);
  const normals = new Float32Array(sideVerts * 3);
  const uvs = new Float32Array(sideVerts * 2);
  const indices = new Uint16Array(cols * 6);
  // The side normal tilts with the slope; a cone's normals are NOT horizontal,
  // and getting this wrong is the classic "cone lit like a cylinder" look.
  const slope = (radius - topRadius) / height;
  const nl = Math.hypot(1, slope);
  for (let c = 0; c <= cols; c++) {
    const theta = (c / cols) * Math.PI * 2;
    const sx = Math.sin(theta);
    const sz = Math.cos(theta);
    for (const [k, r, py] of [
      [0, radius, -y],
      [1, topRadius, y],
    ] as const) {
      const v = c * 2 + k;
      positions[v * 3] = sx * r;
      positions[v * 3 + 1] = py;
      positions[v * 3 + 2] = sz * r;
      normals[v * 3] = (sx * 1) / nl;
      normals[v * 3 + 1] = slope / nl;
      normals[v * 3 + 2] = (sz * 1) / nl;
      uvs[v * 2] = c / cols;
      uvs[v * 2 + 1] = 1 - k;
    }
  }
  for (let c = 0; c < cols; c++) {
    const a = c * 2;
    indices.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], c * 6);
  }
  parts.push({ positions, normals, uvs, indices });

  if (capped) {
    for (const [r, py, up] of [
      [topRadius, y, 1],
      [radius, -y, -1],
    ] as const) {
      if (r === 0) continue; // a cone tip needs no cap
      const cap = disc(r, cols, py, up);
      parts.push(cap);
    }
  }
  return parts.length === 1 ? parts[0] : mergeMeshes(parts);
}

/** A filled circle in the XZ plane at height `py`, facing ±Y. */
function disc(radius: number, segments: number, py: number, up: 1 | -1): MeshData {
  const positions = new Float32Array((segments + 1) * 3);
  const normals = new Float32Array((segments + 1) * 3);
  const uvs = new Float32Array((segments + 1) * 2);
  const indices = new Uint16Array(segments * 3);
  positions[1] = py;
  normals[1] = up;
  uvs[0] = 0.5;
  uvs[1] = 0.5;
  for (let c = 0; c < segments; c++) {
    const theta = (c / segments) * Math.PI * 2;
    const v = c + 1;
    const sx = Math.sin(theta);
    const sz = Math.cos(theta);
    positions[v * 3] = sx * radius;
    positions[v * 3 + 1] = py;
    positions[v * 3 + 2] = sz * radius;
    normals[v * 3 + 1] = up;
    uvs[v * 2] = sx * 0.5 + 0.5;
    uvs[v * 2 + 1] = sz * 0.5 + 0.5;
    // Winding flips with the facing, or the bottom cap is culled away.
    const next = ((c + 1) % segments) + 1;
    if (up === 1) indices.set([0, v, next], c * 3);
    else indices.set([0, next, v], c * 3);
  }
  return { positions, normals, uvs, indices };
}

/** A torus in the XZ plane. `radius` is to the centre of the tube. */
export function torus(radius = 0.4, tube = 0.15, segments = 32, tubeSegments = 16): MeshData {
  const cols = Math.max(3, Math.floor(segments));
  const rows = Math.max(3, Math.floor(tubeSegments));
  const verts = (cols + 1) * (rows + 1);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint16Array(cols * rows * 6);
  let v = 0;
  for (let c = 0; c <= cols; c++) {
    const u = (c / cols) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let r = 0; r <= rows; r++) {
      const t = (r / rows) * Math.PI * 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      positions[v * 3] = (radius + tube * ct) * cu;
      positions[v * 3 + 1] = tube * st;
      positions[v * 3 + 2] = (radius + tube * ct) * su;
      normals[v * 3] = ct * cu;
      normals[v * 3 + 1] = st;
      normals[v * 3 + 2] = ct * su;
      uvs[v * 2] = c / cols;
      uvs[v * 2 + 1] = r / rows;
      v++;
    }
  }
  let i = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = c * (rows + 1) + r;
      const b = a + rows + 1;
      // Note the winding is the MIRROR of `sphere`'s: there the +1 step walks
      // the ring and `b` steps down a row, here +1 walks the tube and `b`
      // steps around the ring. Same index pattern, opposite handedness — which
      // is exactly how this shipped inside-out the first time.
      indices.set([a, a + 1, b, a + 1, b + 1, b], i);
      i += 6;
    }
  }
  return { positions, normals, uvs, indices };
}
