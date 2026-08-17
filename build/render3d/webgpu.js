// ---------- WebGPU backend ----------
// The same scene, the same camera, the same meshes — a different API under
// them. It exists alongside the WebGL2 backend rather than replacing it
// because WebGPU is still not everywhere (Firefox and older Safari fall back),
// and because having two implementations of one interface is what keeps the
// interface honest.
//
// What differs from `webgl2.ts`, and why each difference is forced rather than
// chosen:
//
//   - **Clip depth is 0…1**, not −1…1. Hence `clipZeroToOne: true` and hence
//     the flag threaded through `Mat4.perspective`. Rendering a WebGL matrix
//     here puts half the scene behind the near plane and looks like the model
//     failed to load.
//   - **Uniforms live in buffers**, not individual `uniform*` calls. Per-draw
//     data goes in ONE buffer read with a dynamic offset, so a scene of N
//     nodes costs one buffer write and N cheap bind-group rebinds instead of
//     N buffer allocations. Dynamic offsets must be 256-byte aligned, which is
//     why the 144 bytes of per-draw data occupy 256.
//   - **Pipeline state is immutable.** WebGL toggles `CULL_FACE` and blending
//     between draws; here each combination is a separate pipeline, created on
//     demand and cached. There are exactly eight (blend × double-sided ×
//     depth-test), so the cache never grows unbounded.
//   - **The depth buffer is an explicit texture** that must be resized with
//     the canvas, and leaking one on every resize is the classic WebGPU memory
//     bug. `configureSize` destroys the old one. Multisampling adds a second
//     such texture: WebGL2 gets it from a context attribute, here the pass
//     owns a 4x colour target and resolves it into the swap chain.
//
// Y-flip: WGSL's texture coordinates put v = 0 at the TOP, which is already
// the convention `MeshData.uvs` uses, so unlike the GL path there is nothing
// to flip. `copyExternalImageToTexture` also lands top-down by default.
import { Mat4 } from "../math/mat4.js";
import { cameraPosition, viewProjection } from "./camera.js";
import { detailProjectionMode, detailWorldStep, fogUniform, ghostMaterial, glazeParallax, glazeStrength, isVisible, settleActive, } from "./scene.js";
import { triangleCount, vertexCount } from "./mesh.js";
import { frustumPlanes, inFrustum, meshBounds } from "./cull.js";
const MAX_LIGHTS = 4;
const MAX_JOINTS = 64;
/** Frame uniforms: viewProj(64) + cameraPos(16) + ambient(16) + ambientGround(16)
 *  + lightCount(16) + fogParams(16) + fogColor(16) + dir[4](64) + colour[4](64).
 *  Every field is vec4-aligned because WGSL's std140-like rules round a vec3 up
 *  to 16 bytes anyway. */
const FRAME_BYTES = 288;
/** Per-draw: model(64) + normalMat as 3×vec4(48) + baseColor(16) + params(16)
 *  + skinParams(16) + uvTransform(16) + rimAlpha(16) + detail(16)
 *  + detailUvTransform(16) + detailMaskTransform(16) + detailFlags(16)
 *  + glaze(16) + glazeTint(16) + glazeWave(16) + settle(16) + settle2(16)
 *  + textureColor(16)
 *  + joints(4096).
 *
 *  Padded to the 256-byte minimum dynamic-offset alignment. The fields and
 *  joints now occupy 4432 bytes, so the slot is the next multiple of 256.
 *
 *  **The five `glaze`/`settle` vec4s cost nothing that the first one did not.**
 *  This was 4352 — exactly 17 slots, with the note that the next field added
 *  would take the whole block to 4608. It has, and the quantisation means the
 *  16 bytes a single scalar would have cost and the 80 these five vec4s cost
 *  are the same 256 bytes of stride either way. What that leaves is 176 bytes
 *  of headroom: the NEXT eleven vec4s are free, and the twelfth costs 256
 *  again. */
const DRAW_BYTES = 4608;
const DRAW_FLOATS = DRAW_BYTES / 4;
const TIMESTAMP_SLOTS = 64;
const TIMESTAMP_STRIDE = 256;
const SHADER = /* wgsl */ `
struct Frame {
  viewProj   : mat4x4f,
  cameraPos  : vec4f,
  // xyz: the sky half of the ambient hemisphere, w: 1 when tone mapping is on
  ambient    : vec4f,
  // xyz: the ground half; equal to the sky half when no hemisphere was asked
  // for, which makes the shader's mix a no-op
  ambientGround : vec4f,
  lightCount : vec4f,
  // xyz: see fogUniform() in scene.ts, w: mode (-1 off, 0 linear, 1 exp,
  // 2 exp squared, 3 layered)
  fogParams  : vec4f,
  fogColor   : vec4f,
  lightDir   : array<vec4f, ${MAX_LIGHTS}>,
  lightColor : array<vec4f, ${MAX_LIGHTS}>,
};

struct DrawData {
  model     : mat4x4f,
  // A mat3x3 in a uniform buffer is laid out as three vec4s; storing it as
  // three explicit vec4s keeps the JS side's offsets obvious.
  normal0   : vec4f,
  normal1   : vec4f,
  normal2   : vec4f,
  baseColor : vec4f,
  // x: shininess, y: unlit, z: texture blend (0 none, 1 multiply, 2 over),
  // w: specular strength
  params    : vec4f,
  // x: skinned, y: hasNormalMap, z: normal map strength, w: uv projection
  // (0 mesh, 1 planar XZ, 2 sphere)
  skinParams: vec4f,
  // xy: uv scale, zw: uv offset
  uvTransform: vec4f,
  // xyz: rim alpha bias/scale/power, w: metalness
  rimAlpha  : vec4f,
  // x: detail strength, y: reads uv1, z: alpha-over RGB scale (0 is overlay),
  // w: planar-XZ
  detail    : vec4f,
  // xy: detail uv scale, zw: detail uv offset
  detailUvTransform: vec4f,
  // xy: detail-mask uv scale, zw: its offset. A zero scale means there is no
  // mask — see Material.detailMaskUvScale.
  detailMaskTransform: vec4f,
  // x: the secondary map's RGB is premultiplied by its own alpha — see
  // Material.detailPremultiplied. y: the world grid a projected secondary map
  // snaps its position to, 0 for off — see Material.detailWorldStep. z: the
  // map composites into the surface's opacity too — see
  // Material.detailOpacity. w spare.
  detailFlags: vec4f,
  // x: strength — 0 disables every term of the coat, y: fresnel exponent,
  // z: parallax offset, w: scroll phase. See Material.glaze.
  glaze     : vec4f,
  // xyz: the faked sky's tint, w: ripple frequency in waves per world unit
  glazeTint : vec4f,
  // x: ripple tilt, y: sparkle, zw spare
  glazeWave : vec4f,
  // xyz: the colour that has settled, w: how much collects on an up-facing
  // face. See Material.settle.
  settle    : vec4f,
  // x: up sharpness, y: the ground line's world Y, z: rise height, w: rise
  // amount
  settle2   : vec4f,
  // Multiplied into the sampled base texture before it is blended with the
  // material colour, or used as the dark-region colour for a mask blend. This
  // keeps a mask tint separate from the surface colour.
  textureColor: vec4f,
  jointMatrices: array<mat4x4f, ${MAX_JOINTS}>,
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<uniform> draw  : DrawData;
@group(1) @binding(0) var samp : sampler;
@group(1) @binding(1) var tex  : texture_2d<f32>;
@group(1) @binding(2) var normalTex : texture_2d<f32>;
@group(1) @binding(3) var detailTex : texture_2d<f32>;
@group(1) @binding(4) var detailMaskTex : texture_2d<f32>;

struct VsOut {
  @builtin(position) clip     : vec4f,
  @location(0)       worldPos : vec3f,
  @location(6)       localPos  : vec3f,
  @location(1)       normal   : vec3f,
  @location(2)       uv       : vec2f,
  @location(3)       color    : vec4f,
  @location(4)       uv1      : vec2f,
  @location(5)       tangent  : vec4f,
};

@vertex
fn vs(
  @location(0) position : vec3f,
  @location(1) normal   : vec3f,
  @location(2) uv       : vec2f,
  @location(3) color    : vec4f,
  @location(4) joints   : vec4u,
  @location(5) weights  : vec4f,
  @location(6) uv1      : vec2f,
  @location(7) tangent  : vec4f,
) -> VsOut {
  var out : VsOut;
  var local = vec4f(position, 1.0);
  var localNormal = normal;
  var localTangent = tangent.xyz;
  if (draw.skinParams.x > 0.5) {
    let skin = weights.x * draw.jointMatrices[joints.x] +
      weights.y * draw.jointMatrices[joints.y] +
      weights.z * draw.jointMatrices[joints.z] +
      weights.w * draw.jointMatrices[joints.w];
    local = skin * local;
    localNormal = mat3x3f(skin[0].xyz, skin[1].xyz, skin[2].xyz) * localNormal;
    localTangent = mat3x3f(skin[0].xyz, skin[1].xyz, skin[2].xyz) * localTangent;
  }
  let world = draw.model * local;
  out.worldPos = world.xyz;
  out.localPos = local.xyz;
  let nm = mat3x3f(draw.normal0.xyz, draw.normal1.xyz, draw.normal2.xyz);
  out.normal = nm * localNormal;
  // A tangent lies ALONG the surface, so it takes the model matrix rather
  // than the inverse-transpose the normal needs. w is the handedness.
  out.tangent = vec4f(
    mat3x3f(draw.model[0].xyz, draw.model[1].xyz, draw.model[2].xyz) * localTangent,
    tangent.w,
  );
  out.uv = uv;
  out.uv1 = uv1;
  out.color = color;
  out.clip = frame.viewProj * world;
  return out;
}

/** The tangent frame the normal map is read in: the shipped one when the mesh
 *  has it, derivatives otherwise — see the WebGL2 backend for the trade. */
/** Visibility in 0..1 — 1 is clear air. A ground-hugging slab needs the fog
 *  density integrated along the view ray, otherwise the layer slides with the
 *  camera instead of staying put in the world. */
// sRGB in both directions, as the cheap squares rather than the piecewise
// curve — the same pair the WebGL2 backend uses, and they have to stay the
// same pair or the two backends stop drawing the same frame.
fn srgbToLinear(c : vec3f) -> vec3f { return c * c; }
fn linearToSrgb(c : vec3f) -> vec3f { return sqrt(c); }

// The ACES filmic curve, in Krzysztof Narkowicz's fitted form. The clamp at 8
// is part of the fit: the rational function has flattened out well before
// there, so anything brighter is already white.
fn acesToneMap(colorIn : vec3f) -> vec3f {
  let color = min(colorIn, vec3f(8.0));
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return (color * (a * color + b)) / (color * (c * color + d) + e);
}

fn fogVisibility(world : vec3f, eye : vec3f) -> f32 {
  let mode = frame.fogParams.w;
  if (mode < 0.5) {
    return clamp((frame.fogParams.y - distance(eye, world)) / (frame.fogParams.y - frame.fogParams.x), 0.0, 1.0);
  }
  if (mode < 2.5) {
    let d = max(distance(eye, world) - frame.fogParams.x, 0.0) / frame.fogParams.z * 4.0 * frame.fogParams.y;
    return select(exp(-d * d), exp(-d), mode < 1.5);
  }
  let top = frame.fogParams.x;
  let range = frame.fogParams.y;
  let deltaD = distance(world.xz, eye.xz) / frame.fogParams.z * 2.0;
  var deltaY = 0.0;
  var integral = 0.0;
  if (eye.y > top) {
    deltaY = select(0.0, (top - world.y) / range * 2.0, world.y < top);
    integral = deltaY * deltaY * 0.5;
  } else if (world.y < top) {
    let a = (top - eye.y) / range * 2.0;
    let b = (top - world.y) / range * 2.0;
    deltaY = abs(a - b);
    integral = abs(a * a * 0.5 - b * b * 0.5);
  } else {
    deltaY = abs(top - eye.y) / range * 2.0;
    integral = abs(deltaY * deltaY * 0.5);
  }
  if (deltaY == 0.0) { return 1.0; }
  let ratio = deltaD / deltaY;
  return exp(-sqrt(1.0 + ratio * ratio) * integral);
}

/** The mobile GGX distribution the physical model's highlight is shaped by.
 *  Only reached under tone mapping; the direct model keeps Blinn-Phong. */
fn ggxMobile(roughness : f32, noh : f32, h : vec3f, n : vec3f) -> f32 {
  let nxh = cross(n, h);
  let oneMinusNohSqr = dot(nxh, nxh);
  let a = roughness * roughness;
  let k = noh * a;
  let p = a / max(1e-6, oneMinusNohSqr + k * k);
  return p * p;
}

/** Karis' analytic environment BRDF. See the WebGL2 backend. */
fn brdfApprox(f0 : vec3f, roughness : f32, nov : f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nov)) * r.x + r.y;
  var ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  ab.y = ab.y * clamp(50.0 * f0.g, 0.0, 1.0);
  return max(vec3f(0.0), f0 * ab.x + ab.y);
}

/** Roughness back out of a Blinn exponent, the exact inverse of the mapping
 *  the glTF loader uses going the other way. */
fn roughnessOf(shininess : f32) -> f32 {
  return clamp(1.0 - (log2(max(shininess, 1e-6)) - 1.0) / 7.0, 0.0, 1.0);
}

/** Photoshop's Overlay — see the WebGL2 backend for why the PATTERN is the
 *  side that gets tested. Both backends have to keep the same pivot or they
 *  stop drawing the same frame. */
fn blendOverlay(pattern : vec3f, surface : vec3f) -> vec3f {
  let lum = dot(pattern, vec3f(0.2126, 0.7152, 0.0722));
  return select(
    1.0 - 2.0 * (1.0 - pattern) * (1.0 - surface),
    2.0 * pattern * surface,
    lum < 0.5,
  );
}

/** A wrapped triangle wave smoothed by the 3t^2-2t^3 interpolant a value noise
 *  uses, on -1..1. Deliberately not sin(): see the WebGL2 backend, and the two
 *  have to stay the same arithmetic or they stop drawing the same frame. */
fn glazeWave(x : f32) -> f32 {
  let t = fract(x);
  let tri = 1.0 - abs(t * 2.0 - 1.0);
  return tri * tri * (3.0 - 2.0 * tri) * 2.0 - 1.0;
}

/** Two octaves of that wave along skewed axes, drifting at rates that share no
 *  small ratio, so the sum's period is long enough that nobody sees it come
 *  round. Returns a tilt in the world XZ plane. */
fn glazeRipple(p : vec2f, phase : f32) -> vec2f {
  let a = glazeWave(p.x * 0.75 + p.y * 0.35 + phase);
  let b = glazeWave(p.y * 0.85 - p.x * 0.45 - phase * 0.63);
  let c = glazeWave(p.x * 1.90 - p.y * 1.60 + phase * 1.70);
  let d = glazeWave(p.y * 2.10 + p.x * 1.40 - phase * 1.30);
  return vec2f(a + c * 0.45, b + d * 0.45);
}

fn applyNormalMap(n : vec3f, worldPos : vec3f, uv : vec2f, scale : f32, shipped : vec4f) -> vec3f {
  // Sampled up front, BEFORE the branches below. textureSample picks its mip
  // from implicit derivatives, which WGSL only permits in uniform control
  // flow, and the guard branches on a dpdx result — so a sample placed after
  // it fails to compile even though every lane would take the same path in
  // practice.
  var sampled = textureSample(normalTex, samp, uv).xyz * 2.0 - 1.0;
  sampled = vec3f(sampled.xy * scale, sampled.z);
  // The derivative frame, always computed: same uniformity rule.
  let dPosX = dpdx(worldPos);
  let dPosY = dpdy(worldPos);
  let dUvX = dpdx(uv);
  let dUvY = dpdy(uv);
  var tangent = vec3f(0.0);
  var bitangent = vec3f(0.0);
  if (dot(shipped.xyz, shipped.xyz) > 1e-12) {
    // Gram-Schmidt against the interpolated normal — the two are interpolated
    // separately and come out of it not quite orthogonal.
    tangent = normalize(shipped.xyz - n * dot(n, shipped.xyz));
    bitangent = cross(n, tangent) * select(1.0, -1.0, shipped.w < 0.0);
  } else {
    let det = dUvX.x * dUvY.y - dUvY.x * dUvX.y;
    if (abs(det) < 1e-12) { return n; }
    tangent = normalize((dPosX * dUvY.y - dPosY * dUvX.y) / det);
    bitangent = normalize(cross(n, tangent));
    tangent = cross(bitangent, n);
  }
  return normalize(mat3x3f(tangent, bitangent, n) * sampled);
}

@fragment
fn fs(in : VsOut, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4f {
  var source = in.uv;
  if (draw.skinParams.w > 0.5 && draw.skinParams.w < 1.5) {
    source = in.worldPos.xz;
  } else if (draw.skinParams.w > 1.5) {
    let point = normalize(in.localPos);
    source = vec2f(
      atan2(point.z, point.x) / (2.0 * 3.14159265359) + 0.5,
      asin(clamp(point.y, -1.0, 1.0)) / 3.14159265359 + 0.5,
    );
  }
  let uv = source * draw.uvTransform.xy + draw.uvTransform.zw;
  // The normal map keeps the MESH uv under a projection — see
  // Material.uvProjection. Its vectors are expressed in the frame the unwrap
  // builds, and in.tangent still describes that unwrap.
  let normalUv = select(uv, in.uv, draw.skinParams.w > 0.5);
  var base = draw.baseColor * in.color;
  if (draw.params.z > 0.5) {
    let sampled = textureSample(tex, samp, uv);
    if (draw.params.z > 2.5) {
      // Built-in ball styles are grayscale masks. Their dark regions receive
      // the mask tint while white regions retain the base ball colour.
      let mask = 1.0 - dot(sampled.rgb, vec3f(0.299, 0.587, 0.114));
      base = vec4f(mix(base.rgb, draw.textureColor.rgb, clamp(mask, 0.0, 1.0)), base.a);
    } else {
      let texel = sampled * draw.textureColor;
      // Blend 2 keeps the base colour's own alpha: the texture decides colour
      // where it is opaque, not whether the surface is there at all.
      if (draw.params.z > 1.5) {
        base = vec4f(mix(base.rgb, texel.rgb, texel.a), base.a);
      } else {
        base = base * texel;
      }
    }
  }
  // The glaze's normal and its one extra sample are taken HERE, up beside the
  // base texture read, and not down beside the light where the rest of the coat
  // is applied — because WGSL permits an implicit-derivative sample only in
  // uniform control flow, applyNormalMap() below returns early inside a branch
  // on a derivative, and a sample placed after that call fails to COMPILE. The
  // WebGL2 backend does not need the split and takes it anyway: the two are
  // required to draw the same frame, and the cheapest way to keep them doing it
  // is to give them the same shape.
  //
  // It costs nothing regardless. A reflective coat is a layer OVER the surface,
  // so it has no business reading the surface's normal map.
  var glazeNormal = vec3f(0.0, 1.0, 0.0);
  var glazeUnder = vec3f(0.0);
  if (draw.glaze.x > 0.0) {
    let tilt = glazeRipple(in.worldPos.xz * draw.glazeTint.w, draw.glaze.w);
    glazeNormal = normalize(normalize(in.normal) + vec3f(tilt.x, 0.0, tilt.y) * draw.glazeWave.x);
    if (draw.glaze.z != 0.0) {
      let toEye = normalize(frame.cameraPos.xyz - in.worldPos);
      // The offset goes on the SOURCE coordinate, before the uv transform, so
      // it lands in whatever units the projection reads — world units under
      // planarXZ, uv under the mesh's own unwrap. See Glaze.parallax.
      let under = (source + reflect(-toEye, glazeNormal).xz * draw.glaze.z)
        * draw.uvTransform.xy + draw.uvTransform.zw;
      glazeUnder = textureSample(tex, samp, under).rgb;
    }
  }
  // Overlay while base is still in display space; alpha-over in linear light —
  // see Material.detailMap for why the two belong on opposite sides of it.
  if (draw.detail.x > 0.0) {
    // Blocks of a chosen world size, for a projected pattern that has to read
    // as pixel art — see Material.detailWorldStep. Off at zero.
    // select() evaluates both arms, so the divisor is clamped rather than
    // guarded: an unset step would otherwise divide by zero and come back NaN.
    let step = draw.detailFlags.y;
    let snapped = ceil(in.worldPos / max(step, 1e-6)) * step;
    let detailPos = select(in.worldPos, snapped, step > 0.0);
    var detailSource = select(in.uv, in.uv1, draw.detail.y > 0.5);
    detailSource = select(detailSource, detailPos.xz, draw.detail.w > 0.5 && draw.detail.w < 1.5);
    let detailUv = detailSource * draw.detailUvTransform.xy + draw.detailUvTransform.zw;
    var pattern = textureSample(detailTex, samp, detailUv);
    if (draw.detail.w > 1.5) {
      // Three world-space projections blended by the face's own normal, so a
      // pattern runs across a whole shape at one density with no unwrap. The
      // exponent is what makes the seams narrow: raised to the eighth, a
      // 45-degree face is still 50/50 but a 30-degree one is already 94/6, so
      // the blend band is a few degrees wide instead of the whole quadrant.
      var axis = pow(abs(normalize(in.normal)), vec3f(8.0));
      axis /= max(axis.x + axis.y + axis.z, 1e-6);
      // Horizontal/vertical rather than per-plane: the ground plane takes the
      // horizontal scale on BOTH axes, so one tile is the same square however
      // a face is turned. See Material.detailUvScale.
      let s = draw.detailUvTransform.xy;
      let o = draw.detailUvTransform.zw;
      pattern = textureSample(detailTex, samp, detailPos.zy * s + o) * axis.x
              + textureSample(detailTex, samp, detailPos.xz * s.xx + o) * axis.y
              + textureSample(detailTex, samp, detailPos.xy * s + o) * axis.z;
    }
    if (draw.detail.z > 0.0) {
      let lit = frame.ambient.w > 0.5;
      // Both maps are scaled and linearized BEFORE they multiply, not after:
      // squaring a product of two alphas is not the product of two squares, and
      // the difference is the whole brightness of a lit decal.
      let straight = select(pattern.rgb, pattern.rgb * pattern.a, draw.detailFlags.x > 0.5);
      let scaled = straight * draw.detail.z;
      var over = select(scaled, srgbToLinear(scaled), lit);
      var weight = pattern.a * draw.detail.x;
      if (draw.detailMaskTransform.x != 0.0 || draw.detailMaskTransform.y != 0.0) {
        let maskUv = detailSource * draw.detailMaskTransform.xy + draw.detailMaskTransform.zw;
        let mask = textureSample(detailMaskTex, samp, maskUv);
        let maskScaled = mask.rgb * draw.detail.z;
        let cut = select(maskScaled, srgbToLinear(maskScaled), lit);
        // The decal's own alpha comes into the RGB here as well as into the
        // weight, which is what makes a mask DARKEN rather than tint: a canvas
        // at 6% alpha contributes 6% of 6% of its light and the surface keeps
        // the rest. A hard cut at the mask's edge, not a fade, so the shape
        // stays the shape at any distance.
        over = over * pattern.a * cut * mask.a;
        if (mask.a < 0.01) { weight = 0.0; }
      }
      let blended = select(
        mix(base.rgb, over, weight),
        linearToSrgb(mix(srgbToLinear(base.rgb), over, weight)),
        lit,
      );
      // The opacity too when asked, at the same weight — see
      // Material.detailOpacity. Straight, never through the tone curve: a
      // coverage is not a light and there is nothing to linearize.
      let opacity = select(base.a, mix(base.a, pattern.a, weight), draw.detailFlags.z > 0.5);
      base = vec4f(blended, opacity);
    } else {
      base = vec4f(mix(base.rgb, blendOverlay(pattern.rgb, base.rgb), draw.detail.x), base.a);
    }
  }
  // What has SETTLED on the surface, which is albedo and therefore belongs here
  // rather than beside the light: a snow cap that did not take the scene's own
  // lighting reads as a sticker. See Material.settle.
  if (draw.settle.w > 0.0 || draw.settle2.w > 0.0) {
    var settleN = normalize(in.normal);
    if (!frontFacing) { settleN = -settleN; }
    // Collects on faces that point at the sky and gives out as one tilts.
    let top = pow(max(settleN.y, 0.0), draw.settle2.x) * draw.settle.w;
    // And climbs from a ground line, strongest at the foot. Everything BELOW
    // the line is covered outright, which is what a ground line means — the
    // clamp is what says so, and it is why this is not symmetric.
    let climb = (1.0 - clamp((in.worldPos.y - draw.settle2.y)
      / max(draw.settle2.z, 1e-6), 0.0, 1.0)) * draw.settle2.w;
    let foot = select(0.0, climb, draw.settle2.z > 0.0);
    // max() rather than a sum: a wall's foot and a wall's cap are the same snow
    // seen twice, and adding them drives the corner past white.
    let settled = clamp(max(top, foot), 0.0, 1.0);
    let lit = frame.ambient.w > 0.5;
    let lay = select(draw.settle.rgb, srgbToLinear(draw.settle.rgb), lit);
    base = vec4f(
      select(
        mix(base.rgb, draw.settle.rgb, settled),
        linearToSrgb(mix(srgbToLinear(base.rgb), lay, settled)),
        lit,
      ),
      base.a,
    );
  }
  // Ahead of the cutoff and of the unlit branch, because the ramp is what
  // decides the final alpha: a bias of zero means the face-on fragments are
  // the ones with nothing left to draw, and both paths below want that answer.
  if (draw.rimAlpha.y != 0.0) {
    var facing = normalize(in.normal);
    if (!frontFacing) { facing = -facing; }
    let grazing = max(1.0 - dot(normalize(frame.cameraPos.xyz - in.worldPos), facing), 0.0);
    base.a = base.a * clamp(draw.rimAlpha.x + draw.rimAlpha.y * pow(grazing, draw.rimAlpha.z), 0.0, 1.0);
  }
  if (base.a < 0.002) { discard; }

  // Everything below works in linear light when tone mapping is on, so the
  // decode happens once here — on the material colour, the vertex colour and
  // the texture together, all three of which are authored for a display.
  let toneMap = frame.ambient.w > 0.5;
  if (toneMap) { base = vec4f(srgbToLinear(base.rgb), base.a); }

  if (draw.params.y > 0.5) {
    // Unlit skips the lighting, not the output curve: an unlit gizmo beside a
    // lit surface has to have come through the same shoulder, or it reads as
    // belonging to a different scene.
    // Named to match the WebGL2 backend, where flat is a reserved word.
    var plain = base.rgb;
    if (toneMap) { plain = linearToSrgb(acesToneMap(plain)); }
    // Unlit output is premultiplied to match the canvas alpha mode, and colour
    // and opacity saturate SEPARATELY before they meet -- see the WebGL2
    // backend for why premultiplying an over-1 alpha first is a different
    // picture rather than a rounding difference.
    let opacity = clamp(base.a, 0.0, 1.0);
    return vec4f(clamp(plain, vec3f(0.0), vec3f(1.0)) * opacity, opacity);
  }

  var n = normalize(in.normal);
  if (!frontFacing) { n = -n; }
  if (draw.skinParams.y > 0.5) {
    n = applyNormalMap(n, in.worldPos, normalUv, draw.skinParams.z, in.tangent);
  }
  let view = normalize(frame.cameraPos.xyz - in.worldPos);

  // A hemisphere when a ground colour was given, the plain fill otherwise.
  // The blend runs off the normal's Y alone, so it costs nothing per light and
  // does not care where the camera is.
  var lit = mix(frame.ambient.rgb, frame.ambientGround.rgb, max(1e-6, 0.5 - n.y * 0.5));
  var spec = vec3f(0.0);
  let count = i32(frame.lightCount.x);
  // Lambert's 1/pi, which is what puts an intensity on the same scale as an
  // illuminance. Only under tone mapping: applying it to the direct model
  // would darken every existing scene by the same third.
  let diffuseScale = select(1.0, 0.31830988, toneMap);
  // Under tone mapping the highlight has to be energy-plausible, because it is
  // now being multiplied by an illuminance rather than by a number near 1.
  // Tinted so it stops draining the colour out of saturated surfaces, shaped
  // by a GGX lobe rather than a Blinn one, run through the environment BRDF,
  // and gated on N·L. See the WebGL2 backend, which has the long version.
  let roughness = roughnessOf(draw.params.x);
  let f0 = mix(vec3f(0.08 * draw.params.w), base.rgb, draw.rimAlpha.w);
  let reflectance = select(f0, brdfApprox(f0, roughness, max(abs(dot(n, view)), 0.0)), toneMap);
  let lobeScale = roughness * 0.25 + 0.25;
  for (var i = 0; i < ${MAX_LIGHTS}; i = i + 1) {
    if (i >= count) { break; }
    let toLight = -frame.lightDir[i].xyz;
    let ndl = max(dot(n, toLight), 0.0);
    lit = lit + frame.lightColor[i].rgb * ndl * diffuseScale;
    if (draw.params.x > 0.0 && ndl > 0.0) {
      let halfway = normalize(toLight + view);
      let noh = max(dot(n, halfway), 0.0);
      let physical = frame.lightColor[i].rgb * ndl * reflectance
        * (lobeScale * ggxMobile(roughness, noh, halfway, n));
      let direct = frame.lightColor[i].rgb * draw.params.w * pow(noh, draw.params.x);
      spec = spec + select(direct, physical, toneMap);
    }
  }
  // A metal has no diffuse: what it does not reflect, it absorbs.
  let albedo = select(base.rgb, base.rgb * (1.0 - draw.rimAlpha.w), toneMap);
  var rgb = albedo * lit + spec;
  // The faked reflective coat, ADDED to the shaded surface and taken before the
  // fog, because it is light like any other — see Material.glaze.
  if (draw.glaze.x > 0.0) {
    let toEye = normalize(frame.cameraPos.xyz - in.worldPos);
    let bounce = reflect(-toEye, glazeNormal);
    // Weak head-on, strong at a grazing angle. On a low orbit over a flat deck
    // this is most of what the eye reads. See Glaze.fresnel.
    let fresnel = pow(1.0 - clamp(dot(glazeNormal, toEye), 0.0, 1.0), draw.glaze.y);
    // The faked sky, looked up by the reflected ray: a two-stop vertical
    // gradient by its own height...
    let sky = clamp(bounce.y * 0.5 + 0.5, 0.0, 1.0);
    var env = draw.glazeTint.rgb * (0.25 + 0.75 * sky * sky);
    // ...plus a tight lobe around the scene's OWN first light, which is what
    // actually sweeps when the camera turns. Reusing the key light rather than
    // taking a direction of its own keeps the reflection agreeing with the
    // scene it is in, and costs no uniform. With no lights there is nothing to
    // reflect, and straight up is the answer that adds no lobe anywhere.
    let sun = select(
      vec3f(0.0, 1.0, 0.0),
      -normalize(frame.lightDir[0].xyz),
      frame.lightCount.x > 0.0,
    );
    let lobe = max(dot(bounce, sun), 0.0);
    let lobe2 = lobe * lobe;
    let lobe8 = lobe2 * lobe2 * lobe2 * lobe2;
    env += draw.glazeTint.rgb * lobe8 * 1.5;
    // The grain, an octave far above the ripple and gated by that same lobe so
    // it glitters where the light is instead of everywhere. See Glaze.sparkle.
    if (draw.glazeWave.y > 0.0) {
      let grain = glazeRipple(in.worldPos.xz * draw.glazeTint.w * 9.0, draw.glaze.w * 2.3);
      let g = clamp(grain.x * grain.y, 0.0, 1.0);
      let g2 = g * g;
      env += draw.glazeTint.rgb * (g2 * g2 * g2) * draw.glazeWave.y * (0.25 + lobe8);
    }
    if (toneMap) { env = srgbToLinear(env); }
    // The sky takes over at a grazing angle and what is UNDER the ice shows
    // head-on, which is the right way round and is why the two weights are
    // complements rather than both riding the Fresnel.
    let under = select(glazeUnder, srgbToLinear(glazeUnder), toneMap);
    rgb += (env * (0.25 + 0.75 * fresnel) + under * (1.0 - fresnel) * 0.5) * draw.glaze.x;
  }
  // Fog before the curve, not after: the fog colour is a colour in the scene
  // like any other, and a distant surface that has faded most of the way into
  // it should reach the shoulder with it rather than be mixed into an
  // already-toned pixel.
  if (frame.fogParams.w >= 0.0) {
    var fogRgb = frame.fogColor.rgb;
    if (toneMap) { fogRgb = srgbToLinear(fogRgb); }
    rgb = mix(fogRgb, rgb, clamp(fogVisibility(in.worldPos, frame.cameraPos.xyz), 0.0, 1.0));
  }
  if (toneMap) { rgb = linearToSrgb(acesToneMap(rgb)); }
  return vec4f(rgb * base.a, base.a);
}`;
/** How to build a WebGPU renderer. */
/** One full-screen triangle that copies the level above, which is the whole of
 *  a mip chain builder on this backend.
 *
 *  A triangle rather than a quad: three vertices with no buffer at all, their
 *  positions built from the vertex index, covering the target with one
 *  primitive and no seam down a diagonal. The filtering is the SAMPLER's — the
 *  bilinear read of the larger level is what averages four texels into one. */
const MIP_BLIT_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) index: u32) -> VsOut {
  // (-1,-1), (3,-1), (-1,3): a triangle whose inscribed quad is the viewport.
  let x = f32(i32(index) / 1 % 2) * 4.0 - 1.0;
  let y = f32(i32(index) / 2) * 4.0 - 1.0;
  var out: VsOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  // v = 0 at the TOP, as everywhere in this engine.
  out.uv = vec2f((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
  return out;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(src, samp, in.uv);
}
`;
/** Whether this browser exposes WebGPU at all. A synchronous, cheap check —
 *  it does not prove an adapter can be acquired, only that asking is worth
 *  the round trip. */
export function isWebGPUAvailable() {
    return typeof navigator !== "undefined" && "gpu" in navigator;
}
/** Create a WebGPU renderer. Rejects when WebGPU is missing, no adapter can be
 *  acquired, or device creation fails — `createRenderer3D` catches that and
 *  falls back to WebGL2. */
export async function createWebGPURenderer(opts = {}) {
    if (!isWebGPUAvailable())
        throw new Error("WebGPU is not available in this browser.");
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: opts.powerPreference ?? "high-performance",
    });
    if (!adapter)
        throw new Error("WebGPU: no adapter available.");
    const timestampSupported = opts.gpuTiming === true && adapter.features.has("timestamp-query");
    const device = await adapter.requestDevice({
        requiredFeatures: timestampSupported ? ["timestamp-query"] : [],
    });
    const timestampQuerySet = timestampSupported
        ? device.createQuerySet({ type: "timestamp", count: TIMESTAMP_SLOTS * 2 })
        : null;
    const timestampResolveBuffer = timestampSupported
        ? device.createBuffer({
            size: TIMESTAMP_SLOTS * TIMESTAMP_STRIDE,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        })
        : null;
    const timestampBusy = new Uint8Array(TIMESTAMP_SLOTS);
    let nextTimestampSlot = 0;
    let resolvedGpuMs = 0;
    function reserveGpuTimestamp() {
        if (!timestampQuerySet)
            return null;
        for (let i = 0; i < TIMESTAMP_SLOTS; i++) {
            const slot = (nextTimestampSlot + i) % TIMESTAMP_SLOTS;
            if (timestampBusy[slot])
                continue;
            timestampBusy[slot] = 1;
            nextTimestampSlot = (slot + 1) % TIMESTAMP_SLOTS;
            return slot;
        }
        return null;
    }
    function finishGpuTimestamp(encoder, slot) {
        const offset = slot * TIMESTAMP_STRIDE;
        encoder.resolveQuerySet(timestampQuerySet, slot * 2, 2, timestampResolveBuffer, offset);
        const readback = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyBufferToBuffer(timestampResolveBuffer, offset, readback, 0, 16);
        return readback;
    }
    function collectGpuTimestamp(slot, readback) {
        void readback
            .mapAsync(GPUMapMode.READ)
            .then(() => {
            const values = new BigUint64Array(readback.getMappedRange());
            const nanoseconds = Number(values[1] - values[0]);
            readback.unmap();
            readback.destroy();
            timestampBusy[slot] = 0;
            if (nanoseconds >= 0)
                resolvedGpuMs += nanoseconds / 1000000;
        })
            .catch(() => {
            readback.destroy();
            timestampBusy[slot] = 0;
        });
    }
    const canvas = opts.canvas ?? document.createElement("canvas");
    const context = canvas.getContext("webgpu");
    if (!context)
        throw new Error("WebGPU: could not get a webgpu context from the canvas.");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: "premultiplied",
    });
    /** 4x or none. Four is the one multisampled count WebGPU guarantees for a
     *  renderable format, so it needs no capability check; anything else is an
     *  optional feature this backend does not ask for. */
    const sampleCount = opts.antialias === false ? 1 : 4;
    const module = device.createShaderModule({ code: SHADER, label: "render3d" });
    // Group 0 holds both uniform buffers; the per-draw one is bound with a
    // dynamic offset so one bind group serves every node in the scene.
    const frameLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
            {
                binding: 1,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { hasDynamicOffset: true, minBindingSize: DRAW_BYTES },
            },
        ],
    });
    const textureLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [frameLayout, textureLayout],
    });
    const vertexBuffers = [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 4, offset: 0, format: "uint16x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 5, offset: 0, format: "float32x4" }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 6, offset: 0, format: "float32x2" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 7, offset: 0, format: "float32x4" }] },
    ];
    const pipelines = new Map();
    function pipelineFor(blend, doubleSided, overlay, lines, 
    /** The `occludedAlpha` ghost pass: depth test reversed, depth writes off. */
    occluded = false, 
    /** `additive`: add to what is behind rather than blending over it. */
    additive = false, 
    /** The overlay pass's depth prepass: an `occludesOverlays` node re-drawn
     *  for its shape alone, so it writes depth and no colour at all. */
    depthOnly = false, 
    /** An `overlayOccluded` overlay: tested against that prepass rather than
     *  ignoring depth, which is the whole point of the pair. */
    gatedOverlay = false, 
    /** True for every overlay in a pass whose depth buffer holds the prepass —
     *  gated or not, none of them may write into it. */
    occluderDepth = false) {
        const key = `${blend}:${doubleSided}:${overlay}:${lines}:${occluded}:${additive}:${depthOnly}:${gatedOverlay}:${occluderDepth}`;
        const cached = pipelines.get(key);
        if (cached)
            return cached;
        const pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module, entryPoint: "vs", buffers: vertexBuffers },
            fragment: {
                module,
                entryPoint: "fs",
                targets: [
                    {
                        format,
                        // A prepass draw exists for its depth: masking the colour off is
                        // what keeps the occluder from painting itself over the frame a
                        // second time, now that the depth it sorted against is gone.
                        writeMask: depthOnly ? 0 : GPUColorWrite.ALL,
                        blend: blend
                            ? {
                                // Premultiplied source, matching the canvas alpha mode and
                                // the shader's premultiplied output. An additive surface
                                // keeps everything behind it and adds its own light on top,
                                // so only the colour destination changes.
                                color: {
                                    srcFactor: "one",
                                    dstFactor: additive ? "one" : "one-minus-src-alpha",
                                },
                                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                            }
                            : undefined,
                    },
                ],
            },
            primitive: {
                topology: lines ? "line-list" : "triangle-list",
                // A segment has no front and no back, and WebGPU rejects a cull mode on
                // a line topology outright.
                cullMode: lines || doubleSided ? "none" : "back",
                frontFace: "ccw",
            },
            depthStencil: {
                format: "depth24plus",
                // Transparent geometry tests against depth but does not write it, so
                // two blended surfaces do not occlude each other. A ghost never writes
                // depth either: a hint that did would occlude the geometry that is
                // doing the occluding. Nor does anything drawn once the prepass is
                // standing in the buffer — that depth belongs to the nominated
                // occluders, and an overlay writing into it would become one.
                depthWriteEnabled: depthOnly || (!blend && !occluded && !occluderDepth),
                // An overlay ignores the scene's depth but still writes its own, so a
                // stack of them occludes itself in draw order. A ghost inverts the
                // test instead, so it paints only where the scene is in front of it.
                // A gated overlay is the one overlay that tests: LEQUAL against the
                // prepass, which contains only what it agreed to hide behind.
                depthCompare: occluded ? "greater" : overlay && !gatedOverlay ? "always" : "less-equal",
            },
            multisample: { count: sampleCount },
        });
        pipelines.set(key, pipeline);
        return pipeline;
    }
    const frameBuffer = device.createBuffer({
        size: FRAME_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    let drawBuffer = null;
    let drawCapacity = 0;
    let drawData = new Float32Array(0);
    let frameBindGroup = null;
    function ensureDrawCapacity(nodes) {
        if (drawBuffer && nodes <= drawCapacity)
            return;
        // Grow in powers of two: a scene that adds one node per frame must not
        // reallocate a GPU buffer per frame.
        const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(1, nodes))));
        drawBuffer?.destroy();
        drawBuffer = device.createBuffer({
            size: capacity * DRAW_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        drawCapacity = capacity;
        drawData = new Float32Array(capacity * DRAW_FLOATS);
        frameBindGroup = device.createBindGroup({
            layout: frameLayout,
            entries: [
                { binding: 0, resource: { buffer: frameBuffer } },
                { binding: 1, resource: { buffer: drawBuffer, size: DRAW_BYTES } },
            ],
        });
    }
    // Four samplers rather than one per material: nearest/linear × clamp/repeat
    // covers every combination the Material type can ask for.
    const samplers = new Map();
    const samplerFor = (pixelated, repeat) => {
        const key = `${pixelated}|${repeat}`;
        let found = samplers.get(key);
        if (!found) {
            const filter = pixelated ? "nearest" : "linear";
            const address = repeat ? "repeat" : "clamp-to-edge";
            found = device.createSampler({
                magFilter: filter,
                minFilter: filter,
                // Trilinear only where a chain exists to read. A sampler asking to
                // blend levels on a texture with one level reads that one level, so
                // this is safe for every texture and not only the mipped ones.
                ...(mipmaps && !pixelated ? { mipmapFilter: "linear" } : {}),
                addressModeU: address,
                addressModeV: address,
            });
            samplers.set(key, found);
        }
        return found;
    };
    const sampler = samplerFor(true, false);
    // A 1×1 opaque white texture stands in when a material has none, so the
    // shader keeps one code path and the bind group is never left unbound.
    const blankTexture = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: blankTexture }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
    const blankBindGroup = device.createBindGroup({
        layout: textureLayout,
        entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: blankTexture.createView() },
            { binding: 2, resource: blankTexture.createView() },
            { binding: 3, resource: blankTexture.createView() },
            { binding: 4, resource: blankTexture.createView() },
        ],
    });
    const meshes = new WeakMap();
    const textureGroups = new WeakMap();
    const textures = new WeakMap();
    /** Sources that have been re-uploaded at least once — a canvas the app is
     *  repainting rather than an image it loaded. A chain is not rebuilt for one:
     *  see `textureFor`, and the WebGL2 backend, which latches the same way. */
    const live = new WeakSet();
    const mipmaps = opts.mipmaps ?? false;
    let width = opts.width ?? 300;
    let height = opts.height ?? 150;
    let dpr = opts.dpr ?? 1;
    let depthTexture = null;
    let colorTexture = null;
    function configureSize() {
        const bw = Math.max(1, Math.round(width * dpr));
        const bh = Math.max(1, Math.round(height * dpr));
        if (canvas.width === bw && canvas.height === bh && depthTexture)
            return;
        canvas.width = bw;
        canvas.height = bh;
        // Destroy before replacing — a depth texture leaked per resize is a
        // several-megabyte-per-drag leak on an interactive viewport.
        depthTexture?.destroy();
        depthTexture = device.createTexture({
            size: [bw, bh],
            format: "depth24plus",
            sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        // The multisampled colour target the pass draws into, resolved into the
        // swap chain at the end of it. A swap-chain texture is single-sampled and
        // cannot be attached to a multisampled pass, so with antialiasing on there
        // is no way round owning this one. Four times the pixels and the same
        // per-resize leak, hence the same destroy.
        colorTexture?.destroy();
        colorTexture =
            sampleCount === 1
                ? null
                : device.createTexture({
                    size: [bw, bh],
                    format,
                    sampleCount,
                    usage: GPUTextureUsage.RENDER_ATTACHMENT,
                });
    }
    configureSize();
    /** Upload a typed array into a fresh GPU buffer. `mappedAtCreation` writes
     *  it without a staging copy, and the size is rounded up because
     *  `createBuffer` requires a multiple of 4. */
    function buffer(data, usage) {
        const buf = device.createBuffer({
            size: alignTo4(data.byteLength),
            usage,
            mappedAtCreation: true,
        });
        new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        buf.unmap();
        return buf;
    }
    function releaseMesh(gpu) {
        gpu.positions.destroy();
        gpu.normals.destroy();
        gpu.uvs.destroy();
        gpu.colors.destroy();
        gpu.joints.destroy();
        gpu.weights.destroy();
        gpu.uvs1.destroy();
        gpu.tangents.destroy();
        gpu.indices.destroy();
    }
    function uploadMesh(mesh) {
        const cached = meshes.get(mesh);
        if (cached && cached.version === mesh.version)
            return cached;
        // A version that moved means the arrays were rewritten in place, so the
        // buffers behind them are stale. Destroying and rebuilding keeps this the
        // same code path as a first upload, and a caller rebuilding every frame is
        // already paying for the data it hands over.
        if (cached)
            releaseMesh(cached);
        const n = vertexCount(mesh);
        // WebGPU has no "disabled attribute" fallback at all — an absent buffer is
        // a validation error, not a garbage read — so defaults are always filled.
        const gpu = {
            positions: buffer(mesh.positions, GPUBufferUsage.VERTEX),
            normals: buffer(mesh.normals ?? defaultNormals(n), GPUBufferUsage.VERTEX),
            uvs: buffer(mesh.uvs ?? new Float32Array(n * 2), GPUBufferUsage.VERTEX),
            colors: buffer(mesh.colors ?? filled(n * 4, 1), GPUBufferUsage.VERTEX),
            joints: buffer(mesh.joints ?? defaultJoints(n), GPUBufferUsage.VERTEX),
            weights: buffer(mesh.weights ?? defaultWeights(n), GPUBufferUsage.VERTEX),
            uvs1: buffer(mesh.uvs1 ?? new Float32Array(n * 2), GPUBufferUsage.VERTEX),
            // Zeroes when the mesh ships none; the shader reads a zero-length
            // tangent as "rebuild the frame from derivatives".
            tangents: buffer(mesh.tangents ?? new Float32Array(n * 4), GPUBufferUsage.VERTEX),
            indices: buffer(mesh.indices, GPUBufferUsage.INDEX),
            count: mesh.indices.length,
            format: mesh.indices instanceof Uint32Array ? "uint32" : "uint16",
            triangles: triangleCount(mesh),
            version: mesh.version,
        };
        meshes.set(mesh, gpu);
        return gpu;
    }
    /** Upload one image and return its GPU texture, reusing the existing one
     *  when only the pixels changed — a resize has to rebuild, since a
     *  GPUTexture's size is fixed at creation. */
    function textureFor(source, version, pixelated = false) {
        const size = sourceSize(source);
        const cached = textures.get(source);
        if (cached && cached.width === size.width && cached.height === size.height) {
            if (cached.version !== version) {
                // **A source that changes is a live surface, and a live surface loses
                // its chain.** Regenerating one is a render pass per level per upload —
                // for a canvas repainted as the app runs, that is per frame — and buys
                // nothing on a texture being redrawn rather than receding. Dropped once
                // and rebuilt flat, which is the same latch the WebGL2 backend keeps.
                if (cached.mipped) {
                    live.add(source);
                    cached.texture.destroy();
                    textures.delete(source);
                    return textureFor(source, version, pixelated);
                }
                device.queue.copyExternalImageToTexture({ source }, { texture: cached.texture, premultipliedAlpha: false }, [size.width, size.height]);
                cached.version = version;
            }
            return cached.texture;
        }
        cached?.texture.destroy();
        const mipped = mipmaps && !pixelated && !live.has(source);
        // `1 + floor(log2(longest side))`: levels down to a single texel.
        const mipLevelCount = mipped ? 1 + Math.floor(Math.log2(Math.max(size.width, size.height))) : 1;
        const texture = device.createTexture({
            size: [size.width, size.height],
            format: "rgba8unorm",
            mipLevelCount,
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: false }, [
            size.width,
            size.height,
        ]);
        if (mipLevelCount > 1)
            buildMipChain(texture, mipLevelCount);
        textures.set(source, {
            texture,
            version,
            width: size.width,
            height: size.height,
            mipped: mipLevelCount > 1,
        });
        return texture;
    }
    /** Fill levels 1..n by rendering each from the one above it.
     *
     * WebGPU has no `generateMipmap`, and this is the shape the API expects
     * instead: a pipeline that draws one full-screen triangle sampling the
     * previous level, run once per level with the destination level as the
     * colour attachment. Built lazily and cached, so a scene with no mipped
     * texture never compiles it. */
    function buildMipChain(texture, levels) {
        const pipeline = mipPipeline();
        const encoder = device.createCommandEncoder();
        for (let level = 1; level < levels; level++) {
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    },
                ],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: mipSampler() },
                    {
                        binding: 1,
                        resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
                    },
                ],
            }));
            pass.draw(3);
            pass.end();
        }
        device.queue.submit([encoder.finish()]);
    }
    let mipPipelineCache = null;
    function mipPipeline() {
        if (mipPipelineCache)
            return mipPipelineCache;
        const module = device.createShaderModule({ code: MIP_BLIT_WGSL });
        mipPipelineCache = device.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "vs" },
            fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
            primitive: { topology: "triangle-list" },
        });
        return mipPipelineCache;
    }
    let mipSamplerCache = null;
    function mipSampler() {
        mipSamplerCache ?? (mipSamplerCache = device.createSampler({ magFilter: "linear", minFilter: "linear" }));
        return mipSamplerCache;
    }
    /** One bind group per (base texture, normal map, detail map, detail mask,
     *  sampler) combination. The group has to name all four textures at once, so
     *  it cannot be cached against the base image alone. */
    function textureGroupFor(material) {
        const base = material.texture;
        const normal = material.normalMap;
        const detail = (material.detailStrength ?? 0) > 0 ? material.detailMap : undefined;
        const mask = detail ? material.detailMask : undefined;
        if (!base && !normal && !detail)
            return blankBindGroup;
        const baseKey = (base ?? blankTexture);
        const samplerKey = `${material.pixelated ?? true}|${material.repeat ?? false}|${identity(normal)}|${identity(detail)}|${identity(mask)}`;
        let byCombination = textureGroups.get(baseKey);
        if (!byCombination) {
            byCombination = new Map();
            textureGroups.set(baseKey, byCombination);
        }
        // The base map follows the material's own filter request; the other three
        // are smooth by nature — a normal map is a vector field, a detail map and
        // its mask are washes — so they take a chain whatever the base asked for.
        const baseTexture = base
            ? textureFor(base, material.textureVersion ?? 0, material.pixelated === true)
            : blankTexture;
        // A normal map is a vector field, so it is always sampled smoothly.
        const normalTexture = normal
            ? textureFor(normal, material.normalMapVersion ?? 0)
            : blankTexture;
        const detailTexture = detail
            ? textureFor(detail, material.detailMapVersion ?? 0)
            : blankTexture;
        const maskTexture = mask ? textureFor(mask, material.detailMaskVersion ?? 0) : blankTexture;
        // A rebuilt texture invalidates every view of it, so the cached group has
        // to be dropped whenever any upload replaced its GPUTexture.
        const stamp = `${identity(baseTexture)}|${identity(normalTexture)}|${identity(detailTexture)}|${identity(maskTexture)}|${samplerKey}`;
        const existing = byCombination.get(stamp);
        if (existing)
            return existing;
        const group = device.createBindGroup({
            layout: textureLayout,
            entries: [
                { binding: 0, resource: samplerFor(material.pixelated ?? true, material.repeat ?? false) },
                { binding: 1, resource: baseTexture.createView() },
                { binding: 2, resource: normalTexture.createView() },
                { binding: 3, resource: detailTexture.createView() },
                { binding: 4, resource: maskTexture.createView() },
            ],
        });
        byCombination.set(stamp, group);
        return group;
    }
    const viewProj = Mat4.create();
    /** The frustum this frame. Built before the gather loop rather than beside
     *  the uniform write below, because the gather is what needs it. */
    const cullProj = Mat4.create();
    const planes = new Float32Array(24);
    const normalMat = new Float32Array(9);
    const eye = { x: 0, y: 0, z: 0 };
    const frameData = new Float32Array(FRAME_BYTES / 4);
    const stats = { drawCalls: 0, triangles: 0, culled: 0 };
    const frameStats = {
        viewports: 0,
        drawCalls: 0,
        triangles: 0,
        culled: 0,
        cpuMs: 0,
    };
    const opaque = [];
    const blended = [];
    /** `depthTest: false` nodes, drawn last against a depth test that passes. */
    const overlay = [];
    /** `occludedAlpha` nodes, drawn a second time where something covers them. */
    const occluded = [];
    /** `occludesOverlays` nodes, re-drawn for their shape alone so an opted-in
     *  overlay has something — and only that something — to be hidden behind. */
    const overlayOccluders = [];
    /** Where each node's uniforms landed, so the prepass can re-draw an occluder
     *  from the slot it already has instead of packing the same bytes twice. */
    const slotOf = new Map();
    /** Pack one node's per-draw uniforms at slot `slot`. */
    function writeDrawData(node, material, slot) {
        const at = slot * DRAW_FLOATS;
        drawData.set(node.world, at);
        const nm = Mat4.normalMatrix(node.world, normalMat) ?? IDENTITY3;
        for (let c = 0; c < 3; c++) {
            drawData[at + 16 + c * 4] = nm[c * 3];
            drawData[at + 16 + c * 4 + 1] = nm[c * 3 + 1];
            drawData[at + 16 + c * 4 + 2] = nm[c * 3 + 2];
            drawData[at + 16 + c * 4 + 3] = 0;
        }
        const color = material.color ?? WHITE;
        drawData.set(color, at + 28);
        drawData[at + 32] = material.shininess ?? 0;
        drawData[at + 33] = material.unlit ? 1 : 0;
        drawData[at + 34] = material.texture
            ? material.textureBlend === "mask"
                ? 3
                : material.textureBlend === "over"
                    ? 2
                    : 1
            : 0;
        drawData[at + 35] = material.specular ?? 0.25;
        const skin = node.skin?.matrices;
        if (skin && skin.length > MAX_JOINTS * 16) {
            throw new Error(`WebGPU supports at most ${MAX_JOINTS} skin joints per node.`);
        }
        drawData[at + 36] = skin ? 1 : 0;
        drawData[at + 37] = material.normalMap ? 1 : 0;
        drawData[at + 38] = material.normalScale ?? 1;
        drawData[at + 39] =
            material.uvProjection === "planarXZ" ? 1 : material.uvProjection === "sphere" ? 2 : 0;
        const uvScale = material.uvScale ?? UNIT_UV;
        const uvOffset = material.uvOffset ?? ZERO_UV;
        drawData[at + 40] = uvScale[0];
        drawData[at + 41] = uvScale[1];
        drawData[at + 42] = uvOffset[0];
        drawData[at + 43] = uvOffset[1];
        // `[1, 0, 1]` is the identity ramp: bias 1 with no grazing term leaves the
        // alpha exactly as authored, and the shader's own `scale != 0` test skips
        // the pow() entirely.
        const rim = material.rimAlpha;
        drawData[at + 44] = rim?.[0] ?? 1;
        drawData[at + 45] = rim?.[1] ?? 0;
        drawData[at + 46] = rim?.[2] ?? 1;
        drawData[at + 47] = material.metallic ?? 0;
        drawData[at + 48] = material.detailMap ? (material.detailStrength ?? 0) : 0;
        drawData[at + 49] = material.detailUv === 1 ? 1 : 0;
        drawData[at + 50] = material.detailBlend === "over" ? (material.detailColorScale ?? 1) : 0;
        const detailProjection = detailProjectionMode(material);
        drawData[at + 51] = detailProjection;
        const detailProjected = material.detailUv === 1 || detailProjection !== 0;
        const detailScale = material.detailUvScale ?? (detailProjected ? UNIT_UV : uvScale);
        const detailOffset = material.detailUvOffset ?? (detailProjected ? ZERO_UV : uvOffset);
        drawData[at + 52] = detailScale[0];
        drawData[at + 53] = detailScale[1];
        drawData[at + 54] = detailOffset[0];
        drawData[at + 55] = detailOffset[1];
        const maskScale = material.detailMask ? material.detailMaskUvScale : undefined;
        const maskOffset = material.detailMaskUvOffset ?? ZERO_UV;
        drawData[at + 56] = maskScale?.[0] ?? 0;
        drawData[at + 57] = maskScale?.[1] ?? 0;
        drawData[at + 58] = maskOffset[0];
        drawData[at + 59] = maskOffset[1];
        drawData[at + 60] = material.detailPremultiplied ? 1 : 0;
        drawData[at + 61] = detailWorldStep(material);
        // Needs `transparent`: an opaque surface's alpha is written to a channel
        // nothing reads, and letting a decal move it there would only invite a
        // pipeline change to start showing holes in a floor.
        drawData[at + 62] = material.detailOpacity && material.transparent ? 1 : 0;
        drawData[at + 63] = 0;
        // The faked reflective coat. `glazeStrength` is the one test the shader
        // branches the whole thing on, and `glazeParallax` is what stops a material
        // with no albedo from re-sampling the 1x1 blank — both resolved in scene.ts
        // so the two backends cannot disagree about what "off" means.
        const glaze = glazeStrength(material);
        drawData[at + 64] = glaze;
        drawData[at + 65] = material.glaze?.fresnel ?? 4;
        drawData[at + 66] = glazeParallax(material);
        drawData[at + 67] = material.glaze?.scroll ?? 0;
        const tint = material.glaze?.tint ?? WHITE3;
        drawData[at + 68] = tint[0];
        drawData[at + 69] = tint[1];
        drawData[at + 70] = tint[2];
        drawData[at + 71] = material.glaze?.scrollScale ?? 0.25;
        drawData[at + 72] = material.glaze?.ripple ?? 0.08;
        drawData[at + 73] = material.glaze?.sparkle ?? 0;
        drawData[at + 74] = 0;
        drawData[at + 75] = 0;
        // What has settled on it. Both weights go to zero when `settleActive` says
        // there is nothing to lay on, which is what keeps the shader's own `w > 0`
        // test from reaching a half-configured wash.
        const settle = settleActive(material) ? material.settle : undefined;
        const laid = settle?.color ?? WHITE3;
        drawData[at + 76] = laid[0];
        drawData[at + 77] = laid[1];
        drawData[at + 78] = laid[2];
        drawData[at + 79] = settle?.up ?? 0;
        drawData[at + 80] = settle?.upSharpness ?? 4;
        drawData[at + 81] = settle?.baseY ?? 0;
        drawData[at + 82] = settle?.rise ?? 0;
        drawData[at + 83] = settle?.riseAmount ?? 0;
        const textureColor = material.textureColor ?? WHITE;
        drawData.set(textureColor, at + 84);
        drawData.set(skin ?? IDENTITY_JOINTS, at + 88);
    }
    /** Bind one node's mesh, textures and packed uniform slot, and draw it.
     *  Which PIPELINE is the caller's business, because the same node is drawn
     *  three different ways: as itself, as its `occludedAlpha` ghost, and as a
     *  depth-only shape in the overlay pass's prepass. */
    function drawSlot(pass, node, material, slot, pipeline) {
        const gpu = uploadMesh(node.mesh);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, frameBindGroup, [slot * DRAW_BYTES]);
        pass.setBindGroup(1, textureGroupFor(material));
        pass.setVertexBuffer(0, gpu.positions);
        pass.setVertexBuffer(1, gpu.normals);
        pass.setVertexBuffer(2, gpu.uvs);
        pass.setVertexBuffer(3, gpu.colors);
        pass.setVertexBuffer(4, gpu.joints);
        pass.setVertexBuffer(5, gpu.weights);
        pass.setVertexBuffer(6, gpu.uvs1);
        pass.setVertexBuffer(7, gpu.tangents);
        pass.setIndexBuffer(gpu.indices, gpu.format);
        pass.drawIndexed(gpu.count);
        stats.drawCalls++;
        stats.triangles += gpu.triangles;
    }
    const renderer = {
        backend: "webgpu",
        canvas,
        clipZeroToOne: true,
        stats,
        consumeFrameStats() {
            const snapshot = {
                ...frameStats,
                gpuMs: timestampSupported ? resolvedGpuMs : undefined,
            };
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
            return canvas.width;
        },
        get renderHeight() {
            return canvas.height;
        },
        resize(w, h, ratio) {
            width = Math.max(1, w);
            height = Math.max(1, h);
            if (ratio !== undefined)
                dpr = ratio;
            configureSize();
        },
        render(scene, camera, options = {}) {
            stats.drawCalls = 0;
            stats.triangles = 0;
            stats.culled = 0;
            frameStats.viewports++;
            const renderStart = performance.now();
            configureSize();
            // Partition first: the per-draw buffer is written in one go before the
            // render pass opens, because a pass cannot be interrupted by a queue
            // write.
            opaque.length = 0;
            blended.length = 0;
            overlay.length = 0;
            occluded.length = 0;
            overlayOccluders.length = 0;
            cameraPosition(camera, eye);
            // `true` for WebGPU's 0..1 depth range, which is the same flag the
            // projection below is built with and which decides the near plane.
            viewProjection(camera, width / height, true, cullProj);
            frustumPlanes(cullProj, planes, true);
            scene.nodes.forEach((n, i) => {
                if (!n.mesh || !n.world)
                    return;
                if (!isVisible(scene, i)) {
                    stats.culled++;
                    return;
                }
                // **And whether the camera can see it at all** — see `cull.ts`. Without
                // this every mesh in the level is drawn every frame, so cost follows
                // the size of the WORLD rather than the size of the view.
                if (!inFrustum(planes, meshBounds(n.mesh), n.world)) {
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
                // the surface still draws normally where it is visible. An overlay is
                // already drawn over everything, so a ghost of it would paint the same
                // picture twice.
                if ((n.material?.occludedAlpha ?? 0) > 0 && n.material?.depthTest !== false) {
                    occluded.push(i);
                }
                // `depthTest: false` opts out of the scene's depth entirely, so it
                // cannot share a pass with geometry that is still sorting against it.
                if (n.material?.depthTest === false) {
                    overlay.push(i);
                }
                else if (n.material?.transparent) {
                    const dx = n.world[12] - eye.x;
                    const dy = n.world[13] - eye.y;
                    const dz = n.world[14] - eye.z;
                    blended.push({ index: i, depth: dx * dx + dy * dy + dz * dz });
                }
                else {
                    opaque.push(i);
                }
            });
            blended.sort((a, b) => b.depth - a.depth);
            const total = opaque.length + blended.length + occluded.length + overlay.length;
            ensureDrawCapacity(Math.max(1, total));
            viewProjection(camera, width / height, true, viewProj);
            frameData.set(viewProj, 0);
            frameData.set([eye.x, eye.y, eye.z, 0], 16);
            const toneMap = scene.toneMapping === "aces" ? 1 : 0;
            frameData.set([scene.ambient[0], scene.ambient[1], scene.ambient[2], toneMap], 20);
            // No ground colour means no hemisphere: both ends the same colour makes
            // the shader's mix a no-op and keeps the fill uniform.
            const ground = scene.ambientGround ?? scene.ambient;
            frameData.set([ground[0], ground[1], ground[2], 0], 24);
            const lights = scene.lights.slice(0, MAX_LIGHTS);
            frameData[28] = lights.length;
            const fog = scene.fog ? fogUniform(scene.fog) : undefined;
            frameData.set(fog ? [...fog.params, fog.mode] : [0, 0, 0, -1], 32);
            frameData.set(scene.fog ? [scene.fog.color[0], scene.fog.color[1], scene.fog.color[2], 1] : [0, 0, 0, 0], 36);
            lights.forEach((light, i) => {
                const d = light.direction;
                const l = Math.hypot(d.x, d.y, d.z) || 1;
                frameData.set([d.x / l, d.y / l, d.z / l, 0], 40 + i * 4);
                const c = light.color ?? WHITE3;
                const k = light.intensity ?? 1;
                frameData.set([c[0] * k, c[1] * k, c[2] * k, 0], 56 + i * 4);
            });
            device.queue.writeBuffer(frameBuffer, 0, frameData);
            // The ghosts go between the blended pass and the overlays: they blend
            // over whatever is covering their node, and an overlay is meant to sit
            // above everything including them. Each carries its own draw slot,
            // because it is the same node with a different alpha.
            const order = [...opaque, ...blended.map((b) => b.index), ...occluded, ...overlay];
            const firstGhost = opaque.length + blended.length;
            const firstOverlay = order.length - overlay.length;
            order.forEach((index, slot) => {
                const n = scene.nodes[index];
                const material = n.material ?? {};
                const ghost = slot >= firstGhost && slot < firstGhost + occluded.length;
                writeDrawData(n, ghost ? ghostMaterial(material) : material, slot);
            });
            if (total > 0) {
                device.queue.writeBuffer(drawBuffer, 0, drawData, 0, total * DRAW_FLOATS);
            }
            // Both halves of the `occludesOverlays`/`overlayOccluded` pair have to be
            // in the frame for the prepass to mean anything: an occluder with no
            // opted-in overlay hides nothing, and an opted-in overlay with no
            // occluder wants the ordinary "over everything" pass rather than a test
            // against an empty buffer. Either missing and the frame is encoded
            // exactly as it was before the pair existed.
            const gating = overlayOccluders.length > 0 &&
                overlay.some((i) => scene.nodes[i].material?.overlayOccluded === true);
            slotOf.clear();
            // An occluder is an ordinary scene node drawn before the ghosts, so its
            // uniforms are already packed and the prepass re-draws it from the slot
            // it has rather than spending a second one on identical bytes.
            if (gating)
                for (let slot = 0; slot < firstGhost; slot++)
                    slotOf.set(order[slot], slot);
            const bg = scene.background;
            const encoder = device.createCommandEncoder();
            const timestampSlot = reserveGpuTimestamp();
            // Multisampled: draw into the offscreen target and let the pass resolve
            // it down into the frame the compositor shows. The views are made once,
            // because a gated frame encodes two passes over the same textures.
            const colorView = (colorTexture ?? context.getCurrentTexture()).createView();
            const resolveView = colorTexture ? context.getCurrentTexture().createView() : undefined;
            const depthView = depthTexture.createView();
            let pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        // `storeOp` stays `"store"` rather than the usual `"discard"`,
                        // because a caller that renders a second layer with `clear: false`
                        // needs the samples this pass wrote, not just their average.
                        view: colorView,
                        resolveTarget: resolveView,
                        // Premultiplied clear, matching the canvas alpha mode.
                        clearValue: { r: bg[0] * bg[3], g: bg[1] * bg[3], b: bg[2] * bg[3], a: bg[3] },
                        loadOp: options.clear === false ? "load" : "clear",
                        storeOp: "store",
                    },
                ],
                depthStencilAttachment: {
                    view: depthView,
                    depthClearValue: 1,
                    depthLoadOp: options.clear === false ? "load" : "clear",
                    depthStoreOp: "store",
                },
                timestampWrites: timestampSlot === null
                    ? undefined
                    : {
                        querySet: timestampQuerySet,
                        beginningOfPassWriteIndex: timestampSlot * 2,
                        // The closing stamp belongs to whichever pass ends the frame,
                        // or a gated frame would report a GPU time that stops before
                        // its overlays.
                        endOfPassWriteIndex: gating ? undefined : timestampSlot * 2 + 1,
                    },
            });
            for (let slot = 0; slot < order.length; slot++) {
                if (gating && slot === firstOverlay) {
                    // What an opted-in overlay must test against is a depth buffer
                    // holding the nominated occluders and NOTHING else — the scene's own
                    // depth is the thing the overlay pass exists to ignore. WebGPU can
                    // only clear an attachment as a pass BEGINS, so a gated frame is two
                    // passes: the scene, then the overlays over a cleared depth buffer
                    // with the colour loaded, so the second paints onto the first's
                    // picture rather than starting again.
                    pass.end();
                    pass = encoder.beginRenderPass({
                        colorAttachments: [
                            {
                                view: colorView,
                                resolveTarget: resolveView,
                                loadOp: "load",
                                storeOp: "store",
                            },
                        ],
                        depthStencilAttachment: {
                            view: depthView,
                            depthClearValue: 1,
                            depthLoadOp: "clear",
                            depthStoreOp: "store",
                        },
                        timestampWrites: timestampSlot === null
                            ? undefined
                            : { querySet: timestampQuerySet, endOfPassWriteIndex: timestampSlot * 2 + 1 },
                    });
                    for (const index of overlayOccluders) {
                        const occluderSlot = slotOf.get(index);
                        if (occluderSlot === undefined)
                            continue;
                        const n = scene.nodes[index];
                        const material = n.material ?? {};
                        drawSlot(pass, n, material, occluderSlot, pipelineFor(
                        // Never blended, whatever the surface is: a draw that writes no
                        // colour has nothing to blend, and saying so keeps a
                        // transparent occluder from also turning its depth writes off.
                        false, !!material.doubleSided, false, n.mesh.topology === "lines", false, false, true));
                    }
                }
                const index = order[slot];
                const n = scene.nodes[index];
                const ghost = slot >= firstGhost && slot < firstGhost + occluded.length;
                const material = ghost ? ghostMaterial(n.material ?? {}) : (n.material ?? {});
                drawSlot(pass, n, material, slot, pipelineFor(!!material.transparent, !!material.doubleSided, material.depthTest === false, n.mesh.topology === "lines", ghost, 
                // A ghost is a hint about where something is, not a light: it
                // blends whatever the surface it copies does.
                !ghost && !!material.additive, false, gating && slot >= firstOverlay && material.overlayOccluded === true, gating && slot >= firstOverlay));
            }
            pass.end();
            const timestampReadback = timestampSlot === null ? null : finishGpuTimestamp(encoder, timestampSlot);
            device.queue.submit([encoder.finish()]);
            if (timestampReadback && timestampSlot !== null) {
                collectGpuTimestamp(timestampSlot, timestampReadback);
            }
            frameStats.drawCalls += stats.drawCalls;
            frameStats.triangles += stats.triangles;
            frameStats.culled += stats.culled;
            frameStats.cpuMs += performance.now() - renderStart;
        },
        release(mesh) {
            const gpu = meshes.get(mesh);
            if (!gpu)
                return;
            releaseMesh(gpu);
            meshes.delete(mesh);
        },
        dispose() {
            depthTexture?.destroy();
            colorTexture?.destroy();
            drawBuffer?.destroy();
            frameBuffer.destroy();
            blankTexture.destroy();
            timestampQuerySet?.destroy();
            timestampResolveBuffer?.destroy();
            device.destroy();
        },
    };
    return renderer;
}
const WHITE = [1, 1, 1, 1];
const WHITE3 = [1, 1, 1];
const UNIT_UV = [1, 1];
const ZERO_UV = [0, 0];
/** A stable per-object id, so a bind-group cache key can name two textures
 *  without holding them alive in a string. */
const identities = new WeakMap();
let nextIdentity = 1;
function identity(value) {
    if (!value)
        return 0;
    let id = identities.get(value);
    if (id === undefined) {
        id = nextIdentity++;
        identities.set(value, id);
    }
    return id;
}
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const IDENTITY_JOINTS = new Float32Array(MAX_JOINTS * 16);
for (let i = 0; i < MAX_JOINTS; i++) {
    IDENTITY_JOINTS[i * 16] = 1;
    IDENTITY_JOINTS[i * 16 + 5] = 1;
    IDENTITY_JOINTS[i * 16 + 10] = 1;
    IDENTITY_JOINTS[i * 16 + 15] = 1;
}
function alignTo4(bytes) {
    return (bytes + 3) & ~3;
}
function filled(n, value) {
    const a = new Float32Array(n);
    a.fill(value);
    return a;
}
function defaultNormals(n) {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++)
        a[i * 3 + 1] = 1;
    return a;
}
function defaultJoints(n) {
    return new Uint16Array(n * 4);
}
function defaultWeights(n) {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++)
        a[i * 4] = 1;
    return a;
}
/** The pixel size of anything `copyExternalImageToTexture` accepts. The union
 *  spells its dimensions three different ways. */
function sourceSize(source) {
    const s = source;
    const width = s.width ?? s.videoWidth ?? s.codedWidth ?? 1;
    const height = s.height ?? s.videoHeight ?? s.codedHeight ?? 1;
    return { width: Math.max(1, width), height: Math.max(1, height) };
}
