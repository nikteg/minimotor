/** `Material.occludesOverlays` / `Material.overlayOccluded`: one nominated
 *  object allowed to hide the overlays that asked to be hidden.
 *
 * The overlay pass draws with the depth test off, so "in front of the course
 * but behind the ball" is a picture it cannot produce: an overlay is over
 * everything or over nothing. The pair of flags builds it a depth buffer with
 * only the nominated occluders in it, and this pins the resulting DRAW STATE —
 * which depth function and which masks each draw sees — because that is the
 * thing the two backends have to agree on, and the thing that silently
 * regresses.
 *
 * WebGL2 is driven for real against a recording context: the states are the
 * assertion, so a refactor that moves the calls around is free while one that
 * changes what a draw sees is not. WebGPU has no device here, so its half is
 * read as source text, as in `occluded.test.ts` — a weak test of "the pass is
 * right" and a strong test of "the two passes are the same pass".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { addNode, createScene, node, updateWorldMatrices, type Material } from "../scene.js";
import { createCamera } from "../camera.js";
import { createWebGL2Renderer } from "../webgl2.js";
import type { MeshData } from "../mesh.js";

interface GlCall {
  name: string;
  args: unknown[];
}

interface Harness {
  gl: WebGL2RenderingContext;
  calls: GlCall[];
  enumName(value: unknown): string;
}

/** A WebGL2 context that records instead of rasterising. Constants are minted
 *  on demand — the backend's choice of enum is exactly what is under test, so
 *  naming them here would only be a second place to keep in step — except the
 *  buffer bits, which get their real values because `clear` ORs them together
 *  into one argument. */
function recordingGl(): Harness {
  const calls: GlCall[] = [];
  const names = new Map<number, string>();
  const values = new Map<string, number>();
  const bits: Record<string, number> = {
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x100,
    STENCIL_BUFFER_BIT: 0x400,
  };
  let nextEnum = 0x1_0000;
  const gl = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(property)) {
          if (bits[property] !== undefined) return bits[property];
          let value = values.get(property);
          if (value === undefined) {
            value = nextEnum++;
            values.set(property, value);
            names.set(value, property);
          }
          return value;
        }
        return (...args: unknown[]): unknown => {
          calls.push({ name: property, args });
          // Every handle the backend keeps has to be non-null, or it throws
          // instead of drawing; a shader or link status has to be truthy.
          return property.startsWith("create") || property.startsWith("get") ? {} : undefined;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls, enumName: (value) => names.get(value as number) ?? String(value) };
}

/** A mesh identified by its index count, so a recorded `drawElements` says
 *  which node made it without the harness having to track bindings. */
function mesh(triangles: number): MeshData {
  return {
    positions: new Float32Array(triangles * 9),
    indices: new Uint16Array(triangles * 3),
  };
}

const GROUND = mesh(1); // 3 indices
const BALL = mesh(2); // 6
const GUIDE = mesh(3); // 9
const LABEL = mesh(4); // 12

interface DrawnWith {
  /** Index count, which names the mesh. */
  count: number;
  depthFunc: string;
  depthWrites: boolean;
  colorWrites: boolean;
  /** How many depth clears preceded this draw. The frame's own clear is one,
   *  so anything drawn after a second one is drawing against the prepass. */
  afterDepthClears: number;
}

/** Render one scene and report the state in force at each draw. */
function drawStates(nodes: { mesh: MeshData; material: Material }[]): DrawnWith[] {
  const harness = recordingGl();
  const canvas = document.createElement("canvas");
  (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
  const renderer = createWebGL2Renderer({ canvas });
  const scene = createScene();
  for (const n of nodes) addNode(scene, node(n));
  updateWorldMatrices(scene);
  renderer.render(scene, createCamera());

  const out: DrawnWith[] = [];
  let depthFunc = "";
  let depthWrites = true;
  let colorWrites = true;
  let depthClears = 0;
  for (const call of harness.calls) {
    if (call.name === "depthFunc") depthFunc = harness.enumName(call.args[0]);
    else if (call.name === "depthMask") depthWrites = call.args[0] === true;
    else if (call.name === "colorMask") colorWrites = call.args[0] === true;
    else if (call.name === "clear" && ((call.args[0] as number) & 0x100) !== 0) depthClears++;
    else if (call.name === "drawElements") {
      out.push({
        count: call.args[1] as number,
        depthFunc,
        depthWrites,
        colorWrites,
        afterDepthClears: depthClears,
      });
    }
  }
  return out;
}

const OVERLAY: Material = { depthTest: false };

describe("an overlay with nothing to hide behind", () => {
  it("draws over everything, as it always has", () => {
    const drawn = drawStates([
      { mesh: GROUND, material: {} },
      { mesh: BALL, material: {} },
      { mesh: GUIDE, material: OVERLAY },
      { mesh: LABEL, material: { ...OVERLAY, transparent: true } },
    ]);
    expect(drawn.map((d) => d.count)).toEqual([3, 6, 9, 12]);
    expect(drawn[2]).toMatchObject({ depthFunc: "ALWAYS", depthWrites: true });
    // An opaque overlay keeps its depth writes and a transparent one does not,
    // which is the rule `Material.depthTest` documents.
    expect(drawn[3]).toMatchObject({ depthFunc: "ALWAYS", depthWrites: false });
    // One clear: the frame's own. Nothing rebuilt the depth buffer.
    expect(drawn.every((d) => d.afterDepthClears === 1)).toBe(true);
  });

  it("is unchanged by an occluder that no overlay opted into", () => {
    // Half a pair is not a policy. A scene that nominates an occluder and never
    // asks an overlay to respect it must not pay for a prepass, and must not
    // start hiding overlays it was hiding nothing behind before.
    const drawn = drawStates([
      { mesh: BALL, material: { occludesOverlays: true } },
      { mesh: GUIDE, material: OVERLAY },
    ]);
    expect(drawn.map((d) => d.count)).toEqual([6, 9]);
    expect(drawn[1]).toMatchObject({ depthFunc: "ALWAYS", afterDepthClears: 1 });
  });

  it("is unchanged by an opt-in with no occluder to hide behind", () => {
    // The other half. Testing against a buffer holding nothing would pass
    // everywhere, which is the same picture — but it would also cost a clear
    // and turn the overlay's depth writes off for no reason.
    const drawn = drawStates([
      { mesh: BALL, material: {} },
      { mesh: GUIDE, material: { ...OVERLAY, overlayOccluded: true } },
    ]);
    expect(drawn[1]).toMatchObject({ depthFunc: "ALWAYS", depthWrites: true });
    expect(drawn[1].afterDepthClears).toBe(1);
  });

  it("cannot be nominated as an occluder itself", () => {
    // An overlay's depth is not the scene's depth — it was written with the
    // test off, if at all — so a shape that never sorted against anything must
    // not become the thing the other overlays sort against.
    const drawn = drawStates([
      { mesh: BALL, material: { ...OVERLAY, occludesOverlays: true } },
      { mesh: GUIDE, material: { ...OVERLAY, overlayOccluded: true } },
    ]);
    expect(drawn.map((d) => d.count)).toEqual([6, 9]);
    expect(drawn.every((d) => d.depthFunc === "ALWAYS")).toBe(true);
  });
});

describe("an overlay that opted into being occluded", () => {
  const scene = [
    { mesh: GROUND, material: {} },
    { mesh: BALL, material: { occludesOverlays: true } },
    { mesh: GUIDE, material: { ...OVERLAY, overlayOccluded: true } },
    { mesh: LABEL, material: OVERLAY },
  ];

  it("is preceded by the occluder re-drawn into a cleared depth buffer", () => {
    const drawn = drawStates(scene);
    // Ground, ball, then the ball AGAIN before the overlays: the second one is
    // the prepass, and it writes only depth. Clearing first is what keeps the
    // course out of the buffer — an overlay tested against the scene's own
    // depth is just a depth-tested surface, which is what it opted out of.
    expect(drawn.map((d) => d.count)).toEqual([3, 6, 6, 9, 12]);
    expect(drawn[2]).toMatchObject({
      colorWrites: false,
      depthWrites: true,
      depthFunc: "LEQUAL",
      afterDepthClears: 2,
    });
    // The prepass draw must not be visible: it would paint the occluder over
    // the frame a second time, now with the depth it sorted against gone.
    expect(drawn.filter((d) => !d.colorWrites)).toHaveLength(1);
  });

  it("tests against that buffer instead of ignoring depth", () => {
    const drawn = drawStates(scene);
    expect(drawn[3]).toMatchObject({ count: 9, depthFunc: "LEQUAL", afterDepthClears: 2 });
  });

  it("leaves the overlays that did not opt in over everything", () => {
    const drawn = drawStates(scene);
    expect(drawn[4]).toMatchObject({ count: 12, depthFunc: "ALWAYS" });
  });

  it("stops every overlay writing depth while the prepass stands", () => {
    // The buffer belongs to the nominated occluders for the whole pass. An
    // overlay writing into it becomes a second occluder nobody asked for, and
    // the failure looks like one readout eating another.
    const drawn = drawStates(scene);
    expect(drawn.slice(3).every((d) => !d.depthWrites)).toBe(true);
  });

  it("hides behind the occluder even where the occluder is itself hidden", () => {
    // Not a bug to fix later — a documented consequence. Only the nominated
    // nodes are in that buffer, so the course cannot put itself in front of
    // one. Pinned because the alternative reading ("the ball hides it only
    // where the ball is visible") is what a reader expects, and would need a
    // second depth buffer to deliver.
    const drawn = drawStates([
      // A wall drawn first, an occluder behind it, an overlay that opted in.
      { mesh: GROUND, material: {} },
      { mesh: BALL, material: { occludesOverlays: true } },
      { mesh: GUIDE, material: { ...OVERLAY, overlayOccluded: true } },
    ]);
    expect(drawn.map((d) => d.count)).toEqual([3, 6, 6, 9]);
    // The wall is not re-drawn into the prepass, so it is not in the buffer
    // the overlay tests against.
    expect(drawn.filter((d) => d.count === 3)).toHaveLength(1);
  });
});

const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

describe("both backends", () => {
  it("gate the prepass on both halves of the pair being present", () => {
    for (const backend of ["webgl2.ts", "webgpu.ts"]) {
      expect(read(backend)).toMatch(
        /overlayOccluders\.length > 0 &&\s*overlay\.some\(\(i\) => scene\.nodes\[i\]\.material\?\.overlayOccluded === true\)/,
      );
    }
  });

  it("refuse to nominate an overlay as an occluder", () => {
    for (const backend of ["webgl2.ts", "webgpu.ts"]) {
      expect(read(backend)).toMatch(
        /n\.material\?\.occludesOverlays && n\.material\.depthTest !== false/,
      );
    }
  });

  it("clear the depth buffer under the overlays in WebGPU too", () => {
    // WebGPU can only clear an attachment as a pass BEGINS, so the equivalent
    // of WebGL2's mid-frame clear is a second render pass — colour loaded so
    // the overlays paint onto the scene, depth cleared so they test against
    // the prepass alone.
    const webgpu = read("webgpu.ts");
    expect(webgpu).toMatch(/loadOp: "load",\s*storeOp: "store",[\s\S]{0,200}depthLoadOp: "clear"/);
    expect(webgpu).toMatch(/if \(gating && slot === firstOverlay\)/);
  });

  it("write depth and no colour for the prepass in WebGPU too", () => {
    const webgpu = read("webgpu.ts");
    expect(webgpu).toMatch(/writeMask: depthOnly \? 0 : GPUColorWrite\.ALL/);
    expect(webgpu).toMatch(/depthWriteEnabled: depthOnly \|\|/);
  });

  it("keep a gated overlay testing and never writing in WebGPU too", () => {
    const webgpu = read("webgpu.ts");
    expect(webgpu).toMatch(/overlay && !gatedOverlay \? "always" : "less-equal"/);
    expect(webgpu).toMatch(/depthWriteEnabled:[^\n]*!occluderDepth/);
  });
});

describe("a material shared by many nodes", () => {
  /** How many times the base-colour uniform was written, which stands for the
   *  whole per-material block: it is set once per material change and never
   *  otherwise. */
  function baseColorWrites(nodes: { mesh: MeshData; material: Material }[]): number {
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    for (const n of nodes) addNode(scene, node(n));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    return harness.calls.filter((call) => call.name === "uniform4f").length;
  }

  it("sets its uniforms ONCE for the whole run", () => {
    // A level draws far more nodes than it has materials — 389 draws over 23
    // materials on one shipped course, one of them taking 84 — and every one of
    // those draws re-sent the same ~24-40 GL calls. The opaque pass is sorted by
    // material identity, so they arrive as runs and a run pays once.
    const shared: Material = { color: [1, 0, 0, 1] };
    const four = baseColorWrites([
      { mesh: GROUND, material: shared },
      { mesh: BALL, material: shared },
      { mesh: GUIDE, material: shared },
      { mesh: LABEL, material: shared },
    ]);
    const one = baseColorWrites([{ mesh: GROUND, material: shared }]);
    expect(four).toBe(one);
  });

  it("still sets them again for a DIFFERENT material", () => {
    const one = baseColorWrites([{ mesh: GROUND, material: { color: [1, 0, 0, 1] } }]);
    const two = baseColorWrites([
      { mesh: GROUND, material: { color: [1, 0, 0, 1] } },
      { mesh: BALL, material: { color: [0, 1, 0, 1] } },
    ]);
    expect(two).toBe(one * 2);
  });

  it("keeps scene order for materials that do not repeat", () => {
    // The sort is stable and the keys are handed out as the scene is walked, so
    // a scene with no shared materials draws in exactly the order it always
    // did. Only repeats move, and only towards each other.
    const drawn = drawStates([
      { mesh: GROUND, material: {} },
      { mesh: BALL, material: {} },
      { mesh: GUIDE, material: {} },
    ]);
    expect(drawn.map((d) => d.count)).toEqual([3, 6, 9]);
  });
});

describe("a mesh rewritten in place", () => {
  /** Render twice, bumping the version between, and report how many GL objects
   *  were created and destroyed on the second pass. */
  function rebuildCost(mutate: (mesh: MeshData) => void) {
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    const mesh: MeshData = {
      positions: new Float32Array(GROUND.positions),
      indices: new Uint16Array(GROUND.indices),
      version: 1,
    };
    addNode(scene, node({ mesh, material: {} }));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    const before = harness.calls.length;
    mutate(mesh);
    renderer.render(scene, createCamera());
    const after = harness.calls.slice(before);
    return {
      created: after.filter((c) => c.name === "createBuffer" || c.name === "createVertexArray")
        .length,
      destroyed: after.filter((c) => c.name === "deleteBuffer" || c.name === "deleteVertexArray")
        .length,
      subData: after.filter((c) => c.name === "bufferSubData").length,
    };
  }

  it("reuses its buffers when only the numbers changed", () => {
    // A particle emitter bumps its version every frame — rewriting vertices is
    // what it IS — so rebuilding meant deleting a VAO and nine buffers and
    // creating nine more, sixty times a second per emitter.
    const cost = rebuildCost((mesh) => {
      mesh.positions[0] = 5;
      mesh.version = 2;
    });
    expect(cost.created).toBe(0);
    expect(cost.destroyed).toBe(0);
    // Positions and indices, and nothing for the attributes it does not carry.
    expect(cost.subData).toBe(2);
  });

  it("rebuilds when the SHAPE changed, which the storage cannot absorb", () => {
    const cost = rebuildCost((mesh) => {
      mesh.positions = new Float32Array(GROUND.positions.length * 2);
      mesh.indices = new Uint16Array(GROUND.indices.length * 2);
      mesh.version = 2;
    });
    expect(cost.created).toBeGreaterThan(0);
    expect(cost.destroyed).toBeGreaterThan(0);
  });

  it("rebuilds when the mesh GAINS an attribute", () => {
    // The defaults filled in for a missing attribute are built here, so a mesh
    // that grows real uvs cannot have them written into a default buffer.
    const cost = rebuildCost((mesh) => {
      mesh.uvs = new Float32Array((mesh.positions.length / 3) * 2);
      mesh.version = 2;
    });
    expect(cost.created).toBeGreaterThan(0);
  });
});

describe("mipmaps", () => {
  function textureCalls(mipmaps: boolean, pixelated: boolean) {
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas, mipmaps });
    const scene = createScene();
    const image = document.createElement("canvas");
    addNode(scene, node({ mesh: GROUND, material: { texture: image, pixelated } }));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    return harness.calls;
  }

  it("builds a chain and samples it trilinearly when asked", () => {
    const calls = textureCalls(true, false);
    expect(calls.some((c) => c.name === "generateMipmap")).toBe(true);
    // The chain is built before the filter that reads it is set, which is the
    // order the texture has to be left in.
    const built = calls.findIndex((c) => c.name === "generateMipmap");
    const filtered = calls.findIndex(
      (c, at) => at > built && c.name === "texParameteri" && built >= 0,
    );
    expect(filtered).toBeGreaterThan(built);
  });

  it("does nothing unless asked, which keeps the picture as it was", () => {
    expect(textureCalls(false, false).some((c) => c.name === "generateMipmap")).toBe(false);
  });

  it("leaves a PIXELATED texture alone even when asked", () => {
    // A sprite sheet asking for NEAREST is asking not to be filtered, and a mip
    // chain is filtering.
    expect(textureCalls(true, true).some((c) => c.name === "generateMipmap")).toBe(false);
  });
});
