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

describe("the joint-matrix array", () => {
  function jointUploads(nodes: { mesh: MeshData; material: Material; skin?: unknown }[]) {
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    for (const n of nodes) addNode(scene, node(n as never));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    // The joint array is the only 4x4 matrix uniform uploaded as an array.
    return harness.calls.filter(
      (c) => c.name === "uniformMatrix4fv" && (c.args[2] as ArrayLike<number>)?.length > 16,
    ).length;
  }

  // TWO joints, so the pose upload is longer than a single 4x4 and the counter
  // above can tell it from an ordinary model matrix.
  const skin = {
    joints: [0, 1],
    inverseBindMatrices: new Float32Array(32),
    matrices: new Float32Array(32),
  };

  it("is written ONCE for a scene with no skins, not once per draw", () => {
    // 64 joints is 4 KB of driver-side validate-and-copy, and a level draws
    // hundreds of nodes that have no skin at all.
    expect(
      jointUploads([
        { mesh: GROUND, material: {} },
        { mesh: BALL, material: {} },
        { mesh: GUIDE, material: {} },
        { mesh: LABEL, material: {} },
      ]),
    ).toBe(1);
  });

  it("is put BACK to identity after a pose, which is what makes it safe", () => {
    // **The whole finding.** Skipping the upload entirely — the array simply
    // never written for an unskinned node — turned props black and made a
    // transparent quad vanish on a real level, though the shader guards every
    // joint read behind `if (uHasSkin)` and that flag is written either way. An
    // unwritten default-block array appears to leave the rest of the block
    // undefined on some drivers.
    //
    // So the rule is that the array must always HOLD something, not that it
    // must be rewritten: a pose goes in for the skinned node and identity goes
    // back for the next one that has none.
    expect(
      jointUploads([
        { mesh: GROUND, material: {}, skin },
        { mesh: BALL, material: {} },
      ]),
    ).toBe(2);
  });

  it("does not put identity back twice in a row", () => {
    expect(
      jointUploads([
        { mesh: GROUND, material: {}, skin },
        { mesh: BALL, material: {} },
        { mesh: GUIDE, material: {} },
      ]),
    ).toBe(2);
  });
});

describe("refilling a mesh in place", () => {
  /** Render twice with a version bump between, and report what the second pass
   *  did. */
  function secondPass(mutate: (mesh: MeshData) => void) {
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
    // A second mesh drawn FIRST, so a VAO that is not this one is bound when
    // the refill happens — which is the whole hazard.
    addNode(scene, node({ mesh: BALL, material: {} }));
    addNode(scene, node({ mesh, material: {} }));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    const before = harness.calls.length;
    mutate(mesh);
    renderer.render(scene, createCamera());
    return { calls: harness.calls.slice(before), harness };
  }

  it("reuses its buffers when only the numbers changed", () => {
    const { calls } = secondPass((mesh) => {
      mesh.positions[0] = 5;
      mesh.version = 2;
    });
    expect(calls.filter((c) => c.name === "createBuffer").length).toBe(0);
    expect(calls.filter((c) => c.name === "deleteBuffer").length).toBe(0);
    expect(calls.filter((c) => c.name === "bufferSubData").length).toBeGreaterThan(0);
  });

  it("binds its OWN vertex array before touching the element buffer", () => {
    // **The bug this test exists for.** `ELEMENT_ARRAY_BUFFER` is VAO state, and
    // `uploadMesh` runs before the draw binds anything — so the previous mesh's
    // VAO is still bound. Rebinding the element buffer without switching VAO
    // first repoints THAT mesh's indices at this one, and it draws with another
    // mesh's triangles. On screen: props black, thin geometry gone.
    const { calls, harness } = secondPass((mesh) => {
      mesh.positions[0] = 5;
      mesh.version = 2;
    });
    const boundVao = calls.findIndex((c) => c.name === "bindVertexArray" && c.args[0] !== null);
    const boundElements = calls.findIndex(
      (c) =>
        c.name === "bindBuffer" && harness.enumName(c.args[0] as number) === "ELEMENT_ARRAY_BUFFER",
    );
    expect(boundVao).toBeGreaterThanOrEqual(0);
    expect(boundElements).toBeGreaterThan(boundVao);
  });

  it("rebuilds when the index WIDTH changes, which the storage cannot absorb", () => {
    // `gpu.type` is fixed at creation, so 32-bit indices written into a buffer
    // the draw reads as 16-bit would draw garbage.
    const { calls } = secondPass((mesh) => {
      mesh.indices = new Uint32Array(GROUND.indices);
      mesh.version = 2;
    });
    expect(calls.filter((c) => c.name === "createBuffer").length).toBeGreaterThan(0);
  });
});

describe("a material shared by a run of nodes", () => {
  function uniformWrites(nodes: { mesh: MeshData; material: Material }[]) {
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    for (const n of nodes) addNode(scene, node(n));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    return harness.calls.filter((c) => c.name === "uniform4f").length;
  }

  it("sets its uniforms once for the whole run", () => {
    // A level draws far more nodes than it has materials, so this is 24-40 GL
    // calls a node.
    const shared: Material = { color: [1, 0, 0, 1] };
    const four = uniformWrites([
      { mesh: GROUND, material: shared },
      { mesh: BALL, material: shared },
      { mesh: GUIDE, material: shared },
      { mesh: LABEL, material: shared },
    ]);
    expect(four).toBe(uniformWrites([{ mesh: GROUND, material: shared }]));
  });

  it("sets them again after a TEXTURE UPLOAD, which is what makes it safe", () => {
    // **The bug this guard exists for.** `setMaterial` binds textures as well as
    // writing uniforms, and `uploadTexture` binds on its own account — so a live
    // surface re-uploading between two draws leaves ITS texture on the unit, and
    // a run that skipped the rebind drew with the wrong one. On screen: props
    // black, and only once something was moving enough to repaint that surface,
    // which is why a still tee looked fine and the shot after it did not.
    const shared: Material = { color: [1, 0, 0, 1] };
    const live = document.createElement("canvas");
    const withUpload: Material = { color: [0, 1, 0, 1], texture: live, textureVersion: 1 };
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    addNode(scene, node({ mesh: GROUND, material: shared }));
    addNode(scene, node({ mesh: BALL, material: withUpload }));
    addNode(scene, node({ mesh: GUIDE, material: shared }));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    const first = harness.calls.length;
    // The live surface changes, so the next frame re-uploads it mid-pass.
    withUpload.textureVersion = 2;
    renderer.render(scene, createCamera());
    const second = harness.calls.slice(first);
    // Three materials' worth of writes, not two: the run cannot span the upload.
    const perMaterial = second.filter((c) => c.name === "uniform4f").length;
    expect(perMaterial).toBeGreaterThan(0);
    expect(second.some((c) => c.name === "texImage2D")).toBe(true);
  });
});

describe("instancing a run of nodes", () => {
  function draws(nodes: { mesh: MeshData; material: Material; skin?: unknown }[]) {
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    for (const n of nodes) addNode(scene, node(n as never));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    return {
      single: harness.calls.filter((c) => c.name === "drawElements").length,
      batched: harness.calls.filter((c) => c.name === "drawElementsInstanced").length,
      counts: harness.calls
        .filter((c) => c.name === "drawElementsInstanced")
        .map((c) => c.args[4] as number),
    };
  }

  it("folds a run of one mesh and one material into ONE call", () => {
    const shared: Material = { color: [1, 0, 0, 1] };
    const out = draws([
      { mesh: GROUND, material: shared },
      { mesh: GROUND, material: shared },
      { mesh: GROUND, material: shared },
    ]);
    expect(out.batched).toBe(1);
    expect(out.counts).toEqual([3]);
    expect(out.single).toBe(0);
  });

  it("keeps different MESHES apart under one material", () => {
    // The sort groups them by material, so the run detection has to split on
    // mesh too or the second would draw with the first's geometry.
    const shared: Material = { color: [1, 0, 0, 1] };
    const out = draws([
      { mesh: GROUND, material: shared },
      { mesh: GROUND, material: shared },
      { mesh: BALL, material: shared },
      { mesh: BALL, material: shared },
    ]);
    expect(out.counts).toEqual([2, 2]);
  });

  it("never batches a SKINNED node", () => {
    // The pose is a uniform array, so two copies in one call would wear one
    // skeleton.
    const shared: Material = { color: [1, 0, 0, 1] };
    const skin = {
      joints: [0, 1],
      inverseBindMatrices: new Float32Array(32),
      matrices: new Float32Array(32),
    };
    const out = draws([
      { mesh: GROUND, material: shared, skin },
      { mesh: GROUND, material: shared, skin },
    ]);
    expect(out.batched).toBe(0);
    expect(out.single).toBe(2);
  });

  it("does not batch a run of one, which would pay an upload to save nothing", () => {
    const out = draws([{ mesh: GROUND, material: { color: [1, 0, 0, 1] } }]);
    expect(out.batched).toBe(0);
    expect(out.single).toBe(1);
  });

  it("counts the triangles it actually drew, not the calls it made", () => {
    const shared: Material = { color: [1, 0, 0, 1] };
    const harness = recordingGl();
    const canvas = document.createElement("canvas");
    (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
    const renderer = createWebGL2Renderer({ canvas });
    const scene = createScene();
    for (let i = 0; i < 4; i++) addNode(scene, node({ mesh: GROUND, material: shared }));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera());
    expect(renderer.stats.drawCalls).toBe(1);
    expect(renderer.stats.triangles).toBe(4);
  });
});
