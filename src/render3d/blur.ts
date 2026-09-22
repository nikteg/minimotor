// ---------- Post-pass blur ----------
// The half of `Renderer3D.blur` that does not care which GPU API is behind it:
// how a radius becomes a set of passes, which nodes a caller wants kept sharp,
// and the shader sources both backends compile.
//
// **The shape of the pass.** A Gaussian of standard deviation σ costs one tap
// per pixel of kernel, so a σ of 60 physical pixels at full resolution would be
// a few hundred taps a pixel, twice. It is instead done where σ is SMALL: the
// frame is halved until σ fits a fixed kernel (`MAX_SIGMA` texels), blurred
// there with a separable Gaussian, and stretched back up by the bilinear
// sampler during the composite. A blur that wide has no detail left for the
// lower resolution to lose, which is the whole trick — and it makes a huge blur
// cost about what a small one does.
//
//   copy        the canvas's resolved colour, at full resolution
//   halve × L   2×2 box each step (one bilinear tap at the shared corner)
//   blur H, V   σ / 2^L texels, at level L
//   composite   mix(sharp, blurred × (1 − dim), mask) back onto the canvas
//
// The mask is `focus`: tunnel vision, a circle left sharp. It is applied in the
// composite, so the circle's edge is as crisp as the canvas and costs nothing.
//
// **Premultiplied throughout**, like the canvas: a Gaussian of premultiplied
// colour is the correct blur of a partly transparent image, and the composite
// writes premultiplied colour back.

import type { BlurOptions } from "./renderer.js";
import type { Scene3D } from "./scene.js";

/** The widest σ, in texels of the level it runs at, the kernel is sized for.
 *  Three σ each side is 99.7% of the Gaussian, so `KERNEL_REACH` taps cover it. */
export const MAX_SIGMA = 4;
export const KERNEL_REACH = Math.ceil(MAX_SIGMA * 3);
/** Halvings stop here: at 1/64 of the frame even a 4K canvas is 60 texels wide,
 *  and σ past that is a flat colour anyway. */
export const MAX_LEVEL = 6;

/** What one `blur` call runs, derived from its options and the canvas size. */
export interface BlurPlan {
  /** How many times the frame is halved before the Gaussian runs. */
  level: number;
  /** σ in texels AT that level. */
  sigma: number;
  /** Taps each side of the centre, at most `KERNEL_REACH`. */
  reach: number;
  /** Physical size of each level, level 0 being the canvas. */
  sizes: { width: number; height: number }[];
  /** The composite's uniforms, in CSS pixels as given. */
  focus: { x: number; y: number; inner: number; outer: number; curve: number } | null;
  dim: number;
}

/** The passes for `options` over a `width`×`height` physical canvas at `dpr`,
 *  or null when there is nothing to do. */
export function planBlur(
  options: BlurOptions,
  width: number,
  height: number,
  dpr: number,
): BlurPlan | null {
  const sigmaPx = options.radius * dpr;
  if (!(sigmaPx > 0) || width < 1 || height < 1) return null;
  let level = 0;
  while (level < MAX_LEVEL && sigmaPx / 2 ** level > MAX_SIGMA) level++;
  const sigma = sigmaPx / 2 ** level;
  const reach = Math.max(1, Math.min(KERNEL_REACH, Math.ceil(sigma * 3)));
  const sizes = [{ width, height }];
  for (let i = 1; i <= level; i++) {
    const prev = sizes[i - 1];
    sizes.push({
      width: Math.max(1, Math.ceil(prev.width / 2)),
      height: Math.max(1, Math.ceil(prev.height / 2)),
    });
  }
  const focus = options.focus
    ? {
        x: options.focus.x,
        y: options.focus.y,
        inner: Math.max(0, options.focus.radius),
        outer: Math.max(0, options.focus.radius) + Math.max(1e-3, options.focus.feather ?? 0),
        curve: Math.max(0.1, options.focus.curve ?? 1),
      }
    : null;
  return { level, sigma, reach, sizes, focus, dim: Math.min(1, Math.max(0, options.dim ?? 0)) };
}

/** Every node under `roots`, the roots included — for `RenderOptions.include`.
 *
 *  Walks the flat array once: a node's parent always comes before it
 *  (`scene.ts`), so a node is in the subtree exactly when its parent already
 *  is. Recompute it when the scene's nodes change; it is a snapshot. */
export function subtreeOf(scene: Scene3D, roots: Iterable<number>): Set<number> {
  const inside = new Set<number>(roots);
  scene.nodes.forEach((n, i) => {
    if (n.parent !== undefined && inside.has(n.parent)) inside.add(i);
  });
  return inside;
}

// ---------- GLSL (WebGL2) ----------

/** One triangle over the whole viewport, no vertex buffer: `gl_VertexID` picks
 *  the corner. `vUv` has (0,0) at the bottom-left, GL's texture origin. */
export const GLSL_FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** A straight copy through the linear sampler — at half size, one tap at the
 *  shared corner of four texels is their average: the 2×2 box. */
export const GLSL_COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
out vec4 outColor;
void main() { outColor = texture(uSource, vUv); }`;

/** One axis of the separable Gaussian. `uStep` is one texel along that axis. */
export const GLSL_GAUSS_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uStep;
uniform float uSigma;
uniform int uReach;
out vec4 outColor;
void main() {
  vec4 sum = texture(uSource, vUv);
  float total = 1.0;
  float k = -0.5 / (uSigma * uSigma);
  for (int i = 1; i <= ${KERNEL_REACH}; i++) {
    if (i > uReach) break;
    float w = exp(float(i * i) * k);
    sum += w * (texture(uSource, vUv + uStep * float(i)) + texture(uSource, vUv - uStep * float(i)));
    total += 2.0 * w;
  }
  outColor = sum / total;
}`;

/** The composite. `uCanvas` is the canvas's CSS size, `uFocus` is
 *  (x, y, inner, outer) in CSS pixels from the TOP-left, `uCurve` is the
 *  focus's `curve` and `uHasFocus` turns it on. `vUv` is bottom-up, so y flips
 *  here. */
export const GLSL_COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSharp;
uniform sampler2D uBlurred;
uniform vec2 uCanvas;
uniform vec4 uFocus;
uniform float uCurve;
uniform int uHasFocus;
uniform float uDim;
out vec4 outColor;
void main() {
  vec4 sharp = texture(uSharp, vUv);
  vec4 blurred = texture(uBlurred, vUv) * (1.0 - uDim);
  float mask = 1.0;
  if (uHasFocus == 1) {
    vec2 at = vec2(vUv.x, 1.0 - vUv.y) * uCanvas;
    mask = smoothstep(uFocus.z, uFocus.w, distance(at, uFocus.xy));
    mask = 1.0 - pow(1.0 - mask, uCurve);
  }
  outColor = mix(sharp, blurred, mask);
}`;

// ---------- WGSL (WebGPU) ----------

/** All three passes in one module, each its own fragment entry point. `uv` has
 *  (0,0) at the TOP-left, WebGPU's texture and framebuffer origin, so no flip. */
export const WGSL_BLUR = /* wgsl */ `
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Out;
  o.position = vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  o.uv = p;
  return o;
}

struct Params {
  // Gaussian: step (xy), sigma, reach.
  gauss: vec4f,
  // Composite: canvas CSS size (xy), dim, hasFocus.
  canvas: vec4f,
  // Composite: focus x, y, inner, outer in CSS pixels from the top-left.
  focus: vec4f,
  // Composite: the focus's curve (x); yzw unused.
  shape: vec4f,
};

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var second: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@fragment fn copy(v: Out) -> @location(0) vec4f {
  return textureSampleLevel(source, linearSampler, v.uv, 0.0);
}

@fragment fn gauss(v: Out) -> @location(0) vec4f {
  let step = params.gauss.xy;
  let sigma = params.gauss.z;
  let reach = i32(params.gauss.w);
  var sum = textureSampleLevel(source, linearSampler, v.uv, 0.0);
  var total = 1.0;
  let k = -0.5 / (sigma * sigma);
  for (var i = 1; i <= ${KERNEL_REACH}; i++) {
    if (i > reach) { break; }
    let w = exp(f32(i * i) * k);
    let offset = step * f32(i);
    sum += w * (textureSampleLevel(source, linearSampler, v.uv + offset, 0.0)
      + textureSampleLevel(source, linearSampler, v.uv - offset, 0.0));
    total += 2.0 * w;
  }
  return sum / total;
}

@fragment fn composite(v: Out) -> @location(0) vec4f {
  let sharp = textureSampleLevel(source, linearSampler, v.uv, 0.0);
  let blurred = textureSampleLevel(second, linearSampler, v.uv, 0.0) * (1.0 - params.canvas.z);
  var mask = 1.0;
  if (params.canvas.w > 0.5) {
    let at = v.uv * params.canvas.xy;
    mask = smoothstep(params.focus.z, params.focus.w, distance(at, params.focus.xy));
    mask = 1.0 - pow(1.0 - mask, params.shape.x);
  }
  return mix(sharp, blurred, mask);
}
`;
