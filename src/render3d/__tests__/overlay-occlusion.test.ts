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
