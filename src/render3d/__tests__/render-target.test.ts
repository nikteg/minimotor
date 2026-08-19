/** `Renderer3D.createTarget`: the two backends' offscreen surfaces, held
 * against each other.
 *
 * **What proves what, because this file alone is not much.** The behaviour of a
 * target — that pixels land in it, that the depth buffer works, that the
 * readback's first row is the top one, that the projection takes the target's
 * aspect and not the canvas's, that the context is left on the default
 * framebuffer — is measured on a real GPU by `e2e/render-target.spec.ts` over
 * `samples/render-target/`. Every claim there was checked by breaking the
 * backend and watching the test go red.
 *
 * That covers WebGL2 only, and not by choice: `navigator.gpu` is absent from
 * the headless Chromium the e2e suite drives, so there is no WebGPU frame on
 * this machine to compare against — the same measurement `glaze.spec.ts`
 * records. So what holds the WebGPU path to the tested one is this file, read
 * as source text in the way `occluded.test.ts` reads the depth state: a weak
 * test of "the pass is right" and a strong test of "the two passes are the same
 * pass", which is the thing that actually goes wrong.
 *
 * The one asymmetry below is deliberate and is the fault most likely to be
 * introduced by someone making the backends "consistent": GL's `readPixels`
 * hands back the BOTTOM row first and a WebGPU texture's origin is already
 * top-left, so the contract's top-row-first order means ONE of them flips. A
 * frame symmetric about the horizon cannot tell a correct flip from a missing
 * one or from two, which is why the sample's scene has a marker box above the
 * others in it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(resolve(process.cwd(), "src/render3d", name), "utf8");

const webgl2 = read("webgl2.ts");
const webgpu = read("webgpu.ts");

describe("both backends' render targets", () => {
  it("build the projection from the TARGET's aspect when there is one", () => {
    // Otherwise a square probe rendered by a wide renderer comes out stretched,
    // and it is invisible in anything but a shape a test measures.
    //
    // The rect's aspect takes precedence over the target's, which is the atlas
    // case — see `RenderOptions.viewport`. Both alternatives are named here so
    // that dropping either arm fails: a backend that forgot the rect stretches
    // every face of a probe, and one that forgot the target stretches the whole
    // probe.
    // Whitespace-tolerant because the ternary is long enough that the formatter
    // breaks it across lines in one backend and not the other.
    const wanted = /rect\s*\?\s*rect\.width \/ rect\.height/;
    const fallback = /offscreen\s*\?\s*offscreen\.width \/ offscreen\.height\s*:\s*width \/ height/;
    expect(webgl2).toMatch(wanted);
    expect(webgpu).toMatch(wanted);
    expect(webgl2).toMatch(fallback);
    expect(webgpu).toMatch(fallback);
  });

  it("give the target its own depth attachment", () => {
    // Without one the pass still draws, and the result is the scene composited
    // in node order — a picture that looks plausible until something passes
    // behind something else.
    expect(webgl2).toMatch(/DEPTH_COMPONENT16/);
    expect(webgl2).toMatch(/framebufferRenderbuffer\(gl\.FRAMEBUFFER, gl\.DEPTH_ATTACHMENT/);
    expect(webgpu).toMatch(/format: "depth24plus"/);
    expect(webgpu).toMatch(/depthStencilAttachment/);
  });

  it("size the target in physical pixels, at least one of them", () => {
    // `RenderTarget3D` says physical pixels and no dpr; a zero-sized attachment
    // is a validation error on one backend and an incomplete framebuffer on the
    // other, so both clamp.
    const clamp = /Math\.max\(1, Math\.round\(next[WH]\w*\)\)/;
    expect(webgl2).toMatch(clamp);
    expect(webgpu).toMatch(clamp);
  });

  it("skip a resize to the size they already are", () => {
    // Documented as cheap and idempotent so a caller tracking a widget's rect
    // may call it every frame; reallocating three textures per frame instead
    // would be a silent cost with no visible symptom.
    const idempotent = /if \(wanted === w && wantedH === h\) return;/;
    expect(webgl2).toMatch(idempotent);
    expect(webgpu).toMatch(idempotent);
  });

  it("refuse a target that belongs to the other renderer", () => {
    // A target is a framebuffer in one context. Handed to the other renderer it
    // can only be a miss, and a silent miss draws the whole frame to the canvas
    // instead — which looks exactly like the target feature never working.
    expect(webgl2).toMatch(/targets are per context/);
    expect(webgpu).toMatch(/targets are per device/);
  });

  it("release the target's memory rather than waiting for a collection", () => {
    // The type says so: unlike a mesh, a target holds attachments the GC cannot
    // see through.
    expect(webgl2).toMatch(/deleteFramebuffer\(framebuffer\)/);
    expect(webgl2).toMatch(/deleteTexture\(texture\)/);
    expect(webgl2).toMatch(/deleteRenderbuffer\(depth\)/);
    expect(webgpu).toMatch(/color\?\.destroy\(\)/);
    expect(webgpu).toMatch(/depth\?\.destroy\(\)/);
  });
});

describe("the readback's row order", () => {
  it("is flipped on WebGL2 and not on WebGPU", () => {
    // The one place the two differ on purpose. `readPixels` promises top row
    // first; GL's origin is bottom-left and WebGPU's is top-left, so making
    // these two "consistent" in either direction breaks one of them.
    expect(webgl2, "GL flips").toMatch(/flipped\.set\(\s*pixels\.subarray\(\(h - 1 - row\)/);
    const gpuReadback = webgpu.slice(webgpu.indexOf("async readPixels()"));
    expect(gpuReadback.slice(0, 1200), "WebGPU does not").not.toMatch(/h - 1 - row/);
  });
});

describe("the cube probe's atlas lookup", () => {
  it("flips the row on WebGL2 and NOT on WebGPU", () => {
    // **The asymmetry is the whole content of this test**, and it is the same one
    // the readback carries: `cubeProbeViews` lays the six cells out from the TOP
    // with the viewport it renders each face into, a GL texture's v counts from the
    // BOTTOM, and a WGSL texture's does not. So WebGL2's lookup subtracts the row
    // and WebGPU's must not.
    //
    // MEASURED on a real GPU before it was written: without the flip, a ray headed
    // at the -Z wall came back with the +Y face's colour — the two rows swapped and
    // nothing else. `e2e/glaze-probe.spec.ts` is that measurement, and it can only
    // run on WebGL2 here, which is exactly why the WebGPU half needs this line.
    expect(webgl2).toMatch(/1\.0 - floor\(face \/ 3\.0\)/);
    expect(webgpu).toMatch(/floor\(face \/ 3\.0\)/);
    expect(webgpu).not.toMatch(/1\.0 - floor\(face \/ 3\.0\)/);
  });

  it("picks between six faces on three axes in both", () => {
    // Three branches, one per major axis, and all six face numbers named. The
    // ORDER within a branch is not asserted, because the two languages write the
    // same choice the other way round — GLSL's `a ? b : c` against WGSL's
    // `select(c, b, a)` — and a test that pinned the spelling would fail on a
    // faithful translation. What the two backends agreeing really rests on is
    // `e2e/glaze-probe.spec.ts`, which can only run one of them here.
    for (const source of [webgl2, webgpu]) {
      // The lookup's own body, so a face number appearing elsewhere in a
      // thousand-line shader cannot satisfy this.
      const body = source.slice(source.indexOf("glazeEnvUv"));
      const lookup = body.slice(0, body.indexOf("\n}"));
      const choices = lookup.match(/face = [^;]+;/g) ?? [];
      expect(choices.length, "one face choice per axis").toBe(3);
      // DISTINCT, because both languages compare against 0.0 on the way to
      // choosing, so the raw list carries that constant too.
      const numbers = new Set(choices.join(" ").match(/\d\.0/g) ?? []);
      expect([...numbers].sort(), "all six faces are named").toEqual([
        "0.0",
        "1.0",
        "2.0",
        "3.0",
        "4.0",
        "5.0",
      ]);
    }
  });

  it("divides the atlas into three columns and two rows in both", () => {
    for (const source of [webgl2, webgpu]) {
      expect(source).toMatch(/vec2f?\(3\.0, 2\.0\)/);
    }
  });
});

describe("WebGL2's framebuffer binding", () => {
  // WebGPU has no global binding to leak — a pass is described by the
  // descriptor it is begun with — so this half has no counterpart, and that is
  // why it is not in the shared block above.
  it("is left on the default framebuffer at every exit of a render", () => {
    // Measured for real by the e2e spec, which reads FRAMEBUFFER_BINDING back
    // out of the context. Pinned here because the obvious version of that test
    // — render into a target, check the next canvas frame arrives — passes with
    // the unbind deleted: `render` also binds the default framebuffer on the
    // way IN, so nothing inside the renderer can see the leak. What can is
    // everything else sharing the context.
    const body = webgl2.slice(webgl2.indexOf("const offscreen = opts.target;"));
    const unbinds = body.match(/if \(offscreen\) gl!\.bindFramebuffer\(gl!\.FRAMEBUFFER, null\);/g);
    // One per exit: the early return for an empty frame, and the end of a full
    // one. A new early return needs a new unbind and should fail here.
    expect(unbinds?.length, "an unbind at each way out of render").toBe(2);
  });
});
