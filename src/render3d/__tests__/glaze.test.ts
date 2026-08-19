/** `Material.glaze` and `Material.settle`: a faked reflective coat, and a wash
 * laid on by orientation and height.
 *
 * Two things are worth testing here and they are not the same thing.
 *
 * **The resolvers**, because they are where "off" is decided. `glazeParallax`
 * in particular is not a tidy-up: the parallax term re-samples the material's
 * OWN `texture`, and a material that has none fails DIFFERENTLY on the two
 * backends — WebGL2's sampler uniform sits at texture unit 0 and reads whatever
 * the previous draw left bound there, so it changes with draw order, while
 * WebGPU reads its 1x1 blank and comes back white. Neither raises an error and
 * neither looks like a bug in a still frame. That is the shape of fault that
 * once switched a whole course's detail blend off by handing a material a
 * sampler nobody had configured, and the answer to it is that the resolution
 * lives in one place neither backend can skip.
 *
 * **The two shader sources**, because a scene is expected to render the same
 * whichever backend the browser hands you, and there is no GPU here to compare
 * them on. Read as source text, the way `triplanar.test.ts` and
 * `additive.test.ts` do. The `glazeWave`/`glazeRipple` helpers are compared
 * MECHANICALLY rather than by a list of `toContain`s, because they are nothing
 * but magic numbers and a coefficient that drifted in one backend and not the
 * other is exactly the failure this pair cannot otherwise see.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { glazeGrid, glazeParallax, glazeStrength, settleActive } from "../scene.js";
import type { Material } from "../scene.js";

const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

/** A stand-in for a bound albedo. Only its presence is ever read. */
const TEXTURE = {} as unknown as TexImageSource;

/** Pull one function body out of a shader source by name. Both sources spell a
 * declaration differently and neither is parsed — the body between the `{` that
 * opens the DECLARATION and the matching close is all this needs.
 *
 * The declaration, specifically, and not the first mention. A plain
 * `indexOf(name + "(")` finds `glazeWave(16)` in the prose that adds up the
 * WebGPU draw block's bytes, some two hundred lines above the function, and
 * then walks to the first `{` after it — which is the `Frame` uniform struct.
 * The comparison below is between two bodies, so that failure does not read as
 * "the wrong text was extracted"; it reads as the two backends having drifted,
 * which is the one thing this file exists to detect. Anchoring on the `fn` or
 * on the return type is what tells a real drift from a stray mention. */
function body(source: string, name: string): string {
  const declaration = new RegExp(String.raw`(?:^|\n)(?:fn|float|vec[234]f?)\s+${name}\s*\(`);
  const found = declaration.exec(source);
  expect(found, `${name} is not declared`).not.toBeNull();
  const at = found!.index;
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${name}`);
}

/** The same body with everything that is merely SPELLING removed, so what is
 * left is the arithmetic. GLSL declares a type and WGSL says `let`; GLSL writes
 * `vec2(` where WGSL writes `vec2f(`. Neither difference can change a pixel,
 * and every difference that survives this can. */
function arithmetic(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\bvec([234])f\(/g, "vec$1(")
    .replace(/\b(?:float|let|var)\s+/g, "")
    .replace(/\bvec[234]\s+(?=\w+\s*=)/g, "")
    .replace(/\s+/g, "");
}

describe("Material.glaze", () => {
  it("treats every way of not having a coat as strength zero", () => {
    expect(glazeStrength({} as Material)).toBe(0);
    expect(glazeStrength({ glaze: { strength: 0 } } as Material)).toBe(0);
    // A negative or non-finite strength would multiply the coat into the
    // surface backwards, or take the whole pixel to NaN and discard it.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(glazeStrength({ glaze: { strength: bad } } as Material), String(bad)).toBe(0);
    }
    expect(glazeStrength({ glaze: { strength: 0.4 } } as Material)).toBeCloseTo(0.4, 10);
    // Clamped at the top, so a caller tweening past 1 cannot blow the coat out.
    expect(glazeStrength({ glaze: { strength: 4 } } as Material)).toBe(1);
  });

  it("REFUSES a parallax offset to a material with no texture to re-sample", () => {
    // The guard this function exists for. Both of these ask for the same 0.4.
    expect(glazeParallax({ glaze: { strength: 1, parallax: 0.4 } } as Material)).toBe(0);
    expect(
      glazeParallax({ texture: TEXTURE, glaze: { strength: 1, parallax: 0.4 } } as Material),
    ).toBeCloseTo(0.4, 10);
    // And a material that HAS a texture but asked for no offset still skips the
    // fetch, which is what keeps the coat affordable on a plain surface.
    expect(glazeParallax({ texture: TEXTURE, glaze: { strength: 1 } } as Material)).toBe(0);
    expect(
      glazeParallax({ texture: TEXTURE, glaze: { strength: 1, parallax: Number.NaN } } as Material),
    ).toBe(0);
  });

  it("gates the extra fetch on that resolved offset in both backends", () => {
    // Not on `parallax` as authored, and not on `texture` separately: one test,
    // resolved in one place, read the same way twice.
    expect(read("webgl2.ts")).toContain("if (uGlaze.z != 0.0) {");
    expect(read("webgpu.ts")).toContain("if (draw.glaze.z != 0.0) {");
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      expect(read(name), name).toContain("glazeParallax(material)");
      // The whole coat hangs off the resolver too, never off `material.glaze`.
      expect(read(name), name).toContain("glazeStrength(material)");
    }
  });

  it("takes the coat's one sample UP with the base texture read", () => {
    // WGSL permits an implicit-derivative sample only in uniform control flow,
    // and applyNormalMap() returns early inside a branch on a derivative — so a
    // sample after that call does not compile. WebGL2 does not need the split
    // and takes it anyway, because two backends with two shapes are two
    // backends that will stop drawing the same frame.
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      const sample = source.indexOf("glazeUnder = texture");
      const sampleWgsl = source.indexOf("glazeUnder = textureSample");
      const at = Math.max(sample, sampleWgsl);
      expect(at, name).toBeGreaterThan(-1);
      // The sample comes before the normal-map call, in both.
      const normalCall = source.indexOf("= applyNormalMap(");
      expect(normalCall, name).toBeGreaterThan(at);
    }
  });

  it("computes the same ripple in GLSL and in WGSL, coefficient for coefficient", () => {
    // The mechanical comparison. These two bodies are pure arithmetic over
    // magic numbers, so a drifted 0.63 is invisible to a reader and to every
    // other test in this repo.
    // `glazeSnap` is in this list for a reason that is not obvious: the natural
    // way to write it is a GLSL ternary against a WGSL select(), which is two
    // texts for one calculation and would fail here forever. It is branch-free
    // in both instead, and this assertion is what holds it that way.
    for (const fn of ["glazeWave", "glazeRipple", "glazeSnap", "glazeStreakAt"] as const) {
      expect(arithmetic(body(read("webgl2.ts"), fn)), fn).toBe(
        arithmetic(body(read("webgpu.ts"), fn)),
      );
    }
  });

  it("uses no transcendental in that ripple, on purpose", () => {
    // Not a style rule. The two backends are required to draw the same frame,
    // and a transcendental is the one thing two compilers and two drivers are
    // free to round differently in the last bits.
    for (const fn of ["glazeWave", "glazeRipple", "glazeSnap", "glazeStreakAt"] as const) {
      for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
        expect(body(read(name), fn), `${name} ${fn}`).not.toMatch(/\b(sin|cos|tan|exp|log)\s*\(/);
      }
    }
  });

  it("weights the faked sky and what is under it as complements", () => {
    // The sky takes over at a grazing angle; what is under the ice shows
    // head-on. Both riding the Fresnel the same way is the mistake that makes a
    // frozen surface read as a decal at every angle.
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      expect(source, name).toContain("0.25 + 0.75 * sky * sky");
      expect(source, name).toContain("lobe8 * 1.5");
      // The two weights, read separately rather than as one expression: item 356
      // split the coat so a PLANAR mirror could be mixed in between them without
      // being attenuated by the faked sky's Fresnel — see Glaze.planarStrength. The
      // claim here is unchanged and is about the two weights being complements, not
      // about them sitting on one line.
      expect(source, name).toContain("env * (0.25 + 0.75 * fresnel)");
      expect(source, name).toContain("under * (1.0 - fresnel) * 0.5");
    }
  });

  it("REFUSES a streak that has no period to divide by", () => {
    // The gate that matters most in this resolver, and the reason the four
    // numbers are packed in one place rather than read field by field in each
    // backend. The shader divides `x + z` by the period, so an amount with no
    // period is not a faint diagonal: it is a NaN across every pixel of the coat,
    // on a surface whose whole job is to be looked at.
    const asked = { glaze: { strength: 1, streak: 0.5 } } as Material;
    expect(glazeGrid(asked)[1]).toBe(0);
    expect(glazeGrid(asked)[2]).toBe(0);
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const m = { glaze: { strength: 1, streak: 0.5, streakPeriod: bad } } as Material;
      expect(glazeGrid(m)[1], String(bad)).toBe(0);
      expect(glazeGrid(m)[2], String(bad)).toBe(0);
    }
    const good = {
      glaze: { strength: 1, streak: 0.5, streakPeriod: 3.125, streakDrag: 2.2 },
    } as Material;
    expect(glazeGrid(good)[1]).toBeCloseTo(0.5, 10);
    expect(glazeGrid(good)[2]).toBeCloseTo(3.125, 10);
    expect(glazeGrid(good)[3]).toBeCloseTo(2.2, 10);
    // And the drag is only carried while there is a streak to drag: it is the
    // one of the four that does nothing on its own, so leaving it set would put
    // a number in the uniform that no frame can account for.
    expect(glazeGrid({ glaze: { strength: 1, streakDrag: 2.2 } } as Material)[3]).toBe(0);
  });

  it("treats every way of not having a block grid as no grid", () => {
    expect(glazeGrid({} as Material)[0]).toBe(0);
    // A zero step is the off case and a negative one snaps the wrong way; both
    // reach a ceil(p / step) that the shader has to be able to survive.
    for (const bad of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(glazeGrid({ glaze: { worldStep: bad } } as Material)[0], String(bad)).toBe(0);
    }
    expect(glazeGrid({ glaze: { worldStep: 0.390625 } } as Material)[0]).toBeCloseTo(0.390625, 10);
    // The grid is independent of the streak: quantising the ripple and the grain
    // is worth having on a coat that draws no diagonal at all.
    expect(glazeGrid({ glaze: { worldStep: 0.5 } } as Material)).toEqual([0.5, 0, 0, 0]);
  });

  it("puts the diagonal in the faked SKY and nowhere else, in both backends", () => {
    // The whole of item 334. A pattern added to `env` rides the Fresnel and the
    // reflected ray, so it slides as the camera orbits and a still surface has
    // none of it. The same pattern baked into the albedo appears TWICE — once in
    // the parallax sample and once lying flat on the floor — which is what the
    // owner saw and disliked.
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      const streak = source.search(/env \+= (u|draw\.)[Gg]lazeTint\.rgb \* glazeStreak;/);
      expect(streak, name).toBeGreaterThan(-1);
      // Never into what is UNDER the ice, which is the term that does not fade.
      expect(source, name).not.toMatch(/glazeUnder \s*[+]?=[^;]*glazeStreak/);
      // And its position comes off the reflected ray, not off the fragment.
      expect(source, name).toMatch(
        /(in\.worldPos|vWorldPos)\.xz \+ bounce \* (u|draw\.)[Gg]lazeGrid\.w/,
      );
    }
  });

  it("snaps the coat's POSITION and never its phase", () => {
    // Item 325's owner feedback, as an assertion: quantised in SPACE, continuous
    // in VALUE. A snapped phase reads as a stutter rather than as pixel art, and
    // it is the one thing that was explicitly rejected. So `glazeSnap` is applied
    // to the three positions and to no scroll phase anywhere.
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      // The declaration is `vec2 glazeSnap(` in GLSL and `fn glazeSnap(` in WGSL;
      // everything else is a call site.
      const calls = source.match(/(?<!(?:vec2|fn) )glazeSnap\(/g) ?? [];
      // The ripple, the grain and the streak. Not the phase.
      expect(calls.length, name).toBe(3);
      expect(source, name).not.toMatch(/glazeSnap\([^)]*glaze\.w/);
    }
  });

  it("keeps the WebGPU draw block's field count and its joint offset in step", () => {
    // The failure this catches: `glazeGrid` was INSERTED rather than appended, so
    // four float offsets below it had to move. The header's own byte sum had
    // already drifted 16 bytes light before that — one vec4 the prose had dropped
    // while the offsets had not — so the prose cannot be the authority here. The
    // struct is.
    const source = read("webgpu.ts");
    const struct = /struct DrawData \{([\s\S]*?)\n\};/.exec(source);
    expect(struct).not.toBeNull();
    const vec4s = (struct![1].match(/:\s*vec4f\s*,/g) ?? []).length;
    const mat4s = (struct![1].match(/:\s*mat4x4f\s*,/g) ?? []).length;
    // Bytes before the joints: one model matrix and every vec4 after it.
    const bytes = mat4s * 64 + vec4s * 16;
    const joints = /drawData\.set\(skin \?\? IDENTITY_JOINTS, at \+ (\d+)\)/.exec(source);
    expect(joints).not.toBeNull();
    expect(Number(joints![1]) * 4).toBe(bytes);
    // And the whole slot still fits the stride it is padded to.
    expect(bytes + 64 * 64).toBeLessThanOrEqual(4608);
  });

  it("reflects the scene's OWN first light rather than a direction of its own", () => {
    // What makes the glint sweep as the camera turns, and what keeps the
    // reflection agreeing with the scene it is in. A scene with no lights has
    // nothing to reflect, and straight up adds no lobe anywhere.
    expect(read("webgl2.ts")).toContain("uLightCount > 0 ? -normalize(uLightDir[0])");
    expect(read("webgpu.ts")).toContain("-normalize(frame.lightDir[0].xyz)");
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      expect(read(name), name).toMatch(/reflect\(-toEye, glazeNormal\)/);
    }
  });
});

describe("Material.settle", () => {
  it("is inactive when there is nothing to lay on", () => {
    expect(settleActive({} as Material)).toBe(false);
    expect(settleActive({ settle: { color: [1, 1, 1] } } as Material)).toBe(false);
    // A rise with no amount, and an amount with no height, are both half a
    // configuration — neither draws anything and both would cost the branch.
    expect(settleActive({ settle: { color: [1, 1, 1], rise: 2 } } as Material)).toBe(false);
    expect(settleActive({ settle: { color: [1, 1, 1], riseAmount: 0.5 } } as Material)).toBe(false);
    expect(settleActive({ settle: { color: [1, 1, 1], up: 0.5 } } as Material)).toBe(true);
    expect(
      settleActive({ settle: { color: [1, 1, 1], rise: 2, riseAmount: 0.5 } } as Material),
    ).toBe(true);
  });

  it("keys the wash on the normal's Y and on world height, in both backends", () => {
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      // Up-facing: the exponent is `upSharpness`, and it is the whole of "snow
      // settles on the top".
      expect(source, name).toMatch(/pow\(max\(settleN\.y, 0\.0\), (u|draw\.)[Ss]ettle2?\.x\)/);
      // And the climb from a ground line, which is what ties a wall to the
      // floor it stands on. Spelled `uSettle2` in GLSL and `draw.settle2` in
      // WGSL, so the case is the one thing this cannot pin.
      expect(source, name).toMatch(/(u|draw\.)[Ss]ettle2\.y/);
      // max(), not a sum: a wall's foot and its cap are the same snow seen
      // twice, and adding them drives the corner past white.
      expect(source, name).toContain("max(top, foot)");
    }
  });

  it("is albedo — applied before the light, never after it", () => {
    // A snow cap that did not take the scene's own lighting reads as a sticker.
    for (const name of ["webgl2.ts", "webgpu.ts"] as const) {
      const source = read(name);
      const settled = source.indexOf("max(top, foot)");
      const lighting = source.search(/albedo\s*[*]\s*lit|= albedo \* lit/);
      expect(settled, name).toBeGreaterThan(-1);
      expect(lighting, name).toBeGreaterThan(settled);
      // While the glaze, which is LIGHT, is added after it.
      const coat = source.indexOf("0.25 + 0.75 * fresnel");
      expect(coat, name).toBeGreaterThan(lighting);
    }
  });
});
