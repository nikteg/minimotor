/** `detailUvProjection: "triplanar"`: one pattern density on every face.
 *
 * The two backends have to agree on the projection the way `additive.test.ts`
 * makes them agree on blend factors — a scene is expected to render the same
 * whichever one the browser hands you, and a plane sampled from the wrong axis
 * pair in one and not the other is silent. Read as source text, since there is
 * no GPU here, plus the one piece of arithmetic that is not in a shader.
 *
 * The rule in both: the ground plane reads `xz`, the two upright planes read
 * `zy` and `xy`, and the weights are the world normal's components raised to
 * the eighth and normalized. The exponent is what makes the seams narrow, and
 * it is the number most likely to be "improved" by someone reading the blend
 * as a lerp — at 2 the band is the whole quadrant and every corner is mush.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detailProjectionMode } from "../scene.js";
import type { Material } from "../scene.js";

const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

describe("the triplanar detail projection", () => {
  it("resolves the same three modes for both backends", () => {
    // One helper, imported by both, so an unset value cannot come to mean
    // different things on the two paths.
    expect(detailProjectionMode({} as Material)).toBe(0);
    expect(detailProjectionMode({ detailUvProjection: "mesh" } as Material)).toBe(0);
    expect(detailProjectionMode({ detailUvProjection: "planarXZ" } as Material)).toBe(1);
    expect(detailProjectionMode({ detailUvProjection: "triplanar" } as Material)).toBe(2);
  });

  it("samples the same three world planes in GLSL and in WGSL", () => {
    // The two spell the varying differently — GLSL's `vWorldPos` against
    // WGSL's `in.worldPos` — so only the swizzle and the transform are shared.
    for (const [name, prefix] of [
      ["webgl2.ts", "vWorldPos"],
      ["webgpu.ts", "in.worldPos"],
    ] as const) {
      const source = read(name);
      // `zy` for an X-facing wall, `xz` for the ground, `xy` for a Z-facing
      // wall. Swapping either upright pair turns a wall's pattern on its side.
      expect(source, name).toContain(`${prefix}.zy * s + o`);
      expect(source, name).toContain(`${prefix}.xz * s + o`);
      expect(source, name).toContain(`${prefix}.xy * s + o`);
      expect(source, name).toMatch(/axis\.x[\s\S]{0,200}axis\.y[\s\S]{0,200}axis\.z/);
    }
  });

  it("weights the planes by the normal to the eighth, normalized", () => {
    expect(read("webgl2.ts")).toContain("pow(abs(normalize(vNormal)), vec3(8.0))");
    expect(read("webgpu.ts")).toContain("pow(abs(normalize(in.normal)), vec3f(8.0))");
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      // A face pointing exactly along a diagonal has three equal weights and
      // would otherwise sum to three; the guard is against the zero normal a
      // degenerate triangle produces, not against the sum.
      expect(read(name), name).toContain("axis.x + axis.y + axis.z, 1e-6");
    }
  });

  it("leaves the mask on the mesh uv, because nothing pairs the two", () => {
    // The mask is a planar-projection idea — it cuts a world-projected decal
    // canvas into shapes. There is no third projection for it to follow under
    // triplanar, so `detailSource` stays where it was and the mask reads that.
    expect(read("webgl2.ts")).toContain("uDetailProjection == 1 ? vWorldPos.xz");
    expect(read("webgpu.ts")).toContain("draw.detail.w > 0.5 && draw.detail.w < 1.5");
  });
});
