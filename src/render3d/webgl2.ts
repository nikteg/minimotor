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
import {
  detailProjectionMode,
  detailWorldStep,
  fogUniform,
  ghostMaterial,
  glazeGrid,
  glazeParallax,
  glazeStrength,
  isVisible,
  settleActive,
} from "./scene.js";
import { triangleCount, vertexCount } from "./mesh.js";
import { frustumPlanes, inFrustum, meshBounds, type Frustum } from "./cull.js";
import type { Camera3D } from "./camera.js";
import type { MeshData } from "./mesh.js";
import type { Material, Node3D, Scene3D } from "./scene.js";
import type {
  RenderFrameStats,
  RenderOptions,
  RenderStats,
  RenderTarget3D,
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
// The instance transform, one per COPY rather than per vertex. A mat4 attribute
// occupies four consecutive slots, so this takes 8 through 11. Unbound on an
// ordinary draw, where uInstanced is false and uModel answers instead.
layout(location = 8) in mat4 aInstanceModel;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform bool uHasSkin;
uniform bool uInstanced;
uniform mat4 uJointMatrices[${MAX_JOINTS}];

out vec3 vWorldPos;
out vec3 vLocalPos;
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
  mat4 model = uInstanced ? aInstanceModel : uModel;
  vec4 world = model * localPosition;
  vWorldPos = world.xyz;
  vLocalPos = localPosition.xyz;
  // The inverse-transpose, so a non-uniformly scaled mesh still lights right.
  // Uploaded per draw for a single node; DERIVED here for an instanced one,
  // because sending it too would take three more attribute slots and WebGL2
  // guarantees only sixteen. It is the same inverse-transpose Mat4.normalMatrix
  // computes.
  vNormal = uInstanced ? transpose(inverse(mat3(model))) * localNormal : uNormalMat * localNormal;
  // A tangent is a DIRECTION ALONG the surface, not a normal to it, so it goes
  // through the model matrix rather than the inverse-transpose. w carries the
  // handedness and rides through untouched.
  vTangent = vec4(mat3(model) * localTangent, aTangent.w);
  vUv = aUv;
  vUv1 = aUv1;
  vColor = aColor;
  gl_Position = uViewProj * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vLocalPos;
in vec3 vNormal;
in vec2 vUv;
in vec2 vUv1;
in vec4 vColor;
in vec4 vTangent;

uniform vec4 uBaseColor;
uniform vec4 uTextureColor;
uniform vec3 uAmbient;
uniform vec3 uLightDir[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform int uLightCount;
uniform vec3 uCameraPos;
// The same matrix the vertex stage uses — a uniform is per PROGRAM, so declaring it
// here binds to that one and costs no second upload. The coat's screen tap needs it to
// find where a reflected ray goes on screen; see Glaze.screen.
uniform mat4 uViewProj;
uniform float uShininess;
uniform float uSpecular;
uniform float uMetallic;
uniform bool uUnlit;
uniform int uTextureBlend; // 0 none, 1 multiply, 2 over, 3 mask tint
uniform int uUvProjection; // 0 mesh, 1 planar XZ, 2 sphere
uniform sampler2D uTexture;
uniform bool uHasNormalMap;
uniform sampler2D uNormalMap;
uniform float uNormalScale;
uniform sampler2D uDetailMap;
uniform float uDetailStrength; // 0 disables the sample entirely
uniform bool uDetailUv1;
uniform int uDetailProjection; // 0 mesh uv, 1 planar XZ, 2 triplanar
uniform float uDetailWorldStep; // 0 off; see Material.detailWorldStep
uniform float uDetailOver; // 0 overlay; otherwise alpha-over RGB multiplier
uniform vec4 uDetailUvTransform;
uniform bool uDetailPremultiplied;
uniform bool uDetailOpacity; // Material.detailOpacity
uniform sampler2D uDetailMask;
// xy scale, zw offset, over the same source the detail map reads. A zero scale
// means there is no mask — see Material.detailMaskUvScale.
uniform vec4 uDetailMaskTransform;
uniform vec3 uRimAlpha; // bias, scale, power — see Material.rimAlpha
// x strength (0 disables every term), y fresnel exponent, z parallax offset,
// w scroll phase. See Material.glaze.
uniform vec4 uGlaze;
// xyz the faked sky's tint, w ripple frequency in waves per world unit
uniform vec4 uGlazeTint;
// x ripple tilt, y sparkle, z 1 when a cube probe is bound, w spare
uniform vec4 uGlazeWave;
// Six 90-degree faces of one point in a 3x2 atlas, +X -X +Y / -Y +Z -Z — see
// Glaze.environment and cubeProbeViews, whose cameras write this layout.
uniform sampler2D uGlazeEnvMap;
// LAST FRAME's picture of the scene — see Glaze.screen.
uniform sampler2D uGlazeScreenMap;
// x: how much is seen head-on (0 for no snapshot at all), y: how far the single tap
// reaches along the reflected ray, in screen widths.
uniform vec2 uGlazeScreen;
// The coat's BLOCK GRID and the diagonal drawn on it, packed by glazeGrid():
// x world step (0 for off), y streak amount, z streak period in world units,
// w how far the reflected ray drags the streak. See Glaze.worldStep.
uniform vec4 uGlazeGrid;
// xyz the colour that has settled, w how much collects on an up-facing face
uniform vec4 uSettle;
// x up sharpness, y the ground line's world Y, z rise height, w rise amount
uniform vec4 uSettle2;
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
// Where a direction lands in a 3x2 cube atlas — see Glaze.environment.
//
// The face choice is the ordinary cube-map one: the largest component picks the
// axis, the other two divided by it give the face's own -1..1 coordinates. The
// ORDER of the cells and the sign of each axis are the half that has to agree
// with cubeProbeViews, and the e2e measures that agreement by reflecting six
// differently coloured walls.
//
// v counts UP the atlas because a render target's rows are written the way GL
// writes them, bottom-first — the same reason readPixels flips.
vec2 glazeEnvUv(vec3 d) {
  vec3 a = abs(d);
  float ma;
  vec2 uc;
  float face;
  if (a.x >= a.y && a.x >= a.z) {
    ma = a.x;
    uc = d.x > 0.0 ? vec2(-d.z, d.y) : vec2(d.z, d.y);
    face = d.x > 0.0 ? 0.0 : 1.0;
  } else if (a.y >= a.z) {
    ma = a.y;
    uc = d.y > 0.0 ? vec2(d.x, -d.z) : vec2(d.x, d.z);
    face = d.y > 0.0 ? 2.0 : 3.0;
  } else {
    ma = a.z;
    uc = d.z > 0.0 ? vec2(d.x, d.y) : vec2(-d.x, d.y);
    face = d.z > 0.0 ? 4.0 : 5.0;
  }
  vec2 f = 0.5 * (uc / max(ma, 1e-6) + 1.0);
  // **The row is flipped and WebGPU's is not**, the same asymmetry readPixels
  // carries: cubeProbeViews lays the cells out from the TOP with the viewport it
  // renders each face into, and a GL texture's v counts from the BOTTOM. So the
  // atlas's row 0 is this sampler's row 1. MEASURED: without the flip, a ray
  // headed at the -Z wall comes back with the +Y face's colour, which is the two
  // rows swapped and nothing else.
  vec2 cell = vec2(mod(face, 3.0), 1.0 - floor(face / 3.0));
  return (cell + clamp(f, 0.0, 1.0)) / vec2(3.0, 2.0);
}

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

/** A wrapped triangle wave smoothed by the 3t^2-2t^3 interpolant a value noise
 *  uses, on -1..1.
 *
 *  Deliberately NOT sin(). Item 66 pins that the two backends draw the same
 *  frame, and a transcendental is the one thing whose last bits two compilers
 *  and two drivers are free to round differently — this is fract, abs and four
 *  multiplies, which they are not. It is also cheaper, which is a bonus rather
 *  than the reason. */
float glazeWave(float x) {
  float t = fract(x);
  float tri = 1.0 - abs(t * 2.0 - 1.0);
  return tri * tri * (3.0 - 2.0 * tri) * 2.0 - 1.0;
}

/** Two octaves of that wave along skewed axes, drifting at rates that share no
 *  small ratio, so the sum's period is long enough that nobody sees it come
 *  round. Returns a tilt in the world XZ plane. */
vec2 glazeRipple(vec2 p, float phase) {
  float a = glazeWave(p.x * 0.75 + p.y * 0.35 + phase);
  float b = glazeWave(p.y * 0.85 - p.x * 0.45 - phase * 0.63);
  float c = glazeWave(p.x * 1.90 - p.y * 1.60 + phase * 1.70);
  float d = glazeWave(p.y * 2.10 + p.x * 1.40 - phase * 1.30);
  return vec2(a + c * 0.45, b + d * 0.45);
}

/** A world position quantised to blocks of grid units, or left alone when
 *  grid is 0. ceil rather than round, matching Material.detailWorldStep,
 *  so a step of one lands on the same lattice the projected secondary map does.
 *
 *  Branch-free, and deliberately so: on is 1 for any grid at or above 1e-6
 *  and 0 for zero or a negative one, and the divisor is clamped rather than
 *  guarded so the off case never divides by zero on the arm that is discarded.
 *  Both backends therefore spell this the SAME arithmetic — a ternary here and
 *  a select() there would be two different texts for one calculation, and this
 *  helper is compared across the two mechanically. See Glaze.worldStep. */
vec2 glazeSnap(vec2 p, float grid) {
  float on = clamp(grid * 1e6, 0.0, 1.0);
  vec2 blocks = ceil(p / max(grid, 1e-6)) * grid;
  return mix(p, blocks, on);
}

/** A 45-degree triangular ramp across period units of p.x + p.y — one unit
 *  across for one unit down, so under a snapped p the staircase's steps are
 *  the blocks themselves. Triangular rather than a hard edge, so the line
 *  arrives as a few blocks of increasing brightness. See Glaze.streak. */
float glazeStreakAt(vec2 p, float period) {
  float along = fract((p.x + p.y) / period);
  return 1.0 - abs(along * 2.0 - 1.0);
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
  vec2 source = vUv;
  if (uUvProjection == 1) {
    source = vWorldPos.xz;
  } else if (uUvProjection == 2) {
    vec3 point = normalize(vLocalPos);
    source = vec2(
      atan(point.z, point.x) / (2.0 * 3.14159265359) + 0.5,
      asin(clamp(point.y, -1.0, 1.0)) / 3.14159265359 + 0.5
    );
  }
  vec2 uv = source * uUvTransform.xy + uUvTransform.zw;
  // The normal map keeps the MESH uv under a projection — see
  // Material.uvProjection. Its vectors are expressed in the frame the unwrap
  // builds, and vTangent still describes that unwrap.
  vec2 normalUv = uUvProjection == 0 ? uv : vUv;
  vec4 base = uBaseColor * vColor;
  if (uTextureBlend > 0) {
    vec4 sampled = texture(uTexture, uv);
    if (uTextureBlend == 3) {
      // Built-in ball styles are grayscale masks. Their dark regions receive
      // the mask tint while white regions retain the base ball colour.
      float mask = 1.0 - dot(sampled.rgb, vec3(0.299, 0.587, 0.114));
      base = vec4(mix(base.rgb, uTextureColor.rgb, clamp(mask, 0.0, 1.0)), base.a);
    } else {
      vec4 texel = sampled * uTextureColor;
      // Blend 2 keeps the base colour's own alpha: the texture decides colour
      // where it is opaque, not whether the surface is there at all.
      base = uTextureBlend == 2
        ? vec4(mix(base.rgb, texel.rgb, texel.a), base.a)
        : base * texel;
    }
  }
  // The glaze's normal and its one extra sample are taken HERE, up beside the
  // base texture read, and not down beside the light where the rest of the coat
  // is applied.
  //
  // WebGL2 does not need the split. WebGPU does: WGSL permits an
  // implicit-derivative sample only in uniform control flow, applyNormalMap()
  // can return early inside a branch on a derivative, and a sample placed after
  // that call therefore fails to COMPILE. The two backends are required to draw
  // the same frame, and the cheapest way to keep them drawing it is to give
  // them the same shape rather than to let one take a liberty the other cannot.
  //
  // It costs nothing anyway: a reflective coat is a layer OVER the surface, so
  // it has no business reading the surface's normal map, and the geometric
  // normal is the one it wants.
  vec3 glazeNormal = vec3(0.0, 1.0, 0.0);
  vec3 glazeUnder = vec3(0.0);
  float glazeStreak = 0.0;
  if (uGlaze.x > 0.0) {
    // The ripple's own position, snapped to blocks of a chosen world size —
    // pixelated cannot reach this term, or the grain below, because neither is
    // a texture fetch. See Glaze.worldStep. Off at zero, and the phase is never
    // snapped with it: blocky in SPACE, continuous in VALUE.
    vec2 tilt = glazeRipple(glazeSnap(vWorldPos.xz, uGlazeGrid.x) * uGlazeTint.w, uGlaze.w);
    glazeNormal = normalize(normalize(vNormal) + vec3(tilt.x, 0.0, tilt.y) * uGlazeWave.x);
    if (uGlaze.z != 0.0 || uGlazeGrid.y > 0.0) {
      vec3 toEye = normalize(uCameraPos - vWorldPos);
      vec2 bounce = reflect(-toEye, glazeNormal).xz;
      if (uGlaze.z != 0.0) {
        // The offset goes on the SOURCE coordinate, before the uv transform, so
        // it lands in whatever units the projection reads — world units under
        // planarXZ, uv under the mesh's own unwrap. See Glaze.parallax.
        vec2 under = (source + bounce * uGlaze.z) * uUvTransform.xy + uUvTransform.zw;
        glazeUnder = texture(uTexture, under).rgb;
      }
      if (uGlazeGrid.y > 0.0) {
        // The diagonal, evaluated WHERE THE REFLECTED RAY LANDS and nowhere
        // else. That is the whole of it: it slides as the camera orbits and a
        // still surface has none of it, which no pattern baked into the albedo
        // can manage — parallax re-samples that albedo, so a baked one appears
        // both here and lying flat on the floor. See Glaze.streak.
        vec2 lit = vWorldPos.xz + bounce * uGlazeGrid.w;
        glazeStreak = glazeStreakAt(glazeSnap(lit, uGlazeGrid.x), uGlazeGrid.z) * uGlazeGrid.y;
      }
    }
  }
  // Overlay while base is still in display space; alpha-over in linear light —
  // see Material.detailMap for why the two belong on opposite sides of it.
  if (uDetailStrength > 0.0) {
    // Triplanar leaves this at the mesh uv, which is what the MASK below then
    // reads: a mask is a planar-projection idea and nothing pairs the two.
    // Blocks of a chosen world size, for a projected pattern that has to read
    // as pixel art — see Material.detailWorldStep. Off at zero.
    vec3 detailPos = uDetailWorldStep > 0.0
      ? ceil(vWorldPos / uDetailWorldStep) * uDetailWorldStep
      : vWorldPos;
    vec2 detailSource = uDetailProjection == 1 ? detailPos.xz : (uDetailUv1 ? vUv1 : vUv);
    vec2 detailUv = detailSource * uDetailUvTransform.xy + uDetailUvTransform.zw;
    vec4 pattern = texture(uDetailMap, detailUv);
    if (uDetailProjection == 2) {
      // Three world-space projections blended by the face's own normal, so a
      // pattern runs across a whole shape at one density with no unwrap. The
      // exponent is what makes the seams narrow: raised to the eighth, a
      // 45-degree face is still 50/50 but a 30-degree one is already 94/6, so
      // the blend band is a few degrees wide instead of the whole quadrant.
      vec3 axis = pow(abs(normalize(vNormal)), vec3(8.0));
      axis /= max(axis.x + axis.y + axis.z, 1e-6);
      // Horizontal/vertical rather than per-plane: the ground plane takes the
      // horizontal scale on BOTH axes, so one tile is the same square however
      // a face is turned. See Material.detailUvScale.
      vec2 s = uDetailUvTransform.xy;
      vec2 o = uDetailUvTransform.zw;
      pattern = texture(uDetailMap, detailPos.zy * s + o) * axis.x
              + texture(uDetailMap, detailPos.xz * s.xx + o) * axis.y
              + texture(uDetailMap, detailPos.xy * s + o) * axis.z;
    }
    if (uDetailOver > 0.0) {
      // Both maps are scaled and linearized BEFORE they multiply, not after:
      // squaring a product of two alphas is not the product of two squares, and
      // the difference is the whole brightness of a lit decal.
      vec3 over = (uDetailPremultiplied ? pattern.rgb * pattern.a : pattern.rgb) * uDetailOver;
      if (uToneMap) over = srgbToLinear(over);
      float weight = pattern.a * uDetailStrength;
      if (uDetailMaskTransform.x != 0.0 || uDetailMaskTransform.y != 0.0) {
        vec2 maskUv = detailSource * uDetailMaskTransform.xy + uDetailMaskTransform.zw;
        vec4 mask = texture(uDetailMask, maskUv);
        vec3 cut = mask.rgb * uDetailOver;
        if (uToneMap) cut = srgbToLinear(cut);
        // The decal's own alpha comes into the RGB here as well as into the
        // weight, which is what makes a mask DARKEN rather than tint: a canvas
        // at 6% alpha contributes 6% of 6% of its light and the surface keeps
        // the rest. A hard cut at the mask's edge, not a fade, so the shape
        // stays the shape at any distance.
        over *= pattern.a * cut * mask.a;
        if (mask.a < 0.01) weight = 0.0;
      }
      base.rgb = uToneMap
        ? linearToSrgb(mix(srgbToLinear(base.rgb), over, weight))
        : mix(base.rgb, over, weight);
      // The same composite on the opacity, at the same weight — see
      // Material.detailOpacity. Straight, never through the tone curve: a
      // coverage is not a light and there is nothing to linearize.
      if (uDetailOpacity) base.a = mix(base.a, pattern.a, weight);
    } else {
      base.rgb = mix(base.rgb, blendOverlay(pattern.rgb, base.rgb), uDetailStrength);
    }
  }
  // What has SETTLED on the surface, which is albedo and therefore belongs here
  // rather than beside the light: a snow cap that did not take the scene's own
  // lighting reads as a sticker. See Material.settle.
  if (uSettle.w > 0.0 || uSettle2.w > 0.0) {
    vec3 settleN = normalize(vNormal);
    if (!gl_FrontFacing) settleN = -settleN;
    // Collects on faces that point at the sky and gives out as one tilts.
    float top = pow(max(settleN.y, 0.0), uSettle2.x) * uSettle.w;
    // And climbs from a ground line, strongest at the foot. Everything BELOW
    // the line is covered outright, which is what a ground line means — the
    // clamp is what says so, and it is why this is not symmetric.
    float foot = uSettle2.z > 0.0
      ? (1.0 - clamp((vWorldPos.y - uSettle2.y) / uSettle2.z, 0.0, 1.0)) * uSettle2.w
      : 0.0;
    // max() rather than a sum: a wall's foot and a wall's cap are the same
    // snow seen twice, and adding them drives the corner past white.
    float settled = clamp(max(top, foot), 0.0, 1.0);
    vec3 lay = uToneMap ? srgbToLinear(uSettle.rgb) : uSettle.rgb;
    base.rgb = uToneMap
      ? linearToSrgb(mix(srgbToLinear(base.rgb), lay, settled))
      : mix(base.rgb, uSettle.rgb, settled);
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
    //
    // Colour and opacity saturate SEPARATELY, before they meet. A straight-alpha
    // pipeline clamps both to [0,1] on the way into the blend and only then
    // multiplies, so a material colour above 1 is brightness the target cannot
    // hold, and an alpha above 1 is opacity that stops at fully opaque --
    // neither is licence for the other to overflow. Premultiplying first and
    // letting the write clamp the product instead turns a doubled alpha into
    // doubled brightness on every half-lit texel, which is a different picture,
    // not a rounding difference. Both clamps are no-ops for the in-range colours
    // everything else passes.
    float opacity = clamp(base.a, 0.0, 1.0);
    fragColor = vec4(clamp(plain, 0.0, 1.0) * opacity, opacity);
    return;
  }

  // Two-sided lighting: flip the normal on a back face so a doubleSided
  // material is lit rather than black on its reverse.
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  if (uHasNormalMap) n = applyNormalMap(n, normalUv);
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
  // The faked reflective coat, ADDED to the shaded surface and taken before the
  // fog, because it is light like any other — see Material.glaze.
  if (uGlaze.x > 0.0) {
    vec3 toEye = normalize(uCameraPos - vWorldPos);
    vec3 bounce = reflect(-toEye, glazeNormal);
    // Weak head-on, strong at a grazing angle. On a low orbit over a flat deck
    // this is most of what the eye reads. See Glaze.fresnel.
    float fresnel = pow(1.0 - clamp(dot(glazeNormal, toEye), 0.0, 1.0), uGlaze.y);
    // How much of the coat is seen. The faked sky is pinned low head-on so that a
    // gradient over a whole floor does not read as haze; a screen tap raises it below.
    float coat = 0.25 + 0.75 * fresnel;
    // The faked sky, looked up by the reflected ray: a two-stop vertical
    // gradient by its own height...
    // The PROBE when one is bound, and the faked two-stop gradient otherwise.
    // Only the gradient is replaced: the lobe, the sparkle and the streak below
    // are still added on top, and the tint still multiplies the lot — see
    // Glaze.environment.
    vec3 env;
    if (uGlazeWave.z > 0.5) {
      env = uGlazeTint.rgb * texture(uGlazeEnvMap, glazeEnvUv(bounce)).rgb;
    } else {
      float sky = clamp(bounce.y * 0.5 + 0.5, 0.0, 1.0);
      env = uGlazeTint.rgb * (0.25 + 0.75 * sky * sky);
    }
    // ...plus a tight lobe around the scene's OWN first light, which is what
    // actually sweeps when the camera turns. Reusing the key light rather than
    // taking a direction of its own keeps the reflection agreeing with the
    // scene it is in, and costs no uniform. With no lights there is nothing to
    // reflect, and straight up is the answer that adds no lobe anywhere.
    vec3 sun = uLightCount > 0 ? -normalize(uLightDir[0]) : vec3(0.0, 1.0, 0.0);
    float lobe = max(dot(bounce, sun), 0.0);
    float lobe2 = lobe * lobe;
    float lobe8 = lobe2 * lobe2 * lobe2 * lobe2;
    env += uGlazeTint.rgb * lobe8 * 1.5;
    // **One tap of last frame's screen, blended over the probe** — see Glaze.screen.
    //
    // The DIRECTION is exact and the DISTANCE is a guess, which is the whole shape of
    // the cheat. Projecting one world-space step along the reflected ray gives where
    // that ray goes on screen for this camera, whatever the projection; how FAR to walk
    // is the part a single tap cannot know without a depth march, so uGlazeScreen.y
    // stands in for it and the reflection drifts with height above the surface.
    //
    // Off the edge of the frame there is nothing to report — the horizon, the sky,
    // anything behind the camera — and that is where the probe answers instead, so the
    // fade is by how far outside the frame the tap landed and the two meet without a
    // seam.
    //
    // v is NOT flipped: this samples a RENDER TARGET, whose row 0 is the framebuffer's
    // bottom row, and the clip y this is derived from points the same way. The WebGPU
    // path flips because it samples a copy of the canvas, top row first. That
    // difference is measured, in e2e/glaze-screen.spec.ts and render-target.test.ts.
    if (uGlazeScreen.x > 0.0) {
      // Re-projecting the fragment costs one mat4 multiply and no varying, and puts
      // both points through the same matrix, so the two cannot disagree.
      vec4 hereClip = uViewProj * vec4(vWorldPos, 1.0);
      vec2 here = hereClip.xy / max(hereClip.w, 1e-6) * 0.5 + 0.5;
      vec4 aheadClip = uViewProj * vec4(vWorldPos + bounce, 1.0);
      vec2 ahead = aheadClip.xy / max(aheadClip.w, 1e-6) * 0.5 + 0.5;
      vec2 stride = ahead - here;
      vec2 tap = here + stride / max(length(stride), 1e-5) * uGlazeScreen.y;
      // How far outside 0..1 the tap fell, in the worse axis.
      vec2 outside = max(max(-tap, tap - 1.0), 0.0);
      float away = clamp(max(outside.x, outside.y) * 12.0, 0.0, 1.0);
      // How much of the tap is usable, and the ONE weight both halves lerp by, so a
      // surface never shows a colour at a strength that colour was not given.
      float take = 1.0 - away;
      env = mix(env, uGlazeTint.rgb * texture(uGlazeScreenMap, clamp(tap, 0.0, 1.0)).rgb, take);
      // A real reflection is not haze, so it does not ride the Fresnel down to a
      // quarter head-on the way the faked sky must — it carries its own head-on
      // weight and still rises to full at a grazing angle. See Glaze.screenStrength.
      // MIXED and not maxed: with a max, any strength under the sky's own 0.25 floor
      // did nothing at all, so the setting was inert over a quarter of its range.
      coat = mix(coat, mix(uGlazeScreen.x, 1.0, fresnel), take);
    }
    // The grain, an octave far above the ripple and gated by that same lobe so
    // it glitters where the light is instead of everywhere. See Glaze.sparkle.
    if (uGlazeWave.y > 0.0) {
      vec2 grain = glazeRipple(
        glazeSnap(vWorldPos.xz, uGlazeGrid.x) * uGlazeTint.w * 9.0,
        uGlaze.w * 2.3
      );
      float g = clamp(grain.x * grain.y, 0.0, 1.0);
      float g2 = g * g;
      env += uGlazeTint.rgb * (g2 * g2 * g2) * uGlazeWave.y * (0.25 + lobe8);
    }
    // The diagonal goes into the SKY and not into what is under the ice, so it
    // fades out with the rest of the reflection instead of staying behind on the
    // albedo. Its position was taken up beside the coat's other sample.
    env += uGlazeTint.rgb * glazeStreak;
    if (uToneMap) env = srgbToLinear(env);
    // The sky takes over at a grazing angle and what is UNDER the ice shows
    // head-on, which is the right way round and is why the two weights are
    // complements rather than both riding the Fresnel.
    vec3 under = uToneMap ? srgbToLinear(glazeUnder) : glazeUnder;
    shaded += (env * coat + under * (1.0 - fresnel) * 0.5) * uGlaze.x;
  }
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
  /** What the buffers were SIZED and shaped for, so a rewrite can tell "the
   *  same mesh with new numbers" from "a different mesh". */
  vertices: number;
  indices: number;
  attributes: number;
  /** Whether the index buffer holds 16- or 32-bit indices. A rewrite that
   *  changes width cannot reuse the storage: `gpu.type` is fixed at creation and
   *  the draw would read the new data with the old stride. */
  indexBytes: number;
  /** Per-instance transforms, allocated the first time this mesh is drawn as a
   *  batch and reused after. Null for a mesh only ever drawn one at a time. */
  instances: WebGLBuffer | null;
  instanceCapacity: number;
}

/** A bitmask of the optional attributes a mesh supplies. The defaults filled in
 *  for a missing one are built at upload time and sized there, so a mesh that
 *  gains or loses one needs its buffers rebuilt rather than refilled. */
function attributeMask(mesh: MeshData): number {
  return (
    (mesh.normals ? 1 : 0) |
    (mesh.uvs ? 2 : 0) |
    (mesh.colors ? 4 : 0) |
    (mesh.joints ? 8 : 0) |
    (mesh.weights ? 16 : 0) |
    (mesh.uvs1 ? 32 : 0) |
    (mesh.tangents ? 64 : 0)
  );
}

interface Uniforms {
  viewProj: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  instanced: WebGLUniformLocation | null;
  normalMat: WebGLUniformLocation | null;
  baseColor: WebGLUniformLocation | null;
  textureColor: WebGLUniformLocation | null;
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
  uvProjection: WebGLUniformLocation | null;
  texture: WebGLUniformLocation | null;
  hasNormalMap: WebGLUniformLocation | null;
  normalMap: WebGLUniformLocation | null;
  normalScale: WebGLUniformLocation | null;
  detailMap: WebGLUniformLocation | null;
  detailStrength: WebGLUniformLocation | null;
  detailUv1: WebGLUniformLocation | null;
  detailProjection: WebGLUniformLocation | null;
  detailWorldStep: WebGLUniformLocation | null;
  detailOver: WebGLUniformLocation | null;
  detailUvTransform: WebGLUniformLocation | null;
  detailPremultiplied: WebGLUniformLocation | null;
  detailOpacity: WebGLUniformLocation | null;
  detailMask: WebGLUniformLocation | null;
  detailMaskTransform: WebGLUniformLocation | null;
  rimAlpha: WebGLUniformLocation | null;
  glaze: WebGLUniformLocation | null;
  glazeTint: WebGLUniformLocation | null;
  glazeWave: WebGLUniformLocation | null;
  glazeEnvMap: WebGLUniformLocation | null;
  glazeScreenMap: WebGLUniformLocation | null;
  glazeScreen: WebGLUniformLocation | null;
  glazeGrid: WebGLUniformLocation | null;
  settle: WebGLUniformLocation | null;
  settle2: WebGLUniformLocation | null;
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
  /** Skip drawing nodes the camera cannot see. Default ON.
   *
   *  Cost otherwise follows the size of the WORLD rather than the size of the
   *  view, so a bigger level is slower everywhere, including in the corner the
   *  player is looking at. MEASURED on a consumer's level: 416 drawable nodes
   *  down to 91 draws.
   *
   *  **It was once blamed for geometry vanishing in plain sight and it was
   *  innocent** — the culprit was an element-buffer rebind that repointed one
   *  mesh's indices at another, shipped in the same batch. Verified since by
   *  sweeping 32 camera angles over a real level and finding no node dropped
   *  while any of its own vertices were on screen.
   *
   *  The one case this cannot see is a node placed AFTER the world matrices are
   *  solved: it would be tested against a stale matrix. Nothing in the engine
   *  does that, but a consumer that does has this switch. */
  frustumCulling?: boolean;
  /** Draw a run of nodes sharing one mesh AND one material as a single
   *  instanced call. Default ON. Needs the loader to share both, which it does.
   *  Skinned nodes are never batched — the pose is a uniform. */
  instancing?: boolean;
  /** DIAGNOSTIC ONLY: world units added to every culled box before testing. A
   *  margin that fixes the picture means the arithmetic is slightly tight; a
   *  margin that does not means the box is in the wrong PLACE. */
  cullMargin?: number;
  /** Build a mip chain for every smooth texture and sample it trilinearly.
   *
   *  Off by default, because it CHANGES THE PICTURE: a minified texture stops
   *  sampling its full-resolution texels and starts sampling a filtered
   *  average, which is what removes the shimmer a texture minified across a
   *  large surface produces as the camera moves — and it is a different image,
   *  softer at distance.
   *
   *  Orthogonal to `antialias`, which is multisampling: MSAA resolves GEOMETRY
   *  edges and does nothing for texture minification, since the fragment shader
   *  runs once per pixel however many samples that pixel has.
   *
   *  `pixelated` textures are exempt: a sprite sheet asking for NEAREST is
   *  asking not to be filtered, and a mip chain is filtering. */
  mipmaps?: boolean;
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
  const mipmaps = opts.mipmaps ?? false;
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
    instanced: gl.getUniformLocation(program, "uInstanced"),
    normalMat: gl.getUniformLocation(program, "uNormalMat"),
    baseColor: gl.getUniformLocation(program, "uBaseColor"),
    textureColor: gl.getUniformLocation(program, "uTextureColor"),
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
    uvProjection: gl.getUniformLocation(program, "uUvProjection"),
    texture: gl.getUniformLocation(program, "uTexture"),
    hasNormalMap: gl.getUniformLocation(program, "uHasNormalMap"),
    normalMap: gl.getUniformLocation(program, "uNormalMap"),
    normalScale: gl.getUniformLocation(program, "uNormalScale"),
    detailMap: gl.getUniformLocation(program, "uDetailMap"),
    detailStrength: gl.getUniformLocation(program, "uDetailStrength"),
    detailUv1: gl.getUniformLocation(program, "uDetailUv1"),
    detailProjection: gl.getUniformLocation(program, "uDetailProjection"),
    detailWorldStep: gl.getUniformLocation(program, "uDetailWorldStep"),
    detailOver: gl.getUniformLocation(program, "uDetailOver"),
    detailUvTransform: gl.getUniformLocation(program, "uDetailUvTransform"),
    detailPremultiplied: gl.getUniformLocation(program, "uDetailPremultiplied"),
    detailOpacity: gl.getUniformLocation(program, "uDetailOpacity"),
    detailMask: gl.getUniformLocation(program, "uDetailMask"),
    detailMaskTransform: gl.getUniformLocation(program, "uDetailMaskTransform"),
    rimAlpha: gl.getUniformLocation(program, "uRimAlpha"),
    glaze: gl.getUniformLocation(program, "uGlaze"),
    glazeTint: gl.getUniformLocation(program, "uGlazeTint"),
    glazeWave: gl.getUniformLocation(program, "uGlazeWave"),
    glazeEnvMap: gl.getUniformLocation(program, "uGlazeEnvMap"),
    glazeScreenMap: gl.getUniformLocation(program, "uGlazeScreenMap"),
    glazeScreen: gl.getUniformLocation(program, "uGlazeScreen"),
    glazeGrid: gl.getUniformLocation(program, "uGlazeGrid"),
    settle: gl.getUniformLocation(program, "uSettle"),
    settle2: gl.getUniformLocation(program, "uSettle2"),
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
  /** Sources re-uploaded at least once — a canvas the app repaints. */
  const live = new WeakSet<object>();

  let width = opts.width ?? 300;
  let height = opts.height ?? 150;
  let dpr = opts.dpr ?? 1;

  const viewProj = Mat4.create();
  /** The frustum this frame, rebuilt once per pass from `viewProj`. */
  const planes: Frustum = new Float32Array(24);
  const frustumCulling = opts.frustumCulling ?? true;
  const instancing = opts.instancing ?? true;
  /** DIAGNOSTIC — see `inFrustum`'s `margin`. */
  const cullMargin = opts.cullMargin ?? 0;
  /** The material whose uniforms and TEXTURE BINDINGS are currently loaded, so
   *  a run of nodes sharing one material sets them once. Cleared before every
   *  pass — see `setMaterial`. */
  /** The frame's own copy — see `captureFrame`. Allocated on the first capture and
   * resized with the canvas, because it has to match it exactly. */
  let snapshot: RenderTarget3D | null = null;
  let lastMaterial: Material | null = null;
  /** Bumped whenever a texture is actually uploaded.
   *
   *  `setMaterial` binds textures as well as writing uniforms, and
   *  `uploadTexture` binds on its own account — a live surface re-uploading
   *  mid-frame (a ground overlay repainted while something moves over it) leaves
   *  ITS texture bound to the unit. A run may therefore only skip work while
   *  nothing has touched the bindings since it was set. */
  let textureEpoch = 0;
  let lastMaterialEpoch = -1;
  /** A stable number per material object, for sorting the opaque pass into
   *  runs. A `WeakMap` so a material that goes out of use goes with it. */
  const materialOrder = new WeakMap<Material, number>();
  let materialOrderNext = 0;
  function materialKey(material: Material | undefined): number {
    if (!material) return -1;
    let key = materialOrder.get(material);
    if (key === undefined) {
      key = materialOrderNext++;
      materialOrder.set(material, key);
    }
    return key;
  }
  /** Whether `uJointMatrices` currently holds a real pose rather than identity.
   *  Starts true so the first draw writes the array — see `drawNode`. */
  let jointsHoldPose = true;
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
  /** `occludedAlpha` nodes, drawn a second time where something covers them. */
  const occluded: number[] = [];
  /** `occludesOverlays` nodes, re-drawn for their shape alone so an opted-in
   *  overlay has something — and only that something — to be hidden behind. */
  const overlayOccluders: number[] = [];

  /** Premultiplied-alpha blending, matching the context and the textures, or
   *  addition for a surface that emits light rather than covering what is
   *  behind it. Both keep the source premultiplied, so the only thing that
   *  changes is what happens to the destination. */
  function setBlendMode(additive: boolean): void {
    if (additive) gl!.blendFuncSeparate(gl!.ONE, gl!.ONE, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    else gl!.blendFuncSeparate(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
  }

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
    // **A rewrite of the same shape refills the buffers already there.** A
    // particle emitter bumps its version every frame — rewriting its vertices is
    // what it IS — and rebuilding meant deleting a VAO and nine buffers and
    // creating nine more, per emitter per frame. That is the allocation pattern
    // drivers punish hardest, since a deleted buffer may still be referenced by
    // in-flight commands.
    //
    // Everything about the shape has to match, including the INDEX WIDTH: the
    // draw reads `gpu.type`, fixed at creation, so 32-bit indices written into a
    // buffer described as 16-bit would draw garbage.
    if (
      cached &&
      cached.vertices === vertexCount(mesh) &&
      cached.indices === mesh.indices.length &&
      cached.attributes === attributeMask(mesh) &&
      cached.indexBytes === mesh.indices.BYTES_PER_ELEMENT
    ) {
      return refillMesh(cached, mesh);
    }
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
      vertices: n,
      indices: mesh.indices.length,
      attributes: attributeMask(mesh),
      indexBytes: mesh.indices.BYTES_PER_ELEMENT,
      instances: null,
      instanceCapacity: 0,
    };
    meshes.set(mesh, gpu);
    return gpu;
  }

  /** Write new numbers into buffers that are already the right size.
   *
   * Only the attributes the mesh actually supplies are re-sent: the defaults
   * standing in for the others cannot have changed, because a change to WHICH
   * attributes exist is what `attributeMask` refuses above. */
  function refillMesh(gpu: GpuMesh, mesh: MeshData): GpuMesh {
    // **Bind this mesh's own VAO first, and that is not tidiness.**
    // `ELEMENT_ARRAY_BUFFER` is VAO STATE in WebGL2, and `uploadMesh` runs
    // before the draw binds anything — so whatever VAO the PREVIOUS draw left
    // bound is still bound here. Rebinding the element buffer without this
    // rewrites that other mesh's index binding to point at ours, and it then
    // draws with indices belonging to a different mesh: garbage triangles,
    // which read on screen as props going black and thin geometry vanishing.
    // MEASURED exactly that way before this line existed.
    //
    // `ARRAY_BUFFER` is not VAO state and needs no such care; it is bound here
    // only so `bufferSubData` knows where to write.
    gl!.bindVertexArray(gpu.vao);
    const refill = (index: number, data: Float32Array | undefined): void => {
      if (!data) return;
      gl!.bindBuffer(gl!.ARRAY_BUFFER, gpu.buffers[index]!);
      gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, data);
    };
    refill(0, mesh.positions);
    refill(1, mesh.normals);
    refill(2, mesh.uvs);
    refill(3, mesh.colors);
    if (mesh.joints) {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, gpu.buffers[4]!);
      gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, mesh.joints);
    }
    refill(5, mesh.weights);
    refill(6, mesh.uvs1);
    refill(7, mesh.tangents);
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, gpu.indexBuffer);
    gl!.bufferSubData(gl!.ELEMENT_ARRAY_BUFFER, 0, mesh.indices);
    gl!.bindVertexArray(null);
    gpu.version = mesh.version;
    return gpu;
  }

  function releaseMesh(gpu: GpuMesh): void {
    gl!.deleteVertexArray(gpu.vao);
    for (const buffer of gpu.buffers) gl!.deleteBuffer(buffer);
    gl!.deleteBuffer(gpu.indexBuffer);
    if (gpu.instances) gl!.deleteBuffer(gpu.instances);
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
    textureEpoch++;
    const tex = cached?.texture ?? gl!.createTexture();
    if (!tex) throw new Error("WebGL2: could not create a texture.");
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    // Keep sampled textures straight-alpha; both backends premultiply once in
    // their fragment shader when writing to the premultiplied canvas.
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source);
    const filter = pixelated ? gl!.NEAREST : gl!.LINEAR;
    // A source that comes back with a new version is a canvas the app repaints,
    // and rebuilding its chain per upload buys nothing on a surface being
    // redrawn rather than receding.
    if (cached && cached.version !== version) live.add(source as object);
    const mipped = mipmaps && !pixelated && !live.has(source as object);
    if (mipped) gl!.generateMipmap(gl!.TEXTURE_2D);
    gl!.texParameteri(
      gl!.TEXTURE_2D,
      gl!.TEXTURE_MIN_FILTER,
      mipped ? gl!.LINEAR_MIPMAP_LINEAR : filter,
    );
    // MAGnification has no smaller level to reach for, so it is unchanged.
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

  /** Load one material's uniforms and texture bindings, unless the last draw
   *  already left exactly those loaded.
   *
   *  A level draws far more nodes than it has materials, so a run of them sharing
   *  one is worth 24-40 GL calls a node. The guard is identity AND the texture
   *  epoch: identity alone was not enough, because binding is global state that
   *  an upload between two draws can move.
   *
   *  Cleared before each pass by the caller, so a material mutated between
   *  frames — a per-area repaint does exactly that — is re-read on the next
   *  frame's first draw of it. */
  function setMaterial(material: Material): void {
    if (material === lastMaterial && textureEpoch === lastMaterialEpoch) return;
    const color = material.color ?? WHITE;
    gl!.uniform4f(u.baseColor, color[0], color[1], color[2], color[3]);
    const textureColor = material.textureColor ?? WHITE;
    gl!.uniform4f(
      u.textureColor,
      textureColor[0],
      textureColor[1],
      textureColor[2],
      textureColor[3],
    );
    gl!.uniform1f(u.shininess, material.shininess ?? 0);
    gl!.uniform1f(u.specular, material.specular ?? 0.25);
    gl!.uniform1f(u.metallic, material.metallic ?? 0);
    gl!.uniform1i(u.unlit, material.unlit ? 1 : 0);

    const pixelated = material.pixelated ?? true;
    const repeat = material.repeat ?? false;
    const uvScale = material.uvScale ?? UNIT_UV;
    const uvOffset = material.uvOffset ?? ZERO_UV;
    gl!.uniform4f(u.uvTransform, uvScale[0], uvScale[1], uvOffset[0], uvOffset[1]);
    gl!.uniform1i(
      u.uvProjection,
      material.uvProjection === "planarXZ" ? 1 : material.uvProjection === "sphere" ? 2 : 0,
    );

    if (material.texture) {
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(
        gl!.TEXTURE_2D,
        uploadTexture(material.texture, pixelated, material.textureVersion ?? 0, repeat),
      );
      gl!.uniform1i(u.texture, 0);
      gl!.uniform1i(
        u.textureBlend,
        material.textureBlend === "mask" ? 3 : material.textureBlend === "over" ? 2 : 1,
      );
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
      gl!.uniform1i(u.detailProjection, detailProjectionMode(material));
      gl!.uniform1f(u.detailWorldStep, detailWorldStep(material));
      gl!.uniform1f(
        u.detailOver,
        material.detailBlend === "over" ? (material.detailColorScale ?? 1) : 0,
      );
      const projected = material.detailUv === 1 || detailProjectionMode(material) !== 0;
      const detailScale = material.detailUvScale ?? (projected ? UNIT_UV : uvScale);
      const detailOffset = material.detailUvOffset ?? (projected ? ZERO_UV : uvOffset);
      gl!.uniform4f(
        u.detailUvTransform,
        detailScale[0],
        detailScale[1],
        detailOffset[0],
        detailOffset[1],
      );
      gl!.uniform1i(u.detailPremultiplied, material.detailPremultiplied ? 1 : 0);
      // Needs `transparent`: an opaque surface's alpha is written to a channel
      // nothing reads, and letting a decal move it there would only invite a
      // pipeline change to start showing holes in a floor.
      gl!.uniform1i(u.detailOpacity, material.detailOpacity && material.transparent ? 1 : 0);
      // A mask tiles by definition, so it rides the material's own `repeat`
      // rather than asking for its own sampler — see Material.detailMask.
      const maskScale = material.detailMask ? material.detailMaskUvScale : undefined;
      if (maskScale && (maskScale[0] !== 0 || maskScale[1] !== 0)) {
        const maskOffset = material.detailMaskUvOffset ?? ZERO_UV;
        gl!.activeTexture(gl!.TEXTURE3);
        gl!.bindTexture(
          gl!.TEXTURE_2D,
          uploadTexture(material.detailMask!, pixelated, material.detailMaskVersion ?? 0, repeat),
        );
        gl!.uniform1i(u.detailMask, 3);
        gl!.uniform4f(
          u.detailMaskTransform,
          maskScale[0],
          maskScale[1],
          maskOffset[0],
          maskOffset[1],
        );
      } else {
        gl!.uniform4f(u.detailMaskTransform, 0, 0, 0, 0);
      }
    }
    gl!.uniform1f(u.detailStrength, detailStrength);

    // `[1, 0, 1]` is the identity ramp: bias 1 with no grazing term leaves the
    // alpha exactly as authored, and the shader's own `scale != 0` test skips
    // the pow() entirely.
    const rim = material.rimAlpha;
    gl!.uniform3f(u.rimAlpha, rim?.[0] ?? 1, rim?.[1] ?? 0, rim?.[2] ?? 1);

    // The faked reflective coat. `glazeStrength` is the one test the shader
    // branches the whole thing on, and `glazeParallax` is what stops a material
    // with no albedo from re-sampling whatever the last draw left on unit 0 —
    // both resolved in scene.ts so the two backends cannot disagree about it.
    const glaze = glazeStrength(material);
    gl!.uniform4f(
      u.glaze,
      glaze,
      material.glaze?.fresnel ?? 4,
      glazeParallax(material),
      material.glaze?.scroll ?? 0,
    );
    if (glaze > 0) {
      const tint = material.glaze?.tint ?? WHITE3;
      gl!.uniform4f(u.glazeTint, tint[0], tint[1], tint[2], material.glaze?.scrollScale ?? 0.25);
      // The probe's own GL texture, or null when this material has none or the
      // target came from the other backend — a probe that cannot be read is the
      // faked gradient, not a thrown frame.
      const probe = material.glaze?.environment
        ? targetTextureOrNull(material.glaze.environment)
        : null;
      gl!.uniform4f(
        u.glazeWave,
        material.glaze?.ripple ?? 0.08,
        material.glaze?.sparkle ?? 0,
        probe ? 1 : 0,
        0,
      );
      // Unit 4, after the surface, normal, detail and mask textures. Bound only
      // when there is a probe: the sampler is left pointing at whatever was there
      // otherwise, and the shader does not read it — `uGlazeWave.z` gates it.
      if (probe) {
        gl!.activeTexture(gl!.TEXTURE4);
        gl!.bindTexture(gl!.TEXTURE_2D, probe);
        gl!.uniform1i(u.glazeEnvMap, 4);
      }
      // Unit 5, last frame's screen — see Glaze.screen. The strength doubles as the
      // flag: no snapshot and no strength mean the same thing.
      const screen = material.glaze?.screen ? targetTextureOrNull(material.glaze.screen) : null;
      gl!.uniform2f(
        u.glazeScreen,
        screen ? (material.glaze?.screenStrength ?? 0.7) : 0,
        material.glaze?.screenReach ?? 0.25,
      );
      if (screen) {
        gl!.activeTexture(gl!.TEXTURE5);
        gl!.bindTexture(gl!.TEXTURE_2D, screen);
        gl!.uniform1i(u.glazeScreenMap, 5);
      }
      // The block grid and its diagonal, resolved and packed in scene.ts — the
      // streak's period gates its amount there, because the shader divides by
      // that period and an amount without one is a NaN rather than a faint line.
      const grid = glazeGrid(material);
      gl!.uniform4f(u.glazeGrid, grid[0], grid[1], grid[2], grid[3]);
    }

    // What has settled on it. Both weights go to zero when `settleActive` says
    // there is nothing to lay on, which is what keeps the shader's own
    // `w > 0` test from reaching a half-configured wash.
    const settle = settleActive(material) ? material.settle : undefined;
    const laid = settle?.color ?? WHITE3;
    gl!.uniform4f(u.settle, laid[0], laid[1], laid[2], settle?.up ?? 0);
    gl!.uniform4f(
      u.settle2,
      settle?.upSharpness ?? 4,
      settle?.baseY ?? 0,
      settle?.rise ?? 0,
      settle?.riseAmount ?? 0,
    );

    if (material.doubleSided) gl!.disable(gl!.CULL_FACE);
    else gl!.enable(gl!.CULL_FACE);
    lastMaterial = material;
    lastMaterialEpoch = textureEpoch;
  }

  /** Scratch for the instance transforms, grown to the largest batch seen. */
  let instanceData = new Float32Array(0);

  /** The opaque pass, drawing runs of one mesh AND one material as a single
   *  instanced call.
   *
   *  **What is left to save.** The material run already removed the expensive
   *  part of a draw — the twenty-odd uniform writes — so what remains per node is
   *  the model matrix, the normal matrix and the call itself. Instancing folds a
   *  run of those into one buffer upload and one call, and a level repeats its
   *  geometry heavily, so the runs are long where it matters.
   *
   *  **Only where it is free of consequence.** A skinned node keeps its own
   *  draw: the pose is a uniform array, so two copies in one call would wear the
   *  same skeleton. A run of one is drawn the ordinary way rather than as a batch
   *  of one, which would pay an upload to save nothing. The frame is unchanged —
   *  this is how the same geometry is SUBMITTED, not what is drawn. */
  function drawOpaque(scene: Scene3D, order: readonly number[]): void {
    let at = 0;
    while (at < order.length) {
      const first = scene.nodes[order[at]]!;
      const material = first.material ?? {};
      const mesh = first.mesh;
      let end = at + 1;
      if (instancing && mesh && !first.skin) {
        while (end < order.length) {
          const next = scene.nodes[order[end]]!;
          if (next.mesh !== mesh || (next.material ?? {}) !== material || next.skin) break;
          end++;
        }
      }
      if (end - at > 1 && mesh) drawInstanced(scene, order, at, end, mesh, material);
      else for (let i = at; i < end; i++) drawNode(scene.nodes[order[i]]!, material);
      at = end;
    }
  }

  function drawInstanced(
    scene: Scene3D,
    order: readonly number[],
    from: number,
    to: number,
    mesh: MeshData,
    material: Material,
  ): void {
    const count = to - from;
    const gpu = uploadMesh(mesh);
    if (instanceData.length < count * 16) instanceData = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      instanceData.set(scene.nodes[order[from + i]]!.world!, i * 16);
    }
    // The VAO first, for `refillMesh`'s reason: the attribute pointers set below
    // are VAO state and must land on this mesh's own.
    gl!.bindVertexArray(gpu.vao);
    if (!gpu.instances) {
      const buffer = gl!.createBuffer();
      if (!buffer) throw new Error("WebGL2: could not create an instance buffer.");
      gpu.instances = buffer;
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, gpu.instances);
    if (gpu.instanceCapacity < count) {
      gl!.bufferData(gl!.ARRAY_BUFFER, count * 16 * 4, gl!.DYNAMIC_DRAW);
      gpu.instanceCapacity = count;
      // A mat4 attribute is four consecutive vec4 slots, each advancing once per
      // INSTANCE rather than once per vertex — that divisor is the mechanism.
      for (let slot = 0; slot < 4; slot++) {
        const location = 8 + slot;
        gl!.enableVertexAttribArray(location);
        gl!.vertexAttribPointer(location, 4, gl!.FLOAT, false, 64, slot * 16);
        gl!.vertexAttribDivisor(location, 1);
      }
    }
    gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, instanceData, 0, count * 16);
    setMaterial(material);
    gl!.uniform1i(u.instanced, 1);
    gl!.uniform1i(u.hasSkin, 0);
    gl!.drawElementsInstanced(
      mesh.topology === "lines" ? gl!.LINES : gl!.TRIANGLES,
      gpu.count,
      gpu.type,
      0,
      count,
    );
    gl!.uniform1i(u.instanced, 0);
    stats.drawCalls++;
    stats.triangles += triangleCount(mesh) * count;
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
    // **The array stays WRITTEN, but not rewritten for every draw.**
    //
    // Uploading 64 identity matrices — 4 KB of driver-side validate-and-copy —
    // for a node with no skin is work for a uniform the shader guards behind
    // `if (uHasSkin)`. Skipping it entirely turned props black and made a
    // transparent quad vanish, MEASURED on a real level: an unwritten
    // default-block array appears to leave the rest of the block undefined on
    // some drivers, and garbage in the rest of the block is exactly that.
    //
    // So the array is written once and then only when it has to CHANGE: after a
    // skinned draw has put a pose in it, the next unskinned draw puts identity
    // back. A scene with no skins pays one upload for the whole frame; one with
    // a character pays two per character.
    if (skin) {
      gl!.uniformMatrix4fv(u.jointMatrices, false, skin);
      jointsHoldPose = true;
    } else if (jointsHoldPose) {
      gl!.uniformMatrix4fv(u.jointMatrices, false, IDENTITY_JOINTS);
      jointsHoldPose = false;
    }

    setMaterial(material);

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

      // **Offscreen or on the canvas**, and the difference is three things: the
      // framebuffer bound, the size the viewport covers, and the aspect the
      // projection is built from. A target owns its own pixels and has no
      // device ratio — see `RenderTarget3D` — so it is not scaled by `dpr`, and
      // its rectangle starts at the origin because there is no larger backing
      // store to align a crop within.
      const offscreen = opts.target;
      const fullW = offscreen ? offscreen.width : Math.max(1, Math.round(width * dpr));
      const fullH = offscreen ? offscreen.height : Math.max(1, Math.round(height * dpr));
      // WebGL's origin is bottom-left, while the 2D crop in viewport3d reads
      // from the canvas's top-left. Keep the active render rectangle aligned
      // with that crop when the backing store is larger than this viewport.
      const fullY = offscreen ? 0 : canvas.height - fullH;
      // **A rect within that, for an atlas — see `RenderOptions.viewport`.** Given
      // from the TOP-LEFT, so the flip lands here rather than in the caller: a
      // face at `y: 0` is the top row of what `readPixels` hands back.
      const rect = opts.viewport;
      const targetW = rect ? Math.max(1, Math.round(rect.width)) : fullW;
      const targetH = rect ? Math.max(1, Math.round(rect.height)) : fullH;
      const targetX = rect ? Math.round(rect.x) : 0;
      const targetY = rect ? fullY + Math.max(0, fullH - Math.round(rect.y) - targetH) : fullY;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, offscreen ? targetFramebufferOf(offscreen) : null);
      gl!.viewport(targetX, targetY, targetW, targetH);
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
        // The FULL destination, not `rect`. WebGPU's `loadOp` clear cannot be
        // confined to a rectangle, so confining this one would give `clear` two
        // meanings on the two backends — see `RenderOptions.viewport`.
        gl!.scissor(0, fullY, fullW, fullH);
        gl!.depthMask(true);
        gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
        gl!.disable(gl!.SCISSOR_TEST);
      }
      if (scene.nodes.length === 0) {
        // The target is unbound on THIS exit as well as the one below it: an
        // empty scene still cleared into it, and leaving a framebuffer bound
        // would send the next caller's canvas render offscreen.
        if (offscreen) gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
        endGpuQuery(gpuQuery);
        frameStats.drawCalls += stats.drawCalls;
        frameStats.triangles += stats.triangles;
        frameStats.culled += stats.culled;
        frameStats.cpuMs += performance.now() - renderStart;
        return;
      }

      gl!.useProgram(program);
      lastMaterial = null;
      // The TARGET's aspect when there is one, and the LOGICAL canvas ratio
      // otherwise — not `targetW / targetH`, whose rounding to whole physical
      // pixels would shift every existing render by a hair.
      viewProjection(
        camera,
        rect
          ? rect.width / rect.height
          : offscreen
            ? offscreen.width / offscreen.height
            : width / height,
        false,
        viewProj,
      );
      // AFTER the projection is built, not before: planes off a stale matrix
      // would cull against last frame's camera.
      frustumPlanes(viewProj, planes);
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
      occluded.length = 0;
      overlayOccluders.length = 0;
      scene.nodes.forEach((n, i) => {
        if (!n.mesh || !n.world) return;
        if (!isVisible(scene, i)) {
          stats.culled++;
          return;
        }
        if (frustumCulling && !inFrustum(planes, meshBounds(n.mesh), n.world, cullMargin)) {
          stats.culled++;
          return;
        }
        // An overlay's depth is not the scene's depth — it was drawn with the
        // test off — so nominating one as an occluder would mask the overlays
        // behind a shape that never sorted against anything.
        if (n.material?.occludesOverlays && n.material.depthTest !== false) {
          overlayOccluders.push(i);
        }
        // A ghost pass is IN ADDITION to whichever pass the node belongs to:
        // the surface still draws normally where it is visible.
        // An overlay is already drawn over everything, so a ghost of it would
        // paint the same picture twice.
        if ((n.material?.occludedAlpha ?? 0) > 0 && n.material?.depthTest !== false) {
          occluded.push(i);
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
          // Keyed HERE rather than in the comparator, so the numbers follow
          // scene order and a stable sort leaves a scene with no repeats alone.
          materialKey(n.material);
          opaque.push(i);
        }
      });

      gl!.disable(gl!.BLEND);
      gl!.depthMask(true);
      lastMaterial = null;
      // Sorted by material so nodes sharing one arrive as a run — which is what
      // both the material cache and the instanced batch below consume. Opaque
      // draws are order-independent under the depth test, so this is
      // pixel-identical; the keys are handed out as the scene is gathered and
      // the sort is stable, so a scene with no repeats keeps its authored order.
      // Sorted by material so nodes sharing one arrive as a run, which is what
      // both the material cache and the instanced batch consume.
      //
      // **Deliberately NOT also ordered near-to-far.** Early-Z would reject
      // hidden fragments before shading them, and it was tried: MEASURED as a
      // paired A/B over three passes and twelve bearings, it came to −2.7% of
      // GPU time, scattered from −14% to +5% — mostly noise. And the platform
      // that needs it least is the one that matters most here: a tile-based
      // deferred GPU already avoids shading hidden fragments in hardware, so the
      // sort buys nearly nothing on a phone while complicating a hot path.
      opaque.sort(
        (a, b) => materialKey(scene.nodes[a].material) - materialKey(scene.nodes[b].material),
      );
      drawOpaque(scene, opaque);

      if (blended.length > 0) {
        blended.sort((a, b) => b.depth - a.depth); // farthest first
        lastMaterial = null;
        gl!.enable(gl!.BLEND);
        gl!.depthMask(false);
        // The blend function is per node rather than per pass: `additive`
        // surfaces sit in this same pass, since addition commutes and needs no
        // sorting of its own.
        let additive: boolean | null = null;
        for (const { index } of blended) {
          const material = scene.nodes[index].material ?? {};
          if (!!material.additive !== additive) {
            additive = !!material.additive;
            setBlendMode(additive);
          }
          drawNode(scene.nodes[index], material);
        }
        gl!.depthMask(true);
        gl!.disable(gl!.BLEND);
      }

      if (occluded.length > 0) {
        // The ghost half of `occludedAlpha`: the same node again, with the
        // depth test REVERSED, so it paints only where the scene is already
        // in front of it. Depth writes stay off — a hint that wrote depth
        // would occlude the geometry doing the occluding.
        //
        // After the blended pass, so it blends over whatever is covering the
        // node, and before the overlays, which are meant to sit above
        // everything including this.
        gl!.depthFunc(gl!.GREATER);
        gl!.depthMask(false);
        gl!.enable(gl!.BLEND);
        setBlendMode(false);
        lastMaterial = null;
        for (const i of occluded) {
          drawNode(scene.nodes[i], ghostMaterial(scene.nodes[i].material ?? {}));
        }
        gl!.disable(gl!.BLEND);
        gl!.depthMask(true);
        gl!.depthFunc(gl!.LEQUAL);
      }

      if (overlay.length > 0) {
        // Both halves of the `occludesOverlays`/`overlayOccluded` pair have to
        // be in the frame for the prepass to mean anything: an occluder with no
        // opted-in overlay hides nothing, and an opted-in overlay with no
        // occluder wants the ordinary "over everything" pass rather than a test
        // against an empty buffer. Either missing and this whole block runs
        // exactly as it did before the pair existed.
        const gating =
          overlayOccluders.length > 0 &&
          overlay.some((i) => scene.nodes[i].material?.overlayOccluded === true);
        if (gating) {
          // Clear, then re-draw the occluders alone: what the overlays must
          // test against is a depth buffer containing the nominated objects and
          // NOTHING else — the scene's own depth is what the overlay pass
          // exists to ignore. Scissored like the frame's own clear, so a second
          // viewport sharing this backing store keeps the depth it just wrote.
          gl!.clearDepth(1);
          gl!.enable(gl!.SCISSOR_TEST);
          gl!.scissor(0, targetY, targetW, targetH);
          gl!.depthMask(true);
          gl!.clear(gl!.DEPTH_BUFFER_BIT);
          gl!.disable(gl!.SCISSOR_TEST);
          // Shape only: colour writes off, depth writes on, and the ordinary
          // LEQUAL so two occluders resolve against each other correctly. The
          // full material is bound for a draw that emits no colour, which is
          // waste — but it is one draw per nominated node, and a second program
          // whose only job is to write nothing costs more than it saves.
          gl!.colorMask(false, false, false, false);
          lastMaterial = null;
          for (const i of overlayOccluders) {
            drawNode(scene.nodes[i], scene.nodes[i].material ?? {});
          }
          gl!.colorMask(true, true, true, true);
        }

        // Last, and against a depth function that always passes — unless this
        // overlay opted into the prepass above, in which case LEQUAL lets the
        // occluders cut it out.
        lastMaterial = null;
        for (const i of overlay) {
          const material = scene.nodes[i].material ?? {};
          const gated = gating && material.overlayOccluded === true;
          gl!.depthFunc(gated ? gl!.LEQUAL : gl!.ALWAYS);
          // Without a prepass the mask stays on for an opaque overlay, so two
          // of them still occlude each other in draw order, which is what makes
          // a stack of them readable. WITH one, nothing in this pass writes
          // depth: the buffer belongs to the nominated occluders until the pass
          // ends, and an overlay writing into it would quietly become a second
          // occluder — the failure looks like one readout eating another.
          gl!.depthMask(!gating && !material.transparent);
          if (material.transparent) {
            gl!.enable(gl!.BLEND);
            setBlendMode(!!material.additive);
          }
          drawNode(scene.nodes[i], material);
          if (material.transparent) gl!.disable(gl!.BLEND);
        }
        gl!.depthMask(true);
        gl!.depthFunc(gl!.LEQUAL);
      }
      gl!.bindVertexArray(null);
      if (offscreen) gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
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

    createTarget(targetWidth: number, targetHeight: number) {
      return createRenderTarget(gl!, targetWidth, targetHeight);
    },
    captureFrame() {
      // **A resolve blit, and 1:1 because it has to be.** `blitFramebuffer` will
      // scale, but not from a MULTISAMPLED read buffer — and the canvas is
      // multisampled whenever `antialias` is on, which is the default. So the
      // snapshot matches the canvas rather than being the half-resolution one a
      // caller might ask for; the copy is the cheap part either way.
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return null;
      if (!snapshot) snapshot = createRenderTarget(gl!, w, h);
      else snapshot.resize(w, h);
      gl!.bindFramebuffer(gl!.READ_FRAMEBUFFER, null);
      gl!.bindFramebuffer(gl!.DRAW_FRAMEBUFFER, targetFramebufferOf(snapshot));
      gl!.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl!.COLOR_BUFFER_BIT, gl!.NEAREST);
      // Both bindings back to the canvas, or the next ordinary render draws into the
      // snapshot — the same hazard `render`'s own unbind exists for, and invisible
      // from inside the renderer for the same reason.
      gl!.bindFramebuffer(gl!.READ_FRAMEBUFFER, null);
      gl!.bindFramebuffer(gl!.DRAW_FRAMEBUFFER, null);
      return snapshot;
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

/** An offscreen colour+depth surface — see `RenderTarget3D`.
 *
 * A colour TEXTURE rather than a renderbuffer, because the whole point of a
 * target is that something samples it afterwards; a renderbuffer can only be
 * blitted. Depth is the renderbuffer instead, for the mirror of that reason:
 * nothing samples depth here, and a renderbuffer is the cheaper attachment.
 *
 * `RGBA8` and `DEPTH_COMPONENT16`: both are required to be renderable in WebGL2
 * (`§4.4.2`), so there is no format probe and no fallback path. A float target
 * would want `EXT_color_buffer_float` and an HDR pipeline to spend it on, and
 * this engine tone-maps into 8 bits at the end of the fragment shader anyway.
 *
 * NEAREST and CLAMP_TO_EDGE: a target is usually sampled at about the same
 * resolution it was rendered at, and a mirror that bilinearly blurs its own
 * pixels reads as a smudge rather than as a reflection. A caller that wants it
 * smooth can render the target larger. */
function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): RenderTarget3D {
  const framebuffer = gl.createFramebuffer();
  const texture = gl.createTexture();
  const depth = gl.createRenderbuffer();
  let w = 0;
  let h = 0;

  function allocate(nextW: number, nextH: number): void {
    w = Math.max(1, Math.round(nextW));
    h = Math.max(1, Math.round(nextH));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }
  allocate(width, height);

  return {
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    resize(nextW: number, nextH: number) {
      const wanted = Math.max(1, Math.round(nextW));
      const wantedH = Math.max(1, Math.round(nextH));
      if (wanted === w && wantedH === h) return;
      allocate(wanted, wantedH);
    },
    readPixels() {
      const pixels = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // GL hands back the BOTTOM row first and the contract says top first, so
      // the rows are flipped here rather than in every caller. Same reason
      // `render` flips the viewport for a canvas larger than its viewport.
      const stride = w * 4;
      const flipped = new Uint8Array(pixels.length);
      for (let row = 0; row < h; row += 1) {
        flipped.set(pixels.subarray((h - 1 - row) * stride, (h - row) * stride), row * stride);
      }
      return Promise.resolve(flipped);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteRenderbuffer(depth);
    },
    /** The GL texture, for the renderer that made it. Not on `RenderTarget3D`:
     * a caller has no use for a raw handle, and the two backends' handles are
     * not the same kind of thing. */
    [TARGET_TEXTURE]: texture,
    [TARGET_FRAMEBUFFER]: framebuffer,
  } as RenderTarget3D;
}

/** This backend's colour texture for a target it made, or null for one it did
 * not — a probe from the other renderer is a missing reflection rather than a
 * thrown frame, because a material is data and may outlive a context. */
function targetTextureOrNull(target: RenderTarget3D): WebGLTexture | null {
  return (target as unknown as Record<symbol, WebGLTexture | undefined>)[TARGET_TEXTURE] ?? null;
}

/** This backend's framebuffer for a target it made.
 *
 * Throws rather than drawing nowhere when handed a target from the OTHER
 * backend: a silent miss here renders the whole frame to the canvas and looks
 * like the target never worked. */
function targetFramebufferOf(target: RenderTarget3D): WebGLFramebuffer {
  const framebuffer = (target as unknown as Record<symbol, WebGLFramebuffer | undefined>)[
    TARGET_FRAMEBUFFER
  ];
  if (!framebuffer) {
    throw new Error("RenderTarget3D belongs to a different renderer — targets are per context.");
  }
  return framebuffer;
}

/** How this backend finds its own attachments on a `RenderTarget3D` it made.
 * Symbols rather than fields, so the public type stays free of one backend's
 * handles and a target from the other renderer is a miss rather than a crash. */
const TARGET_TEXTURE = Symbol.for("minimotor.render3d.webgl2.targetTexture");
const TARGET_FRAMEBUFFER = Symbol.for("minimotor.render3d.webgl2.targetFramebuffer");

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
