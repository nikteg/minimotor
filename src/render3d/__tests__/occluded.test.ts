/** `Material.occludedAlpha`: the ghost pass that shows a covered object.
 *
 * Drawing something the terrain is in front of is a two-line change in one
 * backend and a pipeline variant in the other, and the failure mode when they
 * drift is that a scene reads differently depending on which backend the
 * browser gave you. So this checks the RULE in three places: the shared
 * material the two of them ghost with, and the depth state each one sets.
 *
 * The depth state is read as source text, for the same reason `shading.test.ts`
 * reads the shaders that way — there is no GPU here. It is a weak test of "the
 * pass is right" and a strong test of "the two passes are the same pass",
 * which is the thing that actually goes wrong.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ghostMaterial } from "../scene.js";

const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

describe("the material a ghost draws with", () => {
  it("scales the alpha it was authored with rather than replacing it", () => {
    const ghost = ghostMaterial({ color: [1, 0, 0, 0.8], occludedAlpha: 0.25 });
    expect(ghost.color).toEqual([1, 0, 0, 0.2]);
    // A surface that was already faint gives a fainter ghost, which is the
    // reading that composes: `occludedAlpha` is how much of ITSELF shows
    // through, not an absolute opacity.
    expect(ghostMaterial({ color: [1, 1, 1, 1], occludedAlpha: 0.25 }).color?.[3]).toBe(0.25);
  });

  it("blends whatever the node did, and does not ghost itself", () => {
    const ghost = ghostMaterial({ occludedAlpha: 0.3, shininess: 40 });
    expect(ghost.transparent).toBe(true);
    expect(ghost.occludedAlpha).toBe(0);
    // Everything else about the surface is kept: it is the same object seen
    // through a wall, not a different one.
    expect(ghost.shininess).toBe(40);
  });
});

describe("both backends", () => {
  it("reverse the depth test rather than switching it off", () => {
    // Depth off would paint the whole surface over the scene and lose the cue
    // entirely — the object would read as being IN FRONT of the wall.
    expect(read("webgl2.ts")).toMatch(/depthFunc\(gl!\.GREATER\)/);
    expect(read("webgpu.ts")).toMatch(/depthCompare: occluded \? "greater"/);
  });

  it("keep depth writes off for the ghost", () => {
    // A hint that wrote depth would occlude the geometry doing the occluding.
    expect(read("webgl2.ts")).toMatch(/depthFunc\(gl!\.GREATER\);[\s\S]{0,200}depthMask\(false\)/);
    expect(read("webgpu.ts")).toMatch(/depthWriteEnabled: depthOnly \|\| \(!blend && !occluded/);
  });

  it("draw the ghost after the blended pass and before the overlays", () => {
    // It blends over whatever is covering the node; an overlay is meant to sit
    // above everything, including this.
    const webgl2 = read("webgl2.ts");
    expect(webgl2.indexOf("if (occluded.length > 0)")).toBeGreaterThan(
      webgl2.indexOf("if (blended.length > 0)"),
    );
    expect(webgl2.indexOf("if (occluded.length > 0)")).toBeLessThan(
      webgl2.indexOf("if (overlay.length > 0)"),
    );
    expect(read("webgpu.ts")).toContain(
      "const order = [...opaque, ...blended.map((b) => b.index), ...occluded, ...overlay];",
    );
  });

  it("leave an overlay alone, which is already drawn over everything", () => {
    for (const backend of ["webgl2.ts", "webgpu.ts"]) {
      expect(read(backend)).toMatch(
        /\(n\.material\?\.occludedAlpha \?\? 0\) > 0 && n\.material\?\.depthTest !== false/,
      );
    }
  });
});

describe("occludedOnly: the ghost pass as a MASK", () => {
  /** A surface parked just under a floor and drawn only where that floor covers
   * it is cut out by the floor's own silhouette, per pixel — every edge, hole
   * and slope of it, with no geometry to deform and no rays to cast. A blob
   * shadow under a ball at the lip of a ledge is the worked case. */
  it("drops the ordinary pass in both backends and keeps the ghost", () => {
    for (const backend of ["webgl2.ts", "webgpu.ts"]) {
      const source = read(backend);
      // The ghost is collected first, and the early return that skips the
      // ordinary pass sits between it and the pass lists — so a masked node is
      // in `occluded` and in nothing else.
      const collect = source.indexOf("occluded.push(i)");
      const skip = source.indexOf("n.material?.occludedOnly");
      const overlay = source.indexOf("overlay.push(i)");
      expect(collect, `${backend} collects the ghost`).toBeGreaterThan(0);
      expect(skip, `${backend} honours the flag`).toBeGreaterThan(collect);
      expect(skip, `${backend} skips before the pass lists`).toBeLessThan(overlay);
    }
  });

  it("is gated on the ghost being there at all", () => {
    // Without `occludedAlpha` there is no ghost pass to keep, so a node that
    // asked for the mask alone would simply vanish. Both backends read the two
    // together.
    for (const backend of ["webgl2.ts", "webgpu.ts"]) {
      expect(read(backend)).toMatch(/if \(ghosting && n\.material\?\.occludedOnly\)/);
    }
  });
});
