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
 *
 * `detailUvScale` is a HORIZONTAL/VERTICAL pair, not a per-plane one, so the
 * ground plane takes `s.xx` while the upright pair takes `s`. Reading it as
 * "the second axis of whichever plane" stretched a wall's top cap by the ratio
 * of the two and made it read at a different size from the sides right beside
 * it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detailProjectionMode, detailWorldStep } from "../scene.js";
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
    // Both spell the snapped position `detailPos`, which is the world position
    // itself whenever `detailWorldStep` is off.
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      // `zy` for an X-facing wall, `xz` for the ground, `xy` for a Z-facing
      // wall. Swapping either upright pair turns a wall's pattern on its side.
      expect(source, name).toContain("detailPos.zy * s + o");
      // The ground plane takes the HORIZONTAL scale on both of its axes.
      expect(source, name).toContain("detailPos.xz * s.xx + o");
      expect(source, name).toContain("detailPos.xy * s + o");
      expect(source, name).toMatch(/axis\.x[\s\S]{0,200}axis\.y[\s\S]{0,200}axis\.z/);
    }
  });

  it("snaps the projected sample position to detailWorldStep, and only then", () => {
    // A projection reads a continuous position, so `pixelated` alone cannot
    // give a pattern blocks of a chosen SIZE — it quantizes texels, which at
    // any real tiling are far finer than a pixel-art surface wants.
    expect(detailWorldStep({} as Material)).toBe(0);
    // Meaningless under the mesh's own uv, which has no world position.
    expect(detailWorldStep({ detailWorldStep: 0.34 } as Material)).toBe(0);
    expect(
      detailWorldStep({ detailUvProjection: "triplanar", detailWorldStep: 0.34 } as Material),
    ).toBeCloseTo(0.34, 10);
    expect(
      detailWorldStep({ detailUvProjection: "planarXZ", detailWorldStep: 0.5 } as Material),
    ).toBe(0.5);
    // A negative or non-finite step would ceil() the position to nothing.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        detailWorldStep({ detailUvProjection: "triplanar", detailWorldStep: bad } as Material),
        String(bad),
      ).toBe(0);
    }
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      // `ceil`, not `floor` or `round`: the block a position lands in has to
      // match the engine this was ported from, and the three disagree by half
      // a block, which shifts every edge in the pattern.
      expect(read(name), name).toMatch(/ceil\((in\.worldPos|vWorldPos)/);
    }
  });

  it("keeps the normal map on the mesh uv under a planar albedo projection", () => {
    // A tangent-space normal map's vectors are expressed in the frame the
    // unwrap builds. Re-project it and its BUMP LAYOUT draws as if it were
    // albedo — which is exactly how a lilac-blue sheet ends up visible as a
    // pattern of plates and strips on a floor.
    expect(read("webgl2.ts")).toContain("vec2 normalUv = uUvProjection == 0 ? uv : vUv;");
    expect(read("webgl2.ts")).toContain("applyNormalMap(n, normalUv)");
    expect(read("webgpu.ts")).toContain(
      "let normalUv = select(uv, in.uv, draw.skinParams.w > 0.5)",
    );
    expect(read("webgpu.ts")).toContain("applyNormalMap(n, in.worldPos, normalUv");
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
    expect(read("webgl2.ts")).toContain("uDetailProjection == 1 ? detailPos.xz");
    expect(read("webgpu.ts")).toContain("draw.detail.w > 0.5 && draw.detail.w < 1.5");
  });
});
