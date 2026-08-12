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

describe("Scene3D's shading fields", () => {
  it("leaves a fresh scene on the direct model", () => {
    // Opting in is the whole point: every scene that existed before this
    // renders exactly as it did.
    const scene = createScene();
    expect(scene.toneMapping).toBeUndefined();
    expect(scene.ambientGround).toBeUndefined();
  });
});
