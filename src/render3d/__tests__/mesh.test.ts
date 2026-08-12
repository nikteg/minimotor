import { describe, expect, it } from "vitest";
import {
  bounds,
  box,
  computeNormals,
  cylinder,
  flipWinding,
  mergeMeshes,
  plane,
  sphere,
  torus,
  triangleCount,
  vertexCount,
  wireframe,
} from "../mesh.js";
import type { MeshData } from "../mesh.js";

/** Every triangle's geometric normal, as unit vectors. */
function faceNormals(mesh: MeshData): { x: number; y: number; z: number }[] {
  const p = mesh.positions;
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3;
    const b = mesh.indices[i + 1] * 3;
    const c = mesh.indices[i + 2] * 3;
    const abx = p[b] - p[a],
      aby = p[b + 1] - p[a + 1],
      abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a],
      acy = p[c + 1] - p[a + 1],
      acz = p[c + 2] - p[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.push({ x: nx / l, y: ny / l, z: nz / l });
  }
  return out;
}

/** The centroid of triangle `t`. */
function centroid(mesh: MeshData, t: number): { x: number; y: number; z: number } {
  const p = mesh.positions;
  const c = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < 3; k++) {
    const v = mesh.indices[t * 3 + k] * 3;
    c.x += p[v] / 3;
    c.y += p[v + 1] / 3;
    c.z += p[v + 2] / 3;
  }
  return c;
}

/** Twice the area of triangle `t` — the length of the un-normalized cross
 *  product. Zero at a UV sphere's poles and a cone's tip, where a whole ring
 *  of vertices collapses onto one point. */
function doubleArea(mesh: MeshData, t: number): number {
  const p = mesh.positions;
  const a = mesh.indices[t * 3] * 3;
  const b = mesh.indices[t * 3 + 1] * 3;
  const c = mesh.indices[t * 3 + 2] * 3;
  const abx = p[b] - p[a],
    aby = p[b + 1] - p[a + 1],
    abz = p[b + 2] - p[a + 2];
  const acx = p[c] - p[a],
    acy = p[c + 1] - p[a + 1],
    acz = p[c + 2] - p[a + 2];
  return Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
}

/** For a mesh enclosing a known interior, a counter-clockwise-wound front face
 *  has its geometric normal pointing AWAY from the interior. That one property
 *  catches an inside-out primitive with no reference data to compare against.
 *
 *  `interior` maps a face's centroid to the enclosed point it should face away
 *  from — the origin for a star-shaped solid, but NOT for a torus, whose inner
 *  wall correctly faces toward the origin. Judging a torus against the origin
 *  passes a broken mesh and fails a correct one, in equal measure.
 *
 *  Degenerate faces are skipped: a UV sphere's pole ring and a cone's tip are
 *  zero-area triangles with no meaningful normal. */
function windingIsOutward(
  mesh: MeshData,
  interior: (c: { x: number; y: number; z: number }) => {
    x: number;
    y: number;
    z: number;
  } = () => ({
    x: 0,
    y: 0,
    z: 0,
  }),
): boolean {
  const normals = faceNormals(mesh);
  return normals.every((n, t) => {
    if (doubleArea(mesh, t) < 1e-9) return true;
    const c = centroid(mesh, t);
    const from = interior(c);
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const dz = c.z - from.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return true; // a face through the reference point says nothing
    return (n.x * dx + n.y * dy + n.z * dz) / l > 0;
  });
}

/** The nearest point on a torus's tube centre ring — the interior a torus face
 *  actually encloses. */
function tubeCentre(radius: number) {
  return (c: { x: number; y: number; z: number }) => {
    const l = Math.hypot(c.x, c.z) || 1;
    return { x: (c.x / l) * radius, y: 0, z: (c.z / l) * radius };
  };
}

describe("primitives are wound counter-clockwise (outward-facing)", () => {
  // A backwards winding renders the whole mesh inside-out under backface
  // culling, and looks like a lighting bug rather than a geometry one.
  it.each([
    ["box", box(1)],
    ["sphere", sphere(0.5, 12, 8)],
    ["cylinder", cylinder(0.5, 1, 12)],
    ["cone", cylinder(0.5, 1, 12, 0)],
  ])("%s", (_name, mesh) => {
    expect(windingIsOutward(mesh)).toBe(true);
  });

  it("torus", () => {
    // Judged against the tube's centre ring, not the origin — see
    // `windingIsOutward`. This shipped inside-out first time round: the index
    // pattern was copied from `sphere`, where the same two steps run the other
    // way, so it mirrored the handedness.
    expect(windingIsOutward(torus(0.4, 0.15, 12, 8), tubeCentre(0.4))).toBe(true);
  });

  it("flipWinding reverses it", () => {
    const b = box(1);
    expect(windingIsOutward(b)).toBe(true);
    expect(windingIsOutward(flipWinding(b))).toBe(false);
  });

  it("flipWinding also flips the shading normals", () => {
    const b = box(1);
    const before = b.normals![1];
    flipWinding(b);
    expect(b.normals![1]).toBe(-before);
  });
});

describe("primitives have consistent attribute counts", () => {
  it.each([
    ["box", box(1)],
    ["sphere", sphere(0.5, 10, 6)],
    ["plane", plane(2, 2, 3)],
    ["cylinder", cylinder(0.5, 1, 10)],
    ["torus", torus(0.4, 0.1, 10, 6)],
  ])("%s", (_name, mesh) => {
    const n = vertexCount(mesh);
    expect(mesh.normals).toHaveLength(n * 3);
    expect(mesh.uvs).toHaveLength(n * 2);
    expect(mesh.indices.length % 3).toBe(0);
    // Every index must be in range or the draw call is undefined behaviour.
    for (const i of mesh.indices) expect(i).toBeLessThan(n);
  });
});

describe("shading normals are unit length and point outward", () => {
  it.each([
    ["sphere", sphere(0.5, 16, 10)],
    ["torus", torus(0.4, 0.12, 16, 10)],
    ["cylinder", cylinder(0.5, 1, 16)],
  ])("%s", (_name, mesh) => {
    const n = mesh.normals!;
    for (let i = 0; i < n.length; i += 3) {
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 4);
    }
  });

  it("a cone's side normals tilt with the slope rather than staying horizontal", () => {
    // The classic bug: reusing the cylinder's horizontal normals for a cone,
    // which lights it as if it were a tube.
    const cone = cylinder(0.5, 1, 16, 0, false);
    const n = cone.normals!;
    let sawTilt = false;
    for (let i = 0; i < n.length; i += 3) {
      if (Math.abs(n[i + 1]) > 0.1) sawTilt = true;
    }
    expect(sawTilt).toBe(true);
  });
});

describe("box", () => {
  it("has hard edges — 24 vertices, not 8", () => {
    // Shared corners would average the three face normals and round the cube.
    expect(vertexCount(box(1))).toBe(24);
    expect(triangleCount(box(1))).toBe(12);
  });

  it("sizes each axis independently", () => {
    const { min, max } = bounds(box(2, 4, 6));
    expect(min).toEqual({ x: -1, y: -2, z: -3 });
    expect(max).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("has axis-aligned per-face normals", () => {
    const n = box(1).normals!;
    for (let i = 0; i < n.length; i += 3) {
      const components = [n[i], n[i + 1], n[i + 2]].filter((c) => Math.abs(c) > 1e-6);
      expect(components).toHaveLength(1);
    }
  });
});

describe("computeNormals", () => {
  it("smooths shared vertices — a shared-corner cube becomes round", () => {
    // Eight corners, each shared by three faces: the average of three axis
    // normals is a diagonal, which is exactly the smoothing this does.
    const cube: MeshData = {
      positions: new Float32Array([
        -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
      ]),
      indices: new Uint16Array([
        0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4,
        5, 1, 4, 1, 0,
      ]),
    };
    computeNormals(cube);
    const n = cube.normals!;
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1);
    // The corner at (−1,−1,1) points outward along its diagonal: x and y
    // negative, z positive. It is NOT exactly (−1,−1,1)/√3, because a
    // quad split into two triangles gives this corner two triangles on the
    // +Z face and one on each of the others — area weighting is doing its
    // job, and asserting the naive third would be asserting a bug.
    expect(n[0]).toBeCloseTo(n[1], 6);
    expect(n[0]).toBeLessThan(-0.3);
    expect(n[2]).toBeGreaterThan(-n[0]);
  });

  it("gives a degenerate vertex an up normal rather than NaN", () => {
    // A vertex no triangle references accumulates nothing; normalizing zero
    // would blacken every pixel that interpolates through it.
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 5, 5]),
      indices: new Uint16Array([0, 1, 2]),
    };
    computeNormals(mesh);
    expect(Array.from(mesh.normals!.slice(9))).toEqual([0, 1, 0]);
  });

  it("weights faces by area", () => {
    // Two triangles meeting at vertex 0: a big one in the XY plane and a
    // sliver in XZ. The averaged normal must lean toward the big one.
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0.01, 0, 0.01]),
      indices: new Uint16Array([0, 1, 2, 0, 3, 1]),
    };
    computeNormals(mesh);
    expect(Math.abs(mesh.normals![2])).toBeGreaterThan(0.99); // ~ +Z
  });

  it("reuses an existing normals array of the right size", () => {
    const mesh = sphere(0.5, 8, 6);
    const before = mesh.normals;
    computeNormals(mesh);
    expect(mesh.normals).toBe(before);
  });
});

describe("mergeMeshes", () => {
  it("offsets indices so each part keeps its own geometry", () => {
    const merged = mergeMeshes([box(1), box(1)]);
    expect(vertexCount(merged)).toBe(48);
    expect(triangleCount(merged)).toBe(24);
    for (const i of merged.indices) expect(i).toBeLessThan(48);
    // The second half's indices must point INTO the second half.
    expect(Math.max(...Array.from(merged.indices.slice(36)))).toBeGreaterThanOrEqual(24);
  });

  it("fills defaults for a part missing an attribute", () => {
    const bare: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    };
    const merged = mergeMeshes([box(1), bare]);
    // Colours: absent everywhere, so the output has none to carry.
    expect(merged.colors).toBeUndefined();
    // Normals: present on the box, so the bare part gets the up default rather
    // than a zero vector that would render black.
    const at = 24 * 3;
    expect(Array.from(merged.normals!.slice(at, at + 3))).toEqual([0, 1, 0]);
  });

  it("carries a second uv set and zeroes it where a part has none", () => {
    // The primitives never build a `uvs1`, so a merged pair of one authored
    // part and one generated part is the ordinary case for a detail-mapped
    // mesh — and a part left at zero samples one texel rather than reading
    // whatever the neighbouring part's uvs happened to be.
    const withUv1: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      uvs1: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    };
    const plain: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    };
    expect(mergeMeshes([plain, plain]).uvs1).toBeUndefined();
    const merged = mergeMeshes([withUv1, plain]);
    expect(Array.from(merged.uvs1!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("promotes to 32-bit indices past 65535 vertices", () => {
    const big = sphere(1, 200, 200); // 40k+ vertices
    const merged = mergeMeshes([big, big]);
    expect(vertexCount(merged)).toBeGreaterThan(65535);
    expect(merged.indices).toBeInstanceOf(Uint32Array);
  });
});

describe("bounds", () => {
  it("handles an empty mesh without returning Infinity", () => {
    const empty: MeshData = { positions: new Float32Array(0), indices: new Uint16Array(0) };
    expect(bounds(empty)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } });
  });

  it("fits a sphere to its radius", () => {
    const { min, max } = bounds(sphere(2, 32, 24));
    expect(min.x).toBeCloseTo(-2, 1);
    expect(max.y).toBeCloseTo(2, 1);
  });
});

describe("plane", () => {
  it("lies in XZ facing +Y", () => {
    const p = plane(4, 4, 2);
    const { min, max } = bounds(p);
    expect(min.y).toBe(0);
    expect(max.y).toBe(0);
    expect(max.x).toBe(2);
    expect(max.z).toBe(2);
    const n = p.normals!;
    for (let i = 0; i < n.length; i += 3) expect(n[i + 1]).toBe(1);
  });

  it("is wound counter-clockwise seen from above", () => {
    // Not covered by the closed-mesh check — a plane has no inside.
    const [n] = faceNormals(plane(2, 2, 1));
    expect(n.y).toBeCloseTo(1);
  });
});

describe("cylinder", () => {
  it("caps both ends when capped", () => {
    const open = cylinder(0.5, 1, 12, 0.5, false);
    const closed = cylinder(0.5, 1, 12, 0.5, true);
    expect(triangleCount(closed)).toBe(triangleCount(open) + 24);
  });

  it("skips the cap at a cone's tip, which has no area", () => {
    const cone = cylinder(0.5, 1, 12, 0, true);
    const open = cylinder(0.5, 1, 12, 0, false);
    expect(triangleCount(cone)).toBe(triangleCount(open) + 12);
  });
});

describe("wireframe", () => {
  it("draws each shared edge once", () => {
    // Two triangles sharing the diagonal 1-2: five distinct edges, not six.
    const quad: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
      indices: new Uint16Array([0, 1, 2, 1, 3, 2]),
    };
    const wire = wireframe(quad);
    expect(wire.topology).toBe("lines");
    expect(wire.indices.length).toBe(5 * 2);
    const edges = new Set<string>();
    for (let i = 0; i < wire.indices.length; i += 2) {
      const [a, b] = [wire.indices[i], wire.indices[i + 1]].sort((x, y) => x - y);
      edges.add(`${a}-${b}`);
    }
    expect([...edges].sort()).toEqual(["0-1", "0-2", "1-2", "1-3", "2-3"]);
  });

  it("keeps the source positions and drops the surface attributes", () => {
    const wire = wireframe(computeNormals(plane(2, 2, 1)));
    expect([...wire.positions]).toEqual([...plane(2, 2, 1).positions]);
    expect(wire.normals).toBeUndefined();
    expect(wire.uvs).toBeUndefined();
  });

  it("has no triangles to report", () => {
    // Frame stats count triangles; a wireframe contributes none, and its
    // segment count divided by three would be a lie in the overlay.
    expect(triangleCount(wireframe(box(1)))).toBe(0);
  });

  it("survives a merge, and refuses to be merged into a surface", () => {
    const merged = mergeMeshes([wireframe(box(1)), wireframe(box(1))]);
    expect(merged.topology).toBe("lines");
    expect(merged.indices.length).toBe(wireframe(box(1)).indices.length * 2);
    // The second half's indices point at the second box's own vertices.
    expect(vertexCount(merged)).toBe(vertexCount(box(1)) * 2);
    expect(() => mergeMeshes([wireframe(box(1)), box(1)])).toThrow(/line/);
  });
});
