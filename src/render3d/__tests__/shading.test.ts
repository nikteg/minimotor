/** The two backends have to agree on the shading maths.
 *
 * A renderer test that draws something needs a GPU, and there is not one here,
 * so this reads the two shader sources as TEXT and asserts that the numbers in
 * them match. That is a weak test of "the shader is right" and a strong test of
 * the thing that actually goes wrong: someone changes the tone curve, the
 * Lambert normalization or the sRGB pair in one backend and not the other, and
 * WebGL2 and WebGPU quietly stop drawing the same frame. Text matching catches
 * exactly that and nothing else, which is the intent.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createScene } from "../scene.js";

// From the project root, which is where vitest runs. `import.meta.url` is
// rewritten by the transform and does not point at the file on disk.
const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

const webgl2 = read("webgl2.ts");
const webgpu = read("webgpu.ts");
const backends: readonly (readonly [string, string])[] = [
  ["webgl2", webgl2],
  ["webgpu", webgpu],
];

describe("the two backends' shading maths", () => {
  it.each(backends)("%s carries the ACES coefficients", (_name, source) => {
    // Narkowicz's fit. All five, because a typo in one is a curve that still
    // looks plausible in isolation and differs from the other backend.
    for (const coefficient of ["2.51", "0.03", "2.43", "0.59", "0.14"]) {
      expect(source).toContain(coefficient);
    }
    // The clamp is part of the fit, not a safety rail.
    expect(source).toMatch(/min\((?:color|colorIn), vec3f?\(8\.0\)\)/);
  });

  it.each(backends)("%s uses the same sRGB pair in both directions", (_name, source) => {
    expect(source).toMatch(/srgbToLinear[\s\S]{0,60}c \* c/);
    expect(source).toMatch(/linearToSrgb[\s\S]{0,60}sqrt\(c\)/);
  });

  it.each(backends)("%s divides the diffuse term by pi under tone mapping", (_name, source) => {
    expect(source).toContain("0.31830988");
  });

  it.each(backends)("%s blends the hemisphere off the normal's Y", (_name, source) => {
    expect(source).toMatch(/mix\(\s*(?:u|frame\.)[Aa]mbient(?:\.rgb)?,\s*(?:u|frame\.)?[Aa]mbientGround(?:\.rgb)?,\s*max\(1e-6, 0\.5 - n\.y \* 0\.5\)\)/);
  });

  it.each(backends)("%s gives the tone-mapped specular all four fixes", (_name, source) => {
    // A white, unnormalized, N·L-free Blinn highlight is survivable when a
    // light's intensity is near 1 and ruinous when it is an illuminance: it
    // lays a flat sheen over the frame and drains the colour out of anything
    // saturated. Tinted, by METALNESS and not by the reflectance term…
    expect(source).toMatch(
      /mix\(vec3f?\(0\.08 \* (?:uSpecular|draw\.params\.w)\), base\.rgb, (?:uMetallic|draw\.rimAlpha\.w)\)/,
    );
    // …shaped by GGX rather than by an exponent…
    expect(source).toMatch(/ggxMobile\(roughness, noh, halfway, n\)/);
    expect(source).toContain("roughness * 0.25 + 0.25");
    // …run through the environment BRDF, all five of whose constants matter…
    for (const constant of ["-0.0275", "-0.572", "0.022", "0.0425", "-9.28"]) {
      expect(source).toContain(constant);
    }
    // …and gated on N·L, which is the term that was missing entirely.
    expect(source).toMatch(/ndl \* reflectance/);
    // A metal has no diffuse — again keyed on metalness, which is the whole
    // reason the two fields are separate: a hand-authored material that set
    // `specular` to mean "shiny" must not lose its diffuse for saying so.
    expect(source).toMatch(/1\.0 - (?:uMetallic|draw\.rimAlpha\.w)/);
  });

  it.each(backends)("%s inverts the loader's roughness mapping exactly", (_name, source) => {
    // `shininess = 2 ** (7 * (1 - roughness) + 1)` in `gltf.ts`, so the way
    // back is `1 - (log2(s) - 1) / 7`. If the two drift, a document's
    // roughness stops being the roughness the lobe is built from.
    expect(source).toMatch(/1\.0 - \(log2\(max\(shininess, 1e-6\)\) - 1\.0\) \/ 7\.0/);
  });

  it.each(backends)("%s keeps Blinn-Phong on the direct model", (_name, source) => {
    // The GGX lobe is opt-in with the rest of the physical mode. Every scene
    // that never asked for tone mapping shades exactly as it did.
    expect(source).toMatch(/pow\(noh, (?:uShininess|draw\.params\.x)\)/);
  });

  it("keeps the 1/pi off the direct model", () => {
    // The scale is selected on the tone-mapping flag in both backends rather
    // than applied unconditionally. Without this, turning tone mapping OFF
    // would still darken every existing scene by a third.
    expect(webgl2).toContain("uToneMap ? 0.31830988 : 1.0");
    expect(webgpu).toContain("select(1.0, 0.31830988, toneMap)");
  });

  it("fogs before the curve in both", () => {
    // Fog mixed in AFTER the tone map would be a different image: the fog
    // colour would skip the shoulder that everything it is blending with went
    // through.
    const order = (source: string): boolean => {
      const fog = source.indexOf("fogVisibility(");
      const tone = source.lastIndexOf("acesToneMap(");
      return fog > 0 && tone > fog;
    };
    expect(order(webgl2)).toBe(true);
    expect(order(webgpu)).toBe(true);
  });
});

describe("the two backends' framebuffers", () => {
  it("antialiases by default in both", () => {
    // Same weak-but-targeted trick as the shading checks above, for the same
    // reason: the difference between an antialiased frame and a hard-edged one
    // is one of the most visible ways the two backends can drift apart, and
    // WebGL2 gets it from a single context attribute while WebGPU has to build
    // it out of four agreeing pieces. Miss any one and the pass either fails
    // validation or quietly stops resolving.
    expect(webgl2).toContain("antialias: opts.antialias ?? true");
    expect(webgpu).toMatch(/sampleCount = opts\.antialias === false \? 1 : 4/);
    expect(webgpu).toContain("multisample: { count: sampleCount }");
    expect(webgpu).toMatch(/resolveTarget: colorTexture \?/);
    // The colour target and the depth target, which a pass rejects unless they
    // agree.
    expect(webgpu.match(/^ +sampleCount,$/gm) ?? []).toHaveLength(2);
  });
});

describe("the two backends' mesh caching", () => {
  it("re-uploads a mesh whose version moved, in both", () => {
    // Meshes are cached against the `MeshData` object's identity, so a mesh
    // rebuilt in place — a particle batch, a stroked path — looks unchanged
    // and would keep drawing its first upload forever. Both backends have to
    // honour the opt-out, or a caller gets animation on one and a still on the
    // other, which reads as a content bug rather than a backend one.
    for (const [name, source] of backends) {
      expect(source, name).toContain("cached.version === mesh.version");
      expect(source, name).toContain("if (cached) releaseMesh(cached);");
      expect(source, name).toContain("version: mesh.version,");
    }
  });

  it("frees the old buffers rather than leaking them, in both", () => {
    // A rebuild per frame leaks a whole mesh per frame if the old handles are
    // dropped instead of destroyed, which is the kind of thing that only shows
    // up an hour into a session.
    expect(webgl2).toMatch(/function releaseMesh\(gpu: GpuMesh\): void \{[\s\S]*?deleteVertexArray/);
    expect(webgpu).toMatch(/function releaseMesh\(gpu: GpuMesh\): void \{[\s\S]*?positions\.destroy\(\)/);
  });
});

describe("Scene3D's shading fields", () => {
  it("leaves a fresh scene on the direct model", () => {
    // Opting in is the whole point: every scene that existed before this
    // renders exactly as it did.
    const scene = createScene();
    expect(scene.toneMapping).toBeUndefined();
    expect(scene.ambientGround).toBeUndefined();
  });
});
