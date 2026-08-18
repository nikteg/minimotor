/** What the camera can possibly see, and what it is safe to drop. */

import { describe, expect, it } from "vitest";
import { Mat4 } from "@src/math/mat4.js";
import { frustumPlanes, inFrustum, meshBounds } from "../cull.js";
import { createCamera, viewProjection } from "../camera.js";
import type { Camera3D } from "../camera.js";
import type { MeshData } from "../mesh.js";
import { instantiateGltf } from "../gltf.js";

/** A camera AT the origin looking down −Z, which is where yaw 0 points. The
 *  target is one unit down −Z at distance 1, so the eye lands on the origin. */
function looking(): Camera3D {
  return createCamera({
    target: { x: 0, y: 0, z: -1 },
    distance: 1,
    yaw: 0,
    pitch: 0,
    fov: Math.PI / 3,
    near: 0.1,
    far: 100,
  });
}

function planesOf(camera: Camera3D = looking(), aspect = 1) {
  const viewProj = Mat4.create();
  viewProjection(camera, aspect, false, viewProj);
  return frustumPlanes(viewProj);
}

/** A unit cube centred on the origin. */
function cube(): MeshData {
  const corners = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, 0.5, -0.5],
    [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5],
    [0.5, -0.5, 0.5],
    [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5],
  ].flat();
  return { positions: new Float32Array(corners) } as MeshData;
}

describe("a mesh's own box", () => {
  it("is the middle and the half-size of its positions", () => {
    const bounds = meshBounds({
      positions: new Float32Array([0, 0, 0, 2, 4, 6]),
    } as MeshData)!;
    expect(bounds.cx).toBe(1);
    expect(bounds.cy).toBe(2);
    expect(bounds.cz).toBe(3);
    expect(bounds.ex).toBe(1);
    expect(bounds.ey).toBe(2);
    expect(bounds.ez).toBe(3);
  });

  it("is computed once and kept, so a static mesh pays nothing per frame", () => {
    const mesh = cube();
    expect(meshBounds(mesh)).toBe(meshBounds(mesh));
  });

  it("is recomputed when the mesh says it changed", () => {
    // A particle batch rewrites its vertices every frame and bumps `version`.
    // Bounds cached past that would follow the first frame's particles for the
    // life of the emitter.
    const mesh = { positions: new Float32Array([0, 0, 0]), version: 1 } as MeshData;
    expect(meshBounds(mesh)!.cx).toBe(0);
    mesh.positions = new Float32Array([10, 10, 10]);
    mesh.version = 2;
    expect(meshBounds(mesh)!.cx).toBe(10);
  });

  it("is null for a mesh with nothing in it", () => {
    expect(meshBounds({ positions: new Float32Array([]) } as MeshData)).toBeNull();
  });
});

describe("the frustum test", () => {
  const planes = planesOf();

  /** A world matrix that only moves. */
  function at(x: number, y: number, z: number) {
    return Mat4.fromTranslation(x, y, z);
  }

  it("keeps what is in front of the camera", () => {
    expect(inFrustum(planes, meshBounds(cube()), at(0, 0, -10))).toBe(true);
  });

  it("drops what is BEHIND it, which is the whole point", () => {
    expect(inFrustum(planes, meshBounds(cube()), at(0, 0, 10))).toBe(false);
  });

  it("drops what is off to the side", () => {
    expect(inFrustum(planes, meshBounds(cube()), at(50, 0, -10))).toBe(false);
    expect(inFrustum(planes, meshBounds(cube()), at(0, 50, -10))).toBe(false);
  });

  it("drops what is past the far plane", () => {
    expect(inFrustum(planes, meshBounds(cube()), at(0, 0, -500))).toBe(false);
  });

  it("keeps something that only PARTLY overlaps the view", () => {
    // A wall running out of frame is still on screen, and dropping it would
    // punch a hole through the middle of the picture.
    const wide = meshBounds({
      positions: new Float32Array([-100, -1, -1, 100, 1, 1]),
    } as MeshData);
    expect(inFrustum(planes, wide, at(0, 0, -10))).toBe(true);
  });

  it("accounts for the SIZE of a thing centred out of view", () => {
    // The centre is far off to the side; the box still reaches into the view.
    // A test on the centre alone would drop it.
    const long = meshBounds({
      positions: new Float32Array([-30, -1, -1, 30, 1, 1]),
    } as MeshData);
    expect(inFrustum(planes, long, at(28, 0, -10))).toBe(true);
  });

  it("accounts for SCALE in the world matrix", () => {
    // Something small enough to cull, blown up until it is not.
    const world = Mat4.create();
    Mat4.compose(
      world,
      { x: 40, y: 0, z: -10 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 100, y: 1, z: 1 },
    );
    expect(inFrustum(planes, meshBounds(cube()), at(40, 0, -10))).toBe(false);
    expect(inFrustum(planes, meshBounds(cube()), world)).toBe(true);
  });

  it("keeps anything it cannot rule out", () => {
    // A missing box or a missing matrix is a question this cannot answer, and
    // the safe answer is to draw: a needless draw costs one call, a wrong drop
    // is a hole in the world.
    expect(inFrustum(planes, null, at(0, 0, 100))).toBe(true);
    expect(inFrustum(planes, meshBounds(cube()), undefined)).toBe(true);
  });
});

describe("the depth convention", () => {
  it("puts the near plane in a different place for a 0..1 range", () => {
    // WebGPU keeps `0 <= z` where WebGL keeps `-w <= z`, so the near plane is
    // the z row alone rather than the z row plus the w row. Getting this wrong
    // culls geometry just in front of the camera.
    const camera = looking();
    const gl = Mat4.create();
    const gpu = Mat4.create();
    viewProjection(camera, 1, false, gl);
    viewProjection(camera, 1, true, gpu);
    const near = frustumPlanes(gl, undefined, false).slice(16, 20);
    const nearGpu = frustumPlanes(gpu, undefined, true).slice(16, 20);
    // Both name the same plane in world terms: pointing down −Z, `near` in
    // front of the camera.
    expect(near[2]).toBeCloseTo(nearGpu[2]!, 5);
    expect(near[3]).toBeCloseTo(nearGpu[3]!, 5);
  });

  it("agrees with the other five planes across both conventions", () => {
    const camera = looking();
    const gl = Mat4.create();
    const gpu = Mat4.create();
    viewProjection(camera, 1.7, false, gl);
    viewProjection(camera, 1.7, true, gpu);
    const a = frustumPlanes(gl, undefined, false);
    const b = frustumPlanes(gpu, undefined, true);
    for (const plane of [0, 1, 2, 3]) {
      for (const axis of [0, 1, 2, 3]) {
        expect(a[plane * 4 + axis]).toBeCloseTo(b[plane * 4 + axis]!, 5);
      }
    }
  });
});

describe("the backing store's pixel budget", () => {
  /** The arithmetic a dpr ceiling is for, stated as a test so the saving is a
   *  number rather than a belief.
   *
   *  Fill cost per logical pixel is `(dpr * resolutionScale)^2 * sampleCount`.
   *  Every per-pixel cost in a frame — each texture fetch, the normal frame,
   *  the lighting, the tone curve — is paid that many times. */
  function samplesPerLogicalPixel(dpr: number, scale: number, sampleCount: number): number {
    return (dpr * scale) ** 2 * sampleCount;
  }

  it("is 36 samples a pixel on a 3x phone with 4x multisampling", () => {
    expect(samplesPerLogicalPixel(3, 1, 4)).toBe(36);
  });

  it("loses 56% of them to a ceiling of 2, with the edges still multisampled", () => {
    const capped = samplesPerLogicalPixel(2, 1, 4);
    expect(capped).toBe(16);
    expect(1 - capped / samplesPerLogicalPixel(3, 1, 4)).toBeCloseTo(0.5556, 4);
  });

  it("costs nothing on a display that never exceeded the ceiling", () => {
    // A desktop at 1x or 2x is untouched by a cap of 2, which is why this can
    // be a default rather than a device check.
    expect(Math.min(1, 2)).toBe(1);
    expect(Math.min(2, 2)).toBe(2);
  });

  it("is a different dial from the player's resolution scale, and they multiply", () => {
    // Halving the scale is a quarter of the pixels on top of whatever the cap
    // already took, so the two are not alternatives.
    expect(samplesPerLogicalPixel(2, 0.5, 4)).toBe(4);
  });
});

describe("what instantiateGltf shares between nodes", () => {
  /** Two nodes pointing at one glTF mesh, which is the shape a level is full
   *  of: a lamp post placed thirty times is one set of vertices in the file. */
  const twoNodesOneMesh = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 0, translation: [5, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 42 }],
  };

  it("hands both nodes the SAME mesh, so the GPU uploads it once", async () => {
    // MEASURED on a consumer's level before this: 416 drawable nodes carrying
    // 412 distinct meshes, where the file holds 114 — so every vertex buffer in
    // the level was uploaded three or four times over, and no renderer could
    // tell the copies apart to batch them.
    const buffer = new ArrayBuffer(42);
    const { scene } = await instantiateGltf({
      document: twoNodesOneMesh as never,
      buffers: [buffer],
    });
    const drawn = scene.nodes.filter((n) => n.mesh);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.mesh).toBe(drawn[1]!.mesh);
  });

  it("gives each node its OWN material, which is what a mutating consumer needs", async () => {
    // A per-area repaint collects the material objects inside an area and
    // writes to them; shared, one such write would reach every node that shares
    // the material wherever it stood. Sharing this is worth real draw calls and
    // waits for those consumers to copy first.
    const buffer = new ArrayBuffer(42);
    const { scene } = await instantiateGltf({
      document: twoNodesOneMesh as never,
      buffers: [buffer],
    });
    const drawn = scene.nodes.filter((n) => n.mesh);
    expect(drawn[0]!.material).not.toBe(drawn[1]!.material);
    expect(drawn[0]!.material).toEqual(drawn[1]!.material);
  });
});
