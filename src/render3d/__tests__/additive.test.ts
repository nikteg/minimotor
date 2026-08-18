/** `Material.additive`: light added to the frame rather than blended over it.
 *
 * The two backends have to agree on the blend factors, for the same reason
 * `shading.test.ts` checks they agree on the shading maths — a scene is
 * expected to render the same whichever one the browser hands you, and a
 * factor changed in one and not the other is silent. Read as source text,
 * since there is no GPU here.
 *
 * The rule in both: the source stays premultiplied, so only what happens to
 * the DESTINATION changes — `one-minus-src-alpha` covers, `one` adds. Alpha
 * keeps `one-minus-src-alpha` either way, because the accumulated coverage of
 * a premultiplied target is the same question whatever the colour does.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

describe("additive blending", () => {
  it("adds the colour and keeps the premultiplied source in WebGL2", () => {
    expect(read("webgl2.ts")).toMatch(
      /if \(additive\) gl!\.blendFuncSeparate\(gl!\.ONE, gl!\.ONE, gl!\.ONE, gl!\.ONE_MINUS_SRC_ALPHA\)/,
    );
  });

  it("adds the colour and keeps the premultiplied source in WebGPU", () => {
    expect(read("webgpu.ts")).toMatch(
      /srcFactor: "one",\s*dstFactor: additive \? "one" : "one-minus-src-alpha"/,
    );
    expect(read("webgpu.ts")).toMatch(
      /alpha: \{ srcFactor: "one", dstFactor: "one-minus-src-alpha" \}/,
    );
  });

  it("keeps additive surfaces in the ordinary blended pass", () => {
    // Addition commutes, so an additive surface needs no sorting of its own
    // and no pass of its own; WebGL2 switches the function per node inside the
    // blended pass and WebGPU keys a pipeline on it.
    expect(read("webgl2.ts")).toMatch(/if \(!!material\.additive !== additive\)/);
    expect(read("webgpu.ts")).toMatch(/\$\{occluded\}:\$\{additive\}/);
  });

  it("never ghosts additively", () => {
    // `occludedAlpha` is a hint about where something is, not a light.
    expect(read("webgpu.ts")).toMatch(/!ghost && !!material\.additive/);
    expect(read("webgl2.ts")).toMatch(/setBlendMode\(false\);\s*\n\s*for \(const i of occluded\)/);
  });
});
