// ---------- WebGL2 backend ----------
// One program, Blinn-Phong, up to four directional lights. Not a material
// system: a single shader with uniform switches, because branching in a
// fragment shader on a uniform is free on every GPU made this decade and a
// program-per-material would need a permutation cache before it earned
// anything.
//
// GPU resources are cached WEAKLY against the plain-data objects that describe
// them — a `MeshData` maps to its VAO and buffers, a `TexImageSource` to its
// texture. So a caller creates meshes as ordinary values, and one that goes out
// of scope takes its GPU memory with it. A mesh MUTATED in place is noticed
// only if it says so: bump `MeshData.version` and the buffers are rebuilt, the
// same bargain `Material.textureVersion` strikes for a canvas redrawn in place.
// `release(mesh)` remains the way to hand the memory back early.
//
// Two conventions worth stating because getting either wrong looks like a
// renderer bug rather than a convention mismatch:
//
//   - `MeshData.uvs` has v = 0 at the TOP, like every image the engine loads,
//     and `texImage2D` uploads an image's FIRST row at v = 0. Those two agree,
//     so nothing flips: no `UNPACK_FLIP_Y_WEBGL`, no flip in the shader.
//     Setting the flip — the reflex, because GL is usually described as
//     bottom-up — makes v = 0 the image's last row and turns every texture
//     upside down. It shipped that way once, and a UI surface on a quad is how
//     it was noticed: geometry-mapped art is symmetric enough to hide it,
//     text is not.
//   - Front faces are counter-clockwise (glTF and GL default). A mesh built
//     the other way renders inside-out; `flipWinding` fixes the mesh rather
//     than this file flipping the culling.

import { Mat4 } from "@src/math/mat4.js";
import { cameraPosition, viewProjection } from "./camera.js";
import { fogUniform, isVisible } from "./scene.js";
import { triangleCount, vertexCount } from "./mesh.js";
import type { Camera3D } from "./camera.js";
import type { MeshData } from "./mesh.js";
import type { Material, Node3D, Scene3D } from "./scene.js";
import type {
  RenderFrameStats,
  RenderOptions,
  RenderStats,
  Renderer3D,
  ResizeOptions,
} from "./renderer.js";
import type { Vec3 } from "@src/math/vec3.js";

const MAX_LIGHTS = 4;
const MAX_JOINTS = 64;

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aColor;
layout(location = 4) in uvec4 aJoints;
layout(location = 5) in vec4 aWeights;
layout(location = 6) in vec2 aUv1;
layout(location = 7) in vec4 aTangent;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform bool uHasSkin;
uniform mat4 uJointMatrices[${MAX_JOINTS}];

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec2 vUv1;
out vec4 vColor;
out vec4 vTangent;

void main() {
  vec4 localPosition = vec4(aPosition, 1.0);
  vec3 localNormal = aNormal;
  vec3 localTangent = aTangent.xyz;
  if (uHasSkin) {
    mat4 skin =
      aWeights.x * uJointMatrices[int(aJoints.x)] +
      aWeights.y * uJointMatrices[int(aJoints.y)] +
      aWeights.z * uJointMatrices[int(aJoints.z)] +
      aWeights.w * uJointMatrices[int(aJoints.w)];
    localPosition = skin * localPosition;
    localNormal = mat3(skin) * localNormal;
    localTangent = mat3(skin) * localTangent;
  }
  vec4 world = uModel * localPosition;
  vWorldPos = world.xyz;
  // The inverse-transpose, so a non-uniformly scaled mesh still lights right.
  vNormal = uNormalMat * localNormal;
  // A tangent is a DIRECTION ALONG the surface, not a normal to it, so it goes
  // through the model matrix rather than the inverse-transpose. w carries the
  // handedness and rides through untouched.
  vTangent = vec4(mat3(uModel) * localTangent, aTangent.w);
  vUv = aUv;
  vUv1 = aUv1;
  vColor = aColor;
  gl_Position = uViewProj * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec2 vUv1;
in vec4 vColor;
in vec4 vTangent;

uniform vec4 uBaseColor;
uniform vec3 uAmbient;
uniform vec3 uLightDir[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform int uLightCount;
uniform vec3 uCameraPos;
uniform float uShininess;
uniform float uSpecular;
uniform float uMetallic;
uniform bool uUnlit;
uniform int uTextureBlend; // 0 none, 1 multiply, 2 over
uniform bool uUvPlanar;
uniform sampler2D uTexture;
uniform bool uHasNormalMap;
uniform sampler2D uNormalMap;
uniform float uNormalScale;
uniform sampler2D uDetailMap;
uniform float uDetailStrength; // 0 disables the sample entirely
uniform bool uDetailUv1;
uniform vec3 uRimAlpha; // bias, scale, power — see Material.rimAlpha
uniform vec4 uUvTransform;
uniform int uFogMode; // -1 off, 0 linear, 1 exp, 2 exp squared, 3 layered
uniform vec3 uFogColor;
uniform vec3 uFogParams; // see fogUniform() in scene.ts
uniform bool uToneMap; // Scene3D.toneMapping == "aces"
uniform vec3 uAmbientGround;

out vec4 fragColor;

/** sRGB in both directions, as the cheap squares rather than the piecewise
 *  curve. Real-time renderers have used this pair for long enough that a
 *  shader written against the exact transfer function looks subtly wrong
 *  beside them; the error is under a percent everywhere but the deepest few
 *  values, and it costs a multiply instead of a branch and a pow. */
vec3 srgbToLinear(vec3 c) { return c * c; }
vec3 linearToSrgb(vec3 c) { return sqrt(c); }

/** The ACES filmic curve, in Krzysztof Narkowicz's fitted form.
 *
 *  The clamp at 8 is part of the fit and not a safety rail: the rational
 *  function flattens out well before that, so anything brighter is already
 *  white and letting it through only risks an overflow on a half-float path. */
vec3 acesToneMap(vec3 color) {
  color = min(color, vec3(8.0));
  const float A = 2.51, B = 0.03, C = 2.43, D = 0.59, E = 0.14;
  return (color * (A * color + B)) / (color * (C * color + D) + E);
}

/** Visibility in 0..1 — 1 is clear air. A ground-hugging slab needs the fog
 *  density integrated along the view ray, otherwise the layer slides with the
 *  camera instead of staying put in the world. */
float fogVisibility(vec3 world, vec3 eye) {
  if (uFogMode == 0) {
    return clamp((uFogParams.y - distance(eye, world)) / (uFogParams.y - uFogParams.x), 0.0, 1.0);
  }
  if (uFogMode == 1 || uFogMode == 2) {
    float d = max(distance(eye, world) - uFogParams.x, 0.0) / uFogParams.z * 4.0 * uFogParams.y;
    return exp(uFogMode == 1 ? -d : -d * d);
  }
  float top = uFogParams.x;
  float range = uFogParams.y;
  float deltaD = distance(world.xz, eye.xz) / uFogParams.z * 2.0;
  float deltaY;
  float integral;
  if (eye.y > top) {
    deltaY = world.y < top ? (top - world.y) / range * 2.0 : 0.0;
    integral = deltaY * deltaY * 0.5;
  } else if (world.y < top) {
    float a = (top - eye.y) / range * 2.0;
    float b = (top - world.y) / range * 2.0;
    deltaY = abs(a - b);
    integral = abs(a * a * 0.5 - b * b * 0.5);
  } else {
    deltaY = abs(top - eye.y) / range * 2.0;
    integral = abs(deltaY * deltaY * 0.5);
  }
  if (deltaY == 0.0) return 1.0;
  float ratio = deltaD / deltaY;
  return exp(-sqrt(1.0 + ratio * ratio) * integral);
}

/** The mobile GGX distribution the physical model's highlight is shaped by.
 *  Only reached under tone mapping; the direct model keeps Blinn-Phong. */
float ggxMobile(float roughness, float noh, vec3 h, vec3 n) {
  vec3 nxh = cross(n, h);
  float oneMinusNohSqr = dot(nxh, nxh);
  float a = roughness * roughness;
  float k = noh * a;
  float p = a / max(1e-6, oneMinusNohSqr + k * k);
  return p * p;
}

/** Karis' analytic environment BRDF, which scales f0 by how much of the lobe
 *  actually leaves the surface at this angle and roughness. Without it a rough
 *  dielectric keeps its full head-on reflectance at every grazing angle. */
vec3 brdfApprox(vec3 f0, float roughness, float nov) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * nov)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  ab.y *= clamp(50.0 * f0.g, 0.0, 1.0);
  return max(vec3(0.0), f0 * ab.x + ab.y);
}

/** Roughness back out of a Blinn exponent, the exact inverse of the mapping
 *  the glTF loader uses going the other way. A material that came from a
 *  document round-trips; one whose exponent was set by hand gets the roughness
 *  that exponent stands for, which is the same ordering either way. */
float roughnessOf(float shininess) {
  return clamp(1.0 - (log2(max(shininess, 1e-6)) - 1.0) / 7.0, 0.0, 1.0);
}

/** Photoshop's Overlay, pivoting on mid-grey: the pattern decides which half
 *  of the curve runs, so a texel lighter than half screens the surface up and
 *  a darker one multiplies it down. The PATTERN is what gets tested, not the
 *  surface — which is what makes this an overlay OF the detail map rather than
 *  a surface-driven contrast boost, and the two are visibly different on a
 *  dark base. (No backticks in here: this is inside a template literal.) */
vec3 blendOverlay(vec3 pattern, vec3 surface) {
  float lum = dot(pattern, vec3(0.2126, 0.7152, 0.0722));
  return lum < 0.5 ? 2.0 * pattern * surface : 1.0 - 2.0 * (1.0 - pattern) * (1.0 - surface);
}

/** The tangent frame the normal map is read in.
 *
 *  Two ways to get one. If the mesh SHIPS a tangent, use it: it is the frame
 *  the map was baked against, it is continuous across a face however the uv
 *  islands are packed behind it, and w says which way the bitangent runs.
 *  Otherwise rebuild it per pixel from screen-space derivatives, which needs
 *  no attribute and cannot disagree with the uvs the mesh actually has, but
 *  reads the frame off however the unwrap happens to be laid out locally — so
 *  a uv island that changes density across a flat face leaves a visible step
 *  in the shading exactly at the change. Shipped tangents are the fix for
 *  that; the derivative path stays for meshes built in code. */
vec3 applyNormalMap(vec3 n, vec2 uv) {
  vec3 tangent;
  vec3 bitangent;
  if (dot(vTangent.xyz, vTangent.xyz) > 1e-12) {
    // Gram-Schmidt against the interpolated normal, which is what keeps the
    // frame orthogonal after the two have been interpolated separately.
    tangent = normalize(vTangent.xyz - n * dot(n, vTangent.xyz));
    bitangent = cross(n, tangent) * (vTangent.w < 0.0 ? -1.0 : 1.0);
  } else {
    vec3 dPosX = dFdx(vWorldPos);
    vec3 dPosY = dFdy(vWorldPos);
    vec2 dUvX = dFdx(uv);
    vec2 dUvY = dFdy(uv);
    float det = dUvX.x * dUvY.y - dUvY.x * dUvX.y;
    // A degenerate uv patch has no basis to build from; leave the face alone
    // rather than tilting it by a divide-by-zero.
    if (abs(det) < 1e-12) return n;
    tangent = normalize((dPosX * dUvY.y - dPosY * dUvX.y) / det);
    bitangent = normalize(cross(n, tangent));
    tangent = cross(bitangent, n);
  }
  vec3 sampled = texture(uNormalMap, uv).xyz * 2.0 - 1.0;
  sampled.xy *= uNormalScale;
  return normalize(mat3(tangent, bitangent, n) * sampled);
}

void main() {
  vec2 source = uUvPlanar ? vWorldPos.xz : vUv;
  vec2 uv = source * uUvTransform.xy + uUvTransform.zw;
  vec4 base = uBaseColor * vColor;
  if (uTextureBlend > 0) {
    vec4 texel = texture(uTexture, uv);
    // Blend 2 keeps the base colour's own alpha: the texture decides colour
    // where it is opaque, not whether the surface is there at all.
    base = uTextureBlend == 2 ? vec4(mix(base.rgb, texel.rgb, texel.a), base.a) : base * texel;
  }
  // While base is still in display space — see Material.detailMap.
  if (uDetailStrength > 0.0) {
    vec3 pattern = texture(uDetailMap, uDetailUv1 ? vUv1 : uv).rgb;
    base.rgb = mix(base.rgb, blendOverlay(pattern, base.rgb), uDetailStrength);
  }
  // Ahead of the cutoff and of the unlit branch, because the ramp is what
  // decides the final alpha: a bias of zero means the face-on fragments are
  // the ones with nothing left to draw, and both paths below want that answer.
  if (uRimAlpha.y != 0.0) {
    vec3 facing = normalize(vNormal);
    if (!gl_FrontFacing) facing = -facing;
    float grazing = max(1.0 - dot(normalize(uCameraPos - vWorldPos), facing), 0.0);
    base.a *= clamp(uRimAlpha.x + uRimAlpha.y * pow(grazing, uRimAlpha.z), 0.0, 1.0);
  }
  if (base.a < 0.002) discard;

  // Everything below works in linear light when tone mapping is on, so the
  // decode happens once here — on the material colour, the vertex colour and
  // the texture together, all three of which are authored for a display.
  if (uToneMap) base.rgb = srgbToLinear(base.rgb);

  if (uUnlit) {
    // Unlit skips the lighting, not the output curve: an unlit gizmo beside a
    // lit surface has to have come through the same shoulder, or it reads as
    // belonging to a different scene.
    // A backtick would end this template literal, so: flat is a reserved
    // interpolation qualifier in GLSL, which is why this is called plain.
    vec3 plain = base.rgb;
    if (uToneMap) plain = linearToSrgb(acesToneMap(plain));
    // The canvas is premultiplied-alpha, so premultiply exactly once at the
    // render boundary. Texture uploads stay straight-alpha below.
    fragColor = vec4(plain * base.a, base.a);
    return;
  }

  // Two-sided lighting: flip the normal on a back face so a doubleSided
  // material is lit rather than black on its reverse.
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  if (uHasNormalMap) n = applyNormalMap(n, uv);
  vec3 view = normalize(uCameraPos - vWorldPos);

  // A hemisphere when a ground colour was given, the plain fill otherwise.
  // The blend runs off the normal's Y alone, so it costs nothing per light and
  // does not care where the camera is.
  vec3 lit = mix(uAmbient, uAmbientGround, max(1e-6, 0.5 - n.y * 0.5));
  vec3 spec = vec3(0.0);
  // Lambert's 1/pi, which is what puts an intensity on the same scale as an
  // illuminance. Only under tone mapping: applying it to the direct model
  // would darken every existing scene by the same third.
  float diffuseScale = uToneMap ? 0.31830988 : 1.0;
  // Under tone mapping the highlight has to be energy-plausible, because it is
  // now being multiplied by an illuminance rather than by a number near 1.
  // Everything here is the metal/rough convention and none of it is reached by
  // the direct model:
  //   - it is TINTED. A white sheen on a saturated surface lifts whichever
  //     channel the surface has least of, which reads as the colour draining
  //     out. Metals reflect their own colour; dielectrics reflect 8% of
  //     uSpecular, which is a real material property and NOT metalness.
  //   - the lobe is GGX, not Blinn-Phong, so its width and its height both
  //     come from one roughness rather than from an exponent that only sets
  //     the width. A Blinn lobe normalized by (n + 8) / 8pi stood in for this
  //     and was close at high roughness and much too hot in the middle.
  //   - f0 goes through the environment BRDF, which is what keeps a rough
  //     surface from reflecting its full head-on strength edge-on.
  //   - the whole thing is multiplied by N·L, because a face the light does
  //     not reach has no highlight to show.
  float roughness = roughnessOf(uShininess);
  vec3 f0 = mix(vec3(0.08 * uSpecular), base.rgb, uMetallic);
  vec3 reflectance = uToneMap ? brdfApprox(f0, roughness, max(abs(dot(n, view)), 0.0)) : f0;
  float lobeScale = roughness * 0.25 + 0.25;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 toLight = -uLightDir[i];
    float ndl = max(dot(n, toLight), 0.0);
    lit += uLightColor[i] * ndl * diffuseScale;
    if (uShininess > 0.0 && ndl > 0.0) {
      vec3 halfway = normalize(toLight + view);
      float noh = max(dot(n, halfway), 0.0);
      spec += uToneMap
        ? uLightColor[i] * ndl * reflectance * (lobeScale * ggxMobile(roughness, noh, halfway, n))
        : uLightColor[i] * uSpecular * pow(noh, uShininess);
    }
  }
  // A metal has no diffuse: what it does not reflect, it absorbs.
  vec3 albedo = uToneMap ? base.rgb * (1.0 - uMetallic) : base.rgb;
  vec3 shaded = albedo * lit + spec;
  // Fog before the curve, not after: the fog colour is a colour in the scene
  // like any other, and a distant surface that has faded most of the way into
  // it should reach the shoulder with it rather than be mixed into an
  // already-toned pixel.
  if (uFogMode >= 0) {
    vec3 fog = uToneMap ? srgbToLinear(uFogColor) : uFogColor;
    shaded = mix(fog, shaded, clamp(fogVisibility(vWorldPos, uCameraPos), 0.0, 1.0));
  }
  if (uToneMap) shaded = linearToSrgb(acesToneMap(shaded));
  fragColor = vec4(shaded * base.a, base.a);
}`;

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexBuffer: WebGLBuffer;
  count: number;
  type: number;
  /** The `MeshData.version` these buffers were filled from, so an in-place
   *  edit can be noticed. `undefined` for a mesh that never declared one. */
  version: number | undefined;
}

interface Uniforms {
  viewProj: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  normalMat: WebGLUniformLocation | null;
  baseColor: WebGLUniformLocation | null;
  ambient: WebGLUniformLocation | null;
  lightDir: WebGLUniformLocation | null;
  lightColor: WebGLUniformLocation | null;
  lightCount: WebGLUniformLocation | null;
  cameraPos: WebGLUniformLocation | null;
  shininess: WebGLUniformLocation | null;
  specular: WebGLUniformLocation | null;
  metallic: WebGLUniformLocation | null;
  unlit: WebGLUniformLocation | null;
  textureBlend: WebGLUniformLocation | null;
  uvPlanar: WebGLUniformLocation | null;
  texture: WebGLUniformLocation | null;
  hasNormalMap: WebGLUniformLocation | null;
  normalMap: WebGLUniformLocation | null;
  normalScale: WebGLUniformLocation | null;
  detailMap: WebGLUniformLocation | null;
  detailStrength: WebGLUniformLocation | null;
  detailUv1: WebGLUniformLocation | null;
  rimAlpha: WebGLUniformLocation | null;
  uvTransform: WebGLUniformLocation | null;
  fogMode: WebGLUniformLocation | null;
  fogColor: WebGLUniformLocation | null;
  fogParams: WebGLUniformLocation | null;
  toneMap: WebGLUniformLocation | null;
  ambientGround: WebGLUniformLocation | null;
  hasSkin: WebGLUniformLocation | null;
  jointMatrices: WebGLUniformLocation | null;
}

/** How to build a WebGL2 renderer. */
export interface WebGL2RendererOptions {
  /** Render into this canvas instead of a fresh one — for a scene layer that
   *  is already in the document. */
  canvas?: HTMLCanvasElement;
  /** Multisampling. On by default: at preview sizes the jaggies on a silhouette
   *  are the single most obvious quality difference, and MSAA is nearly free
   *  compared with supersampling. */
  antialias?: boolean;
  /** Preserve the default framebuffer after compositing. This is expensive;
   *  it remains enabled by default for compatibility. */
  preserveDrawingBuffer?: boolean;
  /** Collect GPU timer-query samples. Disabled by default because queries add
   *  instrumentation overhead. */
  gpuTiming?: boolean;
  /** Initial logical size. */
  width?: number;
  height?: number;
  /** Device pixel ratio for the backing store. */
  dpr?: number;
}

/** Create a WebGL2 renderer, or throw if the context cannot be created.
 *  Callers that want a graceful fallback should use `createRenderer3D`, which
 *  reports failure instead. */
export function createWebGL2Renderer(opts: WebGL2RendererOptions = {}): Renderer3D {
  const canvas = opts.canvas ?? document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: opts.antialias ?? true,
    depth: true,
    // The UI normally blits this canvas in the same JS frame. Keeping this
    // enabled remains the compatibility default, but it is a measurable cost
    // for a renderer used only as a short-lived canvas source.
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true,
    premultipliedAlpha: true,
  });
  if (!gl) throw new Error("WebGL2 is not available in this browser or context.");
  const timerExt = opts.gpuTiming ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
  const pendingGpuQueries: WebGLQuery[] = [];
  let resolvedGpuMs = 0;

  function pollGpuQueries(): void {
    if (!timerExt) return;
    if (gl!.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      for (const query of pendingGpuQueries) gl!.deleteQuery(query);
      pendingGpuQueries.length = 0;
      return;
    }
    for (let i = pendingGpuQueries.length - 1; i >= 0; i--) {
      const query = pendingGpuQueries[i];
      // In the WebGL2 variant the extension supplies TIME_ELAPSED_EXT and
      // GPU_DISJOINT_EXT, but the result-query enums are core WebGL2 enums.
      // Reading them from the extension object returns undefined in browsers
      // that implement the extension strictly, so the queries would remain
      // pending forever.
      if (!gl!.getQueryParameter(query, gl!.QUERY_RESULT_AVAILABLE)) continue;
      const nanoseconds = gl!.getQueryParameter(query, gl!.QUERY_RESULT) as number;
      resolvedGpuMs += nanoseconds / 1_000_000;
      gl!.deleteQuery(query);
      pendingGpuQueries.splice(i, 1);
    }
  }

  function beginGpuQuery(): WebGLQuery | null {
    if (!timerExt) return null;
    const query = gl!.createQuery();
    if (!query) return null;
    gl!.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
    return query;
  }

  function endGpuQuery(query: WebGLQuery | null): void {
    if (!query || !timerExt) return;
    gl!.endQuery(timerExt.TIME_ELAPSED_EXT);
    pendingGpuQueries.push(query);
  }

  const program = link(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  const u: Uniforms = {
    viewProj: gl.getUniformLocation(program, "uViewProj"),
    model: gl.getUniformLocation(program, "uModel"),
    normalMat: gl.getUniformLocation(program, "uNormalMat"),
    baseColor: gl.getUniformLocation(program, "uBaseColor"),
    ambient: gl.getUniformLocation(program, "uAmbient"),
    lightDir: gl.getUniformLocation(program, "uLightDir"),
    lightColor: gl.getUniformLocation(program, "uLightColor"),
    lightCount: gl.getUniformLocation(program, "uLightCount"),
    cameraPos: gl.getUniformLocation(program, "uCameraPos"),
    shininess: gl.getUniformLocation(program, "uShininess"),
    specular: gl.getUniformLocation(program, "uSpecular"),
    metallic: gl.getUniformLocation(program, "uMetallic"),
    unlit: gl.getUniformLocation(program, "uUnlit"),
    textureBlend: gl.getUniformLocation(program, "uTextureBlend"),
    uvPlanar: gl.getUniformLocation(program, "uUvPlanar"),
    texture: gl.getUniformLocation(program, "uTexture"),
    hasNormalMap: gl.getUniformLocation(program, "uHasNormalMap"),
    normalMap: gl.getUniformLocation(program, "uNormalMap"),
    normalScale: gl.getUniformLocation(program, "uNormalScale"),
    detailMap: gl.getUniformLocation(program, "uDetailMap"),
    detailStrength: gl.getUniformLocation(program, "uDetailStrength"),
    detailUv1: gl.getUniformLocation(program, "uDetailUv1"),
    rimAlpha: gl.getUniformLocation(program, "uRimAlpha"),
    uvTransform: gl.getUniformLocation(program, "uUvTransform"),
    fogMode: gl.getUniformLocation(program, "uFogMode"),
    fogColor: gl.getUniformLocation(program, "uFogColor"),
    fogParams: gl.getUniformLocation(program, "uFogParams"),
    toneMap: gl.getUniformLocation(program, "uToneMap"),
    ambientGround: gl.getUniformLocation(program, "uAmbientGround"),
    hasSkin: gl.getUniformLocation(program, "uHasSkin"),
    jointMatrices: gl.getUniformLocation(program, "uJointMatrices"),
  };

  const meshes = new WeakMap<object, GpuMesh>();
  const textures = new WeakMap<
    object,
    { texture: WebGLTexture; version: number; repeat: boolean }
  >();

  let width = opts.width ?? 300;
  let height = opts.height ?? 150;
  let dpr = opts.dpr ?? 1;

  const viewProj = Mat4.create();
  const normalMat = new Float32Array(9);
  const eye: Vec3 = { x: 0, y: 0, z: 0 };
  const lightDirs = new Float32Array(MAX_LIGHTS * 3);
  const lightColors = new Float32Array(MAX_LIGHTS * 3);
  const stats: RenderStats = { drawCalls: 0, triangles: 0, culled: 0 };
  const frameStats: RenderFrameStats = {
    viewports: 0,
    drawCalls: 0,
    triangles: 0,
    culled: 0,
    cpuMs: 0,
  };
  // Reused across frames so sorting a scene allocates nothing per frame.
  const opaque: number[] = [];
  const blended: { index: number; depth: number }[] = [];
  /** `depthTest: false` nodes, drawn last against a depth test that passes. */
  const overlay: number[] = [];

  function applyCanvasSize(retainBackingStore = false): void {
    const bw = Math.max(1, Math.round(width * dpr));
    const bh = Math.max(1, Math.round(height * dpr));
    const nextW = retainBackingStore ? Math.max(canvas.width, bw) : bw;
    const nextH = retainBackingStore ? Math.max(canvas.height, bh) : bh;
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
  }
  applyCanvasSize();

  function uploadMesh(mesh: MeshData): GpuMesh {
    const cached = meshes.get(mesh);
    if (cached && cached.version === mesh.version) return cached;
    // A version that moved means the arrays were rewritten in place. Drop the
    // old buffers and build again: re-specifying is what `bufferData` already
    // does per attribute, and a re-upload of a mesh sized for its worst frame
    // costs the same whether or not the contents changed shape.
    if (cached) releaseMesh(cached);

    const vao = gl!.createVertexArray();
    if (!vao) throw new Error("WebGL2: could not create a vertex array object.");
    gl!.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];

    const n = vertexCount(mesh);
    // Missing attributes get a filled default rather than a disabled one: a
    // disabled attribute reads whatever the last draw left bound, which shows
    // up as a mesh randomly inheriting another mesh's colours.
    const attach = (location: number, data: Float32Array, size: number): void => {
      const buf = gl!.createBuffer();
      if (!buf) throw new Error("WebGL2: could not create a vertex buffer.");
      buffers.push(buf);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
      gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
      gl!.enableVertexAttribArray(location);
      gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0);
    };
    attach(0, mesh.positions, 3);
    attach(1, mesh.normals ?? defaultNormals(n), 3);
    attach(2, mesh.uvs ?? new Float32Array(n * 2), 2);
    attach(3, mesh.colors ?? filled(n * 4, 1), 4);
    const jointBuffer = gl!.createBuffer();
    if (!jointBuffer) throw new Error("WebGL2: could not create a joint buffer.");
    buffers.push(jointBuffer);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, jointBuffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, mesh.joints ?? defaultJoints(n), gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(4);
    gl!.vertexAttribIPointer(4, 4, gl!.UNSIGNED_SHORT, 0, 0);
    attach(5, mesh.weights ?? defaultWeights(n), 4);
    attach(6, mesh.uvs1 ?? new Float32Array(n * 2), 2);
    // All zeroes when the mesh has none, which is what the shader's
    // length test reads as "rebuild the frame from derivatives instead".
    attach(7, mesh.tangents ?? new Float32Array(n * 4), 4);

    const indexBuffer = gl!.createBuffer();
    if (!indexBuffer) throw new Error("WebGL2: could not create an index buffer.");
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, mesh.indices, gl!.STATIC_DRAW);
    gl!.bindVertexArray(null);

    const gpu: GpuMesh = {
      vao,
      buffers,
      indexBuffer,
      count: mesh.indices.length,
      type: mesh.indices instanceof Uint32Array ? gl!.UNSIGNED_INT : gl!.UNSIGNED_SHORT,
      version: mesh.version,
    };
    meshes.set(mesh, gpu);
    return gpu;
  }

  function releaseMesh(gpu: GpuMesh): void {
    gl!.deleteVertexArray(gpu.vao);
    for (const buffer of gpu.buffers) gl!.deleteBuffer(buffer);
    gl!.deleteBuffer(gpu.indexBuffer);
  }

  function uploadTexture(
    source: TexImageSource,
    pixelated: boolean,
    version: number,
    repeat: boolean,
  ): WebGLTexture {
    const cached = textures.get(source as object);
    if (cached && cached.version === version && cached.repeat === repeat) return cached.texture;
    // Re-uploading into the SAME texture object rather than making a new one:
    // a live surface would otherwise leak one texture per frame.
    const tex = cached?.texture ?? gl!.createTexture();
    if (!tex) throw new Error("WebGL2: could not create a texture.");
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    // Keep sampled textures straight-alpha; both backends premultiply once in
    // their fragment shader when writing to the premultiplied canvas.
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source);
    const filter = pixelated ? gl!.NEAREST : gl!.LINEAR;
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
    // CLAMP by default, not REPEAT: a non-power-of-two texture is legal in
    // WebGL2 but wrapping one bleeds the opposite edge into a uv that lands
    // exactly on 1. A material that tiles asks for REPEAT explicitly.
    const wrap = repeat ? gl!.REPEAT : gl!.CLAMP_TO_EDGE;
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, wrap);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, wrap);
    textures.set(source as object, { texture: tex, version, repeat });
    return tex;
  }

  function drawNode(node: Node3D, material: Material): void {
    if (!node.mesh || !node.world) return;
    const gpu = uploadMesh(node.mesh);

    gl!.uniformMatrix4fv(u.model, false, node.world);
    // A singular model matrix (a zero scale) has no normal matrix; fall back
    // to the model matrix, which at least renders the silhouette rather than
    // dropping the node.
    const nm = Mat4.normalMatrix(node.world, normalMat);
    gl!.uniformMatrix3fv(u.normalMat, false, nm ?? IDENTITY3);
    const skin = node.skin?.matrices;
    if (skin && skin.length > MAX_JOINTS * 16) {
      throw new Error(`WebGL2 supports at most ${MAX_JOINTS} skin joints per node.`);
    }
    gl!.uniform1i(u.hasSkin, skin ? 1 : 0);
    gl!.uniformMatrix4fv(u.jointMatrices, false, skin ?? IDENTITY_JOINTS);

    const color = material.color ?? WHITE;
    gl!.uniform4f(u.baseColor, color[0], color[1], color[2], color[3]);
    gl!.uniform1f(u.shininess, material.shininess ?? 0);
    gl!.uniform1f(u.specular, material.specular ?? 0.25);
    gl!.uniform1f(u.metallic, material.metallic ?? 0);
    gl!.uniform1i(u.unlit, material.unlit ? 1 : 0);

    const pixelated = material.pixelated ?? true;
    const repeat = material.repeat ?? false;
    const uvScale = material.uvScale ?? UNIT_UV;
    const uvOffset = material.uvOffset ?? ZERO_UV;
    gl!.uniform4f(u.uvTransform, uvScale[0], uvScale[1], uvOffset[0], uvOffset[1]);
    gl!.uniform1i(u.uvPlanar, material.uvProjection === "planarXZ" ? 1 : 0);

    if (material.texture) {
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(
        gl!.TEXTURE_2D,
        uploadTexture(material.texture, pixelated, material.textureVersion ?? 0, repeat),
      );
      gl!.uniform1i(u.texture, 0);
      gl!.uniform1i(u.textureBlend, material.textureBlend === "over" ? 2 : 1);
    } else {
      gl!.uniform1i(u.textureBlend, 0);
    }

    if (material.normalMap) {
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(
        gl!.TEXTURE_2D,
        // A normal map is a vector field, so it is always filtered smoothly —
        // nearest-sampling one turns a smooth surface into faceted steps.
        uploadTexture(material.normalMap, false, material.normalMapVersion ?? 0, repeat),
      );
      gl!.uniform1i(u.normalMap, 1);
      gl!.uniform1i(u.hasNormalMap, 1);
      gl!.uniform1f(u.normalScale, material.normalScale ?? 1);
    } else {
      gl!.uniform1i(u.hasNormalMap, 0);
    }

    const detailStrength = material.detailMap ? (material.detailStrength ?? 0) : 0;
    if (detailStrength > 0) {
      gl!.activeTexture(gl!.TEXTURE2);
      gl!.bindTexture(
        gl!.TEXTURE_2D,
        uploadTexture(material.detailMap!, pixelated, material.detailMapVersion ?? 0, repeat),
      );
      gl!.uniform1i(u.detailMap, 2);
      gl!.uniform1i(u.detailUv1, material.detailUv === 1 ? 1 : 0);
    }
    gl!.uniform1f(u.detailStrength, detailStrength);

    // `[1, 0, 1]` is the identity ramp: bias 1 with no grazing term leaves the
    // alpha exactly as authored, and the shader's own `scale != 0` test skips
    // the pow() entirely.
    const rim = material.rimAlpha;
    gl!.uniform3f(u.rimAlpha, rim?.[0] ?? 1, rim?.[1] ?? 0, rim?.[2] ?? 1);

    if (material.doubleSided) gl!.disable(gl!.CULL_FACE);
    else gl!.enable(gl!.CULL_FACE);

    gl!.bindVertexArray(gpu.vao);
    gl!.drawElements(
      node.mesh.topology === "lines" ? gl!.LINES : gl!.TRIANGLES,
      gpu.count,
      gpu.type,
      0,
    );
    stats.drawCalls++;
    stats.triangles += triangleCount(node.mesh);
  }

  const renderer: Renderer3D = {
    backend: "webgl2",
    canvas,
    clipZeroToOne: false,
    stats,
    consumeFrameStats() {
      pollGpuQueries();
      const snapshot = { ...frameStats, gpuMs: timerExt ? resolvedGpuMs : undefined };
      frameStats.viewports = 0;
      frameStats.drawCalls = 0;
      frameStats.triangles = 0;
      frameStats.culled = 0;
      frameStats.cpuMs = 0;
      resolvedGpuMs = 0;
      return snapshot;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get renderWidth() {
      return Math.max(1, Math.round(width * dpr));
    },
    get renderHeight() {
      return Math.max(1, Math.round(height * dpr));
    },

    resize(w, h, ratio, options: ResizeOptions = {}) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      if (ratio !== undefined) dpr = ratio;
      applyCanvasSize(options.retainBackingStore);
    },

    render(scene: Scene3D, camera: Camera3D, opts: RenderOptions = {}) {
      stats.drawCalls = 0;
      stats.triangles = 0;
      stats.culled = 0;
      frameStats.viewports++;
      const renderStart = performance.now();
      const gpuQuery = beginGpuQuery();

      const targetW = Math.max(1, Math.round(width * dpr));
      const targetH = Math.max(1, Math.round(height * dpr));
      // WebGL's origin is bottom-left, while the 2D crop in viewport3d reads
      // from the canvas's top-left. Keep the active render rectangle aligned
      // with that crop when the backing store is larger than this viewport.
      const targetY = canvas.height - targetH;
      gl!.viewport(0, targetY, targetW, targetH);
      gl!.enable(gl!.DEPTH_TEST);
      gl!.depthFunc(gl!.LEQUAL);
      gl!.enable(gl!.CULL_FACE);
      gl!.cullFace(gl!.BACK);
      gl!.frontFace(gl!.CCW);

      if (opts.clear !== false) {
        const bg = scene.background;
        // Premultiplied alpha, because the context was created that way: a
        // straight-alpha clear colour makes a transparent background render as
        // a light haze over whatever is behind it.
        gl!.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
        gl!.clearDepth(1);
        gl!.enable(gl!.SCISSOR_TEST);
        gl!.scissor(0, targetY, targetW, targetH);
        gl!.depthMask(true);
        gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
        gl!.disable(gl!.SCISSOR_TEST);
      }
      if (scene.nodes.length === 0) {
        endGpuQuery(gpuQuery);
        frameStats.drawCalls += stats.drawCalls;
        frameStats.triangles += stats.triangles;
        frameStats.culled += stats.culled;
        frameStats.cpuMs += performance.now() - renderStart;
        return;
      }

      gl!.useProgram(program);
      viewProjection(camera, width / height, false, viewProj);
      gl!.uniformMatrix4fv(u.viewProj, false, viewProj);
      cameraPosition(camera, eye);
      gl!.uniform3f(u.cameraPos, eye.x, eye.y, eye.z);
      gl!.uniform3f(u.ambient, scene.ambient[0], scene.ambient[1], scene.ambient[2]);
      // No ground colour means no hemisphere: feeding the sky colour to both
      // ends makes the shader's `mix` a no-op and keeps the fill uniform.
      const ground = scene.ambientGround ?? scene.ambient;
      gl!.uniform3f(u.ambientGround, ground[0], ground[1], ground[2]);
      gl!.uniform1i(u.toneMap, scene.toneMapping === "aces" ? 1 : 0);

      const lights = scene.lights.slice(0, MAX_LIGHTS);
      lights.forEach((light, i) => {
        const d = light.direction;
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        lightDirs[i * 3] = d.x / l;
        lightDirs[i * 3 + 1] = d.y / l;
        lightDirs[i * 3 + 2] = d.z / l;
        const c = light.color ?? WHITE3;
        const k = light.intensity ?? 1;
        lightColors[i * 3] = c[0] * k;
        lightColors[i * 3 + 1] = c[1] * k;
        lightColors[i * 3 + 2] = c[2] * k;
      });
      gl!.uniform3fv(u.lightDir, lightDirs);
      gl!.uniform3fv(u.lightColor, lightColors);
      gl!.uniform1i(u.lightCount, lights.length);

      const fog = scene.fog;
      if (fog) {
        const { mode, params } = fogUniform(fog);
        gl!.uniform1i(u.fogMode, mode);
        gl!.uniform3f(u.fogColor, fog.color[0], fog.color[1], fog.color[2]);
        gl!.uniform3f(u.fogParams, params[0], params[1], params[2]);
      } else {
        gl!.uniform1i(u.fogMode, -1);
      }

      // Split opaque from transparent. Transparency in a depth-buffered
      // renderer has no exact answer; the standard approximation is to draw
      // opaque geometry first with depth writes on, then blended geometry
      // back-to-front with depth writes OFF so two transparent surfaces do not
      // occlude each other. It is wrong for interpenetrating transparent
      // meshes, and that is a known limit rather than a bug to chase.
      opaque.length = 0;
      blended.length = 0;
      overlay.length = 0;
      scene.nodes.forEach((n, i) => {
        if (!n.mesh || !n.world) return;
        if (!isVisible(scene, i)) {
          stats.culled++;
          return;
        }
        // `depthTest: false` opts out of the scene's depth entirely, so it
        // cannot share a pass with geometry that is still sorting against it.
        if (n.material?.depthTest === false) {
          overlay.push(i);
        } else if (n.material?.transparent) {
          const dx = n.world[12] - eye.x;
          const dy = n.world[13] - eye.y;
          const dz = n.world[14] - eye.z;
          blended.push({ index: i, depth: dx * dx + dy * dy + dz * dz });
        } else {
          opaque.push(i);
        }
      });

      gl!.disable(gl!.BLEND);
      gl!.depthMask(true);
      for (const i of opaque) drawNode(scene.nodes[i], scene.nodes[i].material ?? {});

      if (blended.length > 0) {
        blended.sort((a, b) => b.depth - a.depth); // farthest first
        gl!.enable(gl!.BLEND);
        // Premultiplied-alpha blending, matching the context and the textures.
        gl!.blendFuncSeparate(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
        gl!.depthMask(false);
        for (const { index } of blended) {
          drawNode(scene.nodes[index], scene.nodes[index].material ?? {});
        }
        gl!.depthMask(true);
        gl!.disable(gl!.BLEND);
      }

      if (overlay.length > 0) {
        // Last, and against a depth function that always passes. The mask
        // stays on for an opaque overlay so two of them still occlude each
        // other in draw order, which is what makes a stack of them readable.
        gl!.depthFunc(gl!.ALWAYS);
        for (const i of overlay) {
          const material = scene.nodes[i].material ?? {};
          if (material.transparent) {
            gl!.enable(gl!.BLEND);
            gl!.blendFuncSeparate(
              gl!.ONE,
              gl!.ONE_MINUS_SRC_ALPHA,
              gl!.ONE,
              gl!.ONE_MINUS_SRC_ALPHA,
            );
            gl!.depthMask(false);
          }
          drawNode(scene.nodes[i], material);
          if (material.transparent) {
            gl!.depthMask(true);
            gl!.disable(gl!.BLEND);
          }
        }
        gl!.depthFunc(gl!.LEQUAL);
      }
      gl!.bindVertexArray(null);
      endGpuQuery(gpuQuery);
      frameStats.drawCalls += stats.drawCalls;
      frameStats.triangles += stats.triangles;
      frameStats.culled += stats.culled;
      frameStats.cpuMs += performance.now() - renderStart;
    },

    release(mesh: object) {
      const gpu = meshes.get(mesh);
      if (!gpu) return;
      releaseMesh(gpu);
      meshes.delete(mesh);
    },

    dispose() {
      gl!.deleteProgram(program);
      // The rest is reachable only through the WeakMaps, which die with this
      // closure; losing the context frees them regardless.
      gl!.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return renderer;
}

const WHITE = [1, 1, 1, 1] as const;
const WHITE3 = [1, 1, 1] as const;
const UNIT_UV = [1, 1] as const;
const ZERO_UV = [0, 0] as const;
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const IDENTITY_JOINTS = new Float32Array(MAX_JOINTS * 16);
for (let i = 0; i < MAX_JOINTS; i++) {
  IDENTITY_JOINTS[i * 16] = 1;
  IDENTITY_JOINTS[i * 16 + 5] = 1;
  IDENTITY_JOINTS[i * 16 + 10] = 1;
  IDENTITY_JOINTS[i * 16 + 15] = 1;
}

function filled(n: number, value: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(value);
  return a;
}

function defaultNormals(n: number): Float32Array {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 1] = 1;
  return a;
}

function defaultJoints(n: number): Uint16Array {
  const a = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) a[i * 4] = 0;
  return a;
}

function defaultWeights(n: number): Float32Array {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a[i * 4] = 1;
  return a;
}

function link(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL2: could not create a program.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders are safe to delete once linked; the program holds what it needs.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL2: program link failed — ${log}`);
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2: could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    // The line numbers in the log refer to the source above, so print it.
    throw new Error(`WebGL2: ${kind} shader failed to compile — ${log}\n${numbered(source)}`);
  }
  return shader;
}

function numbered(source: string): string {
  return source
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
    .join("\n");
}
