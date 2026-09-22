/** `Renderer3D.blur` and `RenderOptions.include`: a post-pass blur with a sharp
 *  focus circle, and drawing part of a scene on top of it afterwards.
 *
 * The plan is pure and asserted as numbers. WebGL2 is driven against a
 * recording context, as in `overlay-occlusion.test.ts`, because what matters is
 * the SEQUENCE — resolve, halve, blur, composite, and depth left alone — and a
 * refactor that keeps it is free. WebGPU has no device here; its half is held
 * to the same passes by reading the shared WGSL as text.
 */
import { describe, expect, it } from "vitest";
import { addNode, createScene, node, updateWorldMatrices } from "../scene.js";
import { createCamera } from "../camera.js";
import { createWebGL2Renderer } from "../webgl2.js";
import {
  GLSL_COMPOSITE_FS,
  KERNEL_REACH,
  MAX_LEVEL,
  MAX_SIGMA,
  planBlur,
  subtreeOf,
  WGSL_BLUR,
} from "../blur.js";
import type { MeshData } from "../mesh.js";

interface GlCall {
  name: string;
  args: unknown[];
}

/** A WebGL2 context that records instead of rasterising — see
 *  `overlay-occlusion.test.ts`, which this is a copy of. */
function recordingGl(): { gl: WebGL2RenderingContext; calls: GlCall[] } {
  const calls: GlCall[] = [];
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
          if (value === undefined) values.set(property, (value = nextEnum++));
          return value;
        }
        return (...args: unknown[]): unknown => {
          calls.push({ name: property, args });
          return property.startsWith("create") || property.startsWith("get") ? {} : undefined;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

function mesh(triangles: number): MeshData {
  return { positions: new Float32Array(triangles * 9), indices: new Uint16Array(triangles * 3) };
}

function recorded() {
  const harness = recordingGl();
  const canvas = document.createElement("canvas");
  (canvas as unknown as { getContext: () => unknown }).getContext = () => harness.gl;
  const renderer = createWebGL2Renderer({ canvas, width: 400, height: 200, dpr: 2 });
  return { renderer, calls: harness.calls };
}

describe("planBlur", () => {
  it("does nothing for no radius", () => {
    expect(planBlur({ radius: 0 }, 800, 400, 1)).toBeNull();
    expect(planBlur({ radius: -3 }, 800, 400, 1)).toBeNull();
  });

  it("halves until σ fits the kernel, and keeps σ in physical pixels", () => {
    // 30 CSS px at dpr 2 is 60 physical: 60 → 30 → 15 → 7.5 → 3.75.
    const plan = planBlur({ radius: 30 }, 800, 400, 2)!;
    expect(plan.level).toBe(4);
    expect(plan.sigma).toBeCloseTo(3.75, 5);
    expect(plan.sigma).toBeLessThanOrEqual(MAX_SIGMA);
    expect(plan.reach).toBeLessThanOrEqual(KERNEL_REACH);
    expect(plan.sizes.map((size) => size.width)).toEqual([800, 400, 200, 100, 50]);
    // A small blur needs no halving at all.
    expect(planBlur({ radius: 2 }, 800, 400, 1)!.level).toBe(0);
    // And a huge one stops at the floor.
    expect(planBlur({ radius: 10_000 }, 800, 400, 1)!.level).toBe(MAX_LEVEL);
  });

  it("turns a focus into a sharp inner radius and a feathered outer one", () => {
    const plan = planBlur(
      { radius: 10, focus: { x: 5, y: 6, radius: 40, feather: 20 }, dim: 2 },
      800,
      400,
      1,
    )!;
    expect(plan.focus).toEqual({ x: 5, y: 6, inner: 40, outer: 60, curve: 1 });
    expect(plan.dim, "clamped").toBe(1);
    // No feather is a hard edge, not a division by zero in the smoothstep.
    const hard = planBlur({ radius: 10, focus: { x: 0, y: 0, radius: 40 } }, 800, 400, 1)!;
    expect(hard.focus!.outer).toBeGreaterThan(hard.focus!.inner);
  });

  it("carries the edge's curve, 1 by default and never zero", () => {
    const eased = planBlur(
      { radius: 10, focus: { x: 0, y: 0, radius: 4, curve: 3 } },
      800,
      400,
      1,
    )!;
    expect(eased.focus!.curve).toBe(3);
    const flat = planBlur({ radius: 10, focus: { x: 0, y: 0, radius: 4, curve: 0 } }, 800, 400, 1)!;
    expect(flat.focus!.curve).toBeGreaterThan(0);
  });
});

describe("subtreeOf", () => {
  it("takes a root and everything hung under it, and nothing beside it", () => {
    const scene = createScene();
    const root = addNode(scene, node({}));
    const child = addNode(scene, node({ parent: root }));
    const grandchild = addNode(scene, node({ parent: child }));
    const beside = addNode(scene, node({}));
    expect([...subtreeOf(scene, [root])].toSorted()).toEqual([root, child, grandchild]);
    expect(subtreeOf(scene, [root]).has(beside)).toBe(false);
  });
});

describe("RenderOptions.include", () => {
  it("draws only the nodes it accepts", () => {
    const { renderer, calls } = recorded();
    const scene = createScene();
    addNode(scene, node({ mesh: mesh(1) }));
    const kept = addNode(scene, node({ mesh: mesh(2) }));
    updateWorldMatrices(scene);
    renderer.render(scene, createCamera(), { include: (index) => index === kept });
    const drawn = calls.filter((call) => call.name === "drawElements").map((call) => call.args[1]);
    expect(drawn).toEqual([6]);
  });
});

describe("WebGL2 blur", () => {
  it("resolves, halves, blurs both ways and composites, leaving depth alone", () => {
    const { renderer, calls } = recorded();
    const from = calls.length;
    renderer.blur({ radius: 30, focus: { x: 200, y: 100, radius: 20, feather: 10 } });
    const pass = calls.slice(from);
    const plan = planBlur({ radius: 30 }, 800, 400, 2)!;
    expect(pass.filter((call) => call.name === "blitFramebuffer")).toHaveLength(1);
    // One draw per halving, two for the Gaussian, one composite.
    expect(pass.filter((call) => call.name === "drawArrays")).toHaveLength(plan.level + 3);
    // Depth is the scene's: never cleared, never written while the pass runs.
    expect(pass.some((call) => call.name === "clear")).toBe(false);
    const lastDraw = pass.map((call) => call.name).lastIndexOf("drawArrays");
    const masks = pass.slice(0, lastDraw).filter((call) => call.name === "depthMask");
    expect(masks.map((call) => call.args[0])).toEqual([false]);
    // The composite lands on the canvas: the last framebuffer bound before it
    // is the default one.
    const bound = pass.slice(0, lastDraw).filter((call) => call.name === "bindFramebuffer");
    expect(bound.at(-1)!.args[1]).toBeNull();
    // And the state `render` assumes is put back afterwards.
    expect(pass.slice(lastDraw).some((c) => c.name === "depthMask" && c.args[0] === true)).toBe(
      true,
    );
  });

  it("does nothing at all for no radius", () => {
    const { renderer, calls } = recorded();
    const from = calls.length;
    renderer.blur({ radius: 0 });
    expect(calls.slice(from)).toEqual([]);
  });
});

describe("the two backends' blur is the same blur", () => {
  it("has the same three fragment stages and the same composite", () => {
    for (const entry of ["fn copy", "fn gauss", "fn composite"]) expect(WGSL_BLUR).toContain(entry);
    // Mask and mix, in both: a focus circle smoothstepped from inner to outer,
    // and the dim applied to the blurred half only.
    for (const source of [GLSL_COMPOSITE_FS, WGSL_BLUR]) {
      expect(source).toMatch(/smoothstep\([^)]*\.z, [^)]*\.w, distance/);
      expect(source).toMatch(/\(1\.0 - [^)]*\)/);
      expect(source).toMatch(/mix\(sharp, blurred, mask\)/);
      // The curve, the same in both: 1 - (1 - s)^curve.
      expect(source).toMatch(/mask = 1\.0 - pow\(1\.0 - mask, [^)]+\);/);
    }
  });
});
