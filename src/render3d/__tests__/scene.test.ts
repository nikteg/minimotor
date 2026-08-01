import { describe, expect, it } from "vitest";
import { Mat4 } from "@src/math/mat4.js";
import { Quat } from "@src/math/quat.js";
import { addNode, createScene, findNode, isVisible, node, updateWorldMatrices } from "../scene.js";
import { box } from "../mesh.js";
import type { Vec3 } from "@src/math/vec3.js";

/** Where a node's world matrix puts the local origin. */
function worldOrigin(world: Mat4): Vec3 {
  return { x: world[12], y: world[13], z: world[14] };
}

describe("addNode", () => {
  it("returns the index, which is the handle children and tracks use", () => {
    const scene = createScene();
    expect(addNode(scene, node())).toBe(0);
    expect(addNode(scene, node())).toBe(1);
  });

  it("rejects a forward parent reference", () => {
    // The one-pass world-matrix walk depends on parents coming first. A
    // forward reference would not throw at render time — it would silently
    // leave the child at the origin, which is far harder to diagnose.
    const scene = createScene();
    expect(() => addNode(scene, node({ parent: 0 }))).toThrow(/parents come first/);
    addNode(scene, node());
    expect(() => addNode(scene, node({ parent: 5 }))).toThrow();
    expect(() => addNode(scene, node({ parent: 0 }))).not.toThrow();
  });
});

describe("updateWorldMatrices", () => {
  it("composes a local transform into the world matrix", () => {
    const scene = createScene();
    addNode(scene, node({ position: { x: 1, y: 2, z: 3 } }));
    updateWorldMatrices(scene);
    expect(worldOrigin(scene.nodes[0].world!)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("applies the parent's transform to a child", () => {
    const scene = createScene();
    // A parent rotated a quarter turn about Y takes the child's local +Z to +X.
    const parent = addNode(
      scene,
      node({
        position: { x: 10, y: 0, z: 0 },
        rotation: Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 2),
      }),
    );
    addNode(scene, node({ parent, position: { x: 0, y: 0, z: 1 } }));
    updateWorldMatrices(scene);
    const child = worldOrigin(scene.nodes[1].world!);
    expect(child.x).toBeCloseTo(11);
    expect(child.y).toBeCloseTo(0);
    expect(child.z).toBeCloseTo(0);
  });

  it("scales a child's offset by the parent's scale", () => {
    const scene = createScene();
    const parent = addNode(scene, node({ scale: { x: 3, y: 3, z: 3 } }));
    addNode(scene, node({ parent, position: { x: 2, y: 0, z: 0 } }));
    updateWorldMatrices(scene);
    expect(worldOrigin(scene.nodes[1].world!).x).toBeCloseTo(6);
  });

  it("resolves a deep chain in one forward pass", () => {
    const scene = createScene();
    let parent: number | undefined = undefined;
    for (let i = 0; i < 6; i++) {
      parent = addNode(scene, node({ parent, position: { x: 1, y: 0, z: 0 } }));
    }
    updateWorldMatrices(scene);
    // Six links of one unit each, with no recursion and no second pass.
    expect(worldOrigin(scene.nodes[5].world!).x).toBeCloseTo(6);
  });

  it("reuses the same matrix object across frames", () => {
    // The renderer reads `node.world` every frame; reallocating it would churn
    // one Float32Array per node per frame.
    const scene = createScene();
    addNode(scene, node());
    updateWorldMatrices(scene);
    const first = scene.nodes[0].world;
    updateWorldMatrices(scene);
    expect(scene.nodes[0].world).toBe(first);
  });

  it("is idempotent — running twice does not compound the parent transform", () => {
    // The aliasing trap: the local matrix is composed INTO `node.world` and
    // then multiplied by the parent into the same array. Getting that wrong
    // makes a child drift further from its parent every frame.
    const scene = createScene();
    const parent = addNode(scene, node({ position: { x: 5, y: 0, z: 0 } }));
    addNode(scene, node({ parent, position: { x: 1, y: 0, z: 0 } }));
    updateWorldMatrices(scene);
    const once = Float32Array.from(scene.nodes[1].world!);
    updateWorldMatrices(scene);
    updateWorldMatrices(scene);
    expect(Mat4.equals(scene.nodes[1].world!, once)).toBe(true);
    expect(worldOrigin(scene.nodes[1].world!).x).toBeCloseTo(6);
  });
});

describe("isVisible", () => {
  it("is true by default", () => {
    const scene = createScene();
    addNode(scene, node({ mesh: box(1) }));
    expect(isVisible(scene, 0)).toBe(true);
  });

  it("inherits down the parent chain", () => {
    const scene = createScene();
    const root = addNode(scene, node({ hidden: true }));
    const mid = addNode(scene, node({ parent: root }));
    const leaf = addNode(scene, node({ parent: mid, mesh: box(1) }));
    expect(isVisible(scene, leaf)).toBe(false);
    scene.nodes[root].hidden = false;
    expect(isVisible(scene, leaf)).toBe(true);
  });

  it("does not make a hidden child visible because its parent is shown", () => {
    const scene = createScene();
    const root = addNode(scene, node());
    const leaf = addNode(scene, node({ parent: root, hidden: true }));
    expect(isVisible(scene, leaf)).toBe(false);
  });
});

describe("findNode", () => {
  it("finds by name and reports −1 when absent", () => {
    const scene = createScene();
    addNode(scene, node({ name: "hips" }));
    addNode(scene, node({ name: "head" }));
    expect(findNode(scene, "head")).toBe(1);
    expect(findNode(scene, "tail")).toBe(-1);
  });
});

describe("createScene", () => {
  it("seeds a light, so a first scene is not black", () => {
    expect(createScene().lights).toHaveLength(1);
  });

  it("is transparent by default, so a viewport blends into its panel", () => {
    expect(createScene().background[3]).toBe(0);
  });

  it("is JSON round-trippable — the scene is plain data", () => {
    // Hot-reload state saving and snapshots both depend on this.
    const scene = createScene();
    addNode(scene, node({ name: "a", position: { x: 1, y: 2, z: 3 } }));
    const clone = JSON.parse(JSON.stringify({ ...scene, nodes: scene.nodes })) as typeof scene;
    expect(clone.nodes[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(clone.nodes[0].rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
