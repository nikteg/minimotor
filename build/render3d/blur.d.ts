import type { BlurOptions } from "./renderer.js";
import type { Scene3D } from "./scene.js";
/** The widest σ, in texels of the level it runs at, the kernel is sized for.
 *  Three σ each side is 99.7% of the Gaussian, so `KERNEL_REACH` taps cover it. */
export declare const MAX_SIGMA = 4;
export declare const KERNEL_REACH: number;
/** Halvings stop here: at 1/64 of the frame even a 4K canvas is 60 texels wide,
 *  and σ past that is a flat colour anyway. */
export declare const MAX_LEVEL = 6;
/** What one `blur` call runs, derived from its options and the canvas size. */
export interface BlurPlan {
    /** How many times the frame is halved before the Gaussian runs. */
    level: number;
    /** σ in texels AT that level. */
    sigma: number;
    /** Taps each side of the centre, at most `KERNEL_REACH`. */
    reach: number;
    /** Physical size of each level, level 0 being the canvas. */
    sizes: {
        width: number;
        height: number;
    }[];
    /** The composite's uniforms, in CSS pixels as given. */
    focus: {
        x: number;
        y: number;
        inner: number;
        outer: number;
        curve: number;
    } | null;
    dim: number;
}
/** The passes for `options` over a `width`×`height` physical canvas at `dpr`,
 *  or null when there is nothing to do. */
export declare function planBlur(options: BlurOptions, width: number, height: number, dpr: number): BlurPlan | null;
/** Every node under `roots`, the roots included — for `RenderOptions.include`.
 *
 *  Walks the flat array once: a node's parent always comes before it
 *  (`scene.ts`), so a node is in the subtree exactly when its parent already
 *  is. Recompute it when the scene's nodes change; it is a snapshot. */
export declare function subtreeOf(scene: Scene3D, roots: Iterable<number>): Set<number>;
/** One triangle over the whole viewport, no vertex buffer: `gl_VertexID` picks
 *  the corner. `vUv` has (0,0) at the bottom-left, GL's texture origin. */
export declare const GLSL_FULLSCREEN_VS = "#version 300 es\nout vec2 vUv;\nvoid main() {\n  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n  vUv = p;\n  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n}";
/** A straight copy through the linear sampler — at half size, one tap at the
 *  shared corner of four texels is their average: the 2×2 box. */
export declare const GLSL_COPY_FS = "#version 300 es\nprecision highp float;\nin vec2 vUv;\nuniform sampler2D uSource;\nout vec4 outColor;\nvoid main() { outColor = texture(uSource, vUv); }";
/** One axis of the separable Gaussian. `uStep` is one texel along that axis. */
export declare const GLSL_GAUSS_FS: string;
/** The composite. `uCanvas` is the canvas's CSS size, `uFocus` is
 *  (x, y, inner, outer) in CSS pixels from the TOP-left, `uCurve` is the
 *  focus's `curve` and `uHasFocus` turns it on. `vUv` is bottom-up, so y flips
 *  here. */
export declare const GLSL_COMPOSITE_FS = "#version 300 es\nprecision highp float;\nin vec2 vUv;\nuniform sampler2D uSharp;\nuniform sampler2D uBlurred;\nuniform vec2 uCanvas;\nuniform vec4 uFocus;\nuniform float uCurve;\nuniform int uHasFocus;\nuniform float uDim;\nout vec4 outColor;\nvoid main() {\n  vec4 sharp = texture(uSharp, vUv);\n  vec4 blurred = texture(uBlurred, vUv) * (1.0 - uDim);\n  float mask = 1.0;\n  if (uHasFocus == 1) {\n    vec2 at = vec2(vUv.x, 1.0 - vUv.y) * uCanvas;\n    mask = smoothstep(uFocus.z, uFocus.w, distance(at, uFocus.xy));\n    mask = 1.0 - pow(1.0 - mask, uCurve);\n  }\n  outColor = mix(sharp, blurred, mask);\n}";
/** All three passes in one module, each its own fragment entry point. `uv` has
 *  (0,0) at the TOP-left, WebGPU's texture and framebuffer origin, so no flip. */
export declare const WGSL_BLUR: string;
