// ---------- Scene graph ----------
// A flat array of nodes, each optionally naming a parent. Not a linked tree of
// objects with `children` arrays: a flat list keeps the update loop a single
// pass with no recursion, serialises to JSON for free (which is what hot-reload
// state saving and snapshots need), and makes "draw every node with this
// material" an ordinary filter.
//
// The one rule that makes the flat form work: **a node's parent must appear
// EARLIER in the array**. `updateWorldMatrices` relies on it to resolve
// hierarchy in one forward pass, and `Scene.add` enforces it by construction
// since a child can only name a parent that already exists.
//
// Transforms are TRS (`position`, `rotation`, `scale`) rather than a matrix,
// because that is what animation interpolates — a keyframe track writes a
// quaternion, and only the renderer ever wants the matrix.

import { Mat4 } from "@src/math/mat4.js";
import { Quat } from "@src/math/quat.js";
import type { MeshData } from "./mesh.js";
import type { Vec3 } from "@src/math/vec3.js";

/** How a surface responds to light. Deliberately small: a colour, an optional
 *  texture, and the two switches that change how a mesh reads at a glance. A
 *  general material/shader API is a much larger design question and is not
 *  this. */
export interface Material {
  /** Base colour as `[r, g, b, a]`, each 0..1. Multiplied with the texture and
   *  with any per-vertex colours. */
  color?: readonly [number, number, number, number];
  /** Surface texture. Any 2D image source the engine already rasterises to —
   *  a sprite, an atlas canvas, an `ImageBitmap`. */
  texture?: TexImageSource;
  /** Bump this whenever the texture's PIXELS change. Textures are cached by
   *  object identity, so a canvas that is redrawn in place looks unchanged to
   *  the renderer and would keep showing its first frame forever — which is
   *  exactly what a live UI surface is. Leave it undefined for a static image
   *  and the upload happens once. */
  textureVersion?: number;
  /** Skip lighting entirely and emit `color` directly. For UI gizmos,
   *  wireframe-ish helpers and anything that must stay legible at any angle. */
  unlit?: boolean;
  /** Draw both faces. Off by default — backface culling is half the fill-rate
   *  of a closed mesh for free — but a plane, a leaf card or a flag needs it. */
  doubleSided?: boolean;
  /** Blend rather than write depth. Transparent nodes are drawn after opaque
   *  ones, back to front; see `Renderer3D` for the ordering rule and its
   *  limits. */
  transparent?: boolean;
  /** Draw over everything, whatever is in front. Set false and the surface
   *  skips the depth test entirely and is drawn last, after both the opaque
   *  and the blended pass.
   *
   *  This is for geometry that is IN the world but is really a readout of it:
   *  an aiming guide, a range ring, a selection outline, a waypoint marker.
   *  Such a thing has a world position and wants perspective and occlusion
   *  from nothing — burying it behind the hill it is measuring makes it
   *  useless exactly when it matters. The alternative, nudging it towards the
   *  camera until it clears, breaks as soon as the terrain is steeper than the
   *  nudge.
   *
   *  It still writes depth unless `transparent` is also set, so two overlay
   *  surfaces occlude each other in the order you would expect while both
   *  ignore the scene. Default is the ordinary depth-tested behaviour. */
  depthTest?: boolean;
  /** A view-angle alpha ramp as `[bias, scale, power]`, multiplied into the
   *  surface's own alpha:
   *
   *      a *= clamp(bias + scale * (1 - dot(view, normal))ᵖᵒʷᵉʳ, 0, 1)
   *
   *  A face turned towards the viewer contributes only `bias`; one seen edge-on
   *  reaches `bias + scale`. That is what makes a hollow shape read as glass
   *  rather than as a flat wash — the silhouette stays solid while the front
   *  wall goes see-through, so whatever is inside shows through it.
   *
   *  Needs `transparent` to be set as well; on its own it computes an alpha
   *  nothing blends with. */
  rimAlpha?: readonly [number, number, number];
  /** Blinn-Phong specular EXPONENT — how tight the highlight is. 0 disables
   *  it. Low values are not a subtle effect: an exponent of 8 spreads the
   *  highlight over most of the surface, so it reads as "this object is
   *  washed out" rather than "this object is shiny". Pair a low exponent with
   *  a low `specular`. */
  shininess?: number;
  /** How BRIGHT the highlight is, 0..1. Default 0.25. Separate from
   *  `shininess` because the two do different jobs and conflating them is why
   *  a first-attempt Blinn-Phong surface looks bleached: without a strength
   *  term the highlight adds a full white on top of the base colour. */
  specular?: number;
  /** Metalness, 0..1. Default 0, which is every non-metal.
   *
   *  Only `toneMapping: "aces"` reads it, and there it does the two things
   *  metalness does: the highlight takes the surface's own colour instead of
   *  the light's, and the diffuse goes away, because what a metal does not
   *  reflect it absorbs. Both are wrong for a dielectric and both matter — a
   *  white highlight on a saturated surface lifts whichever channel the
   *  surface has least of, which reads as the colour draining out.
   *
   *  Kept separate from `specular` on purpose. They were briefly the same
   *  field, because a glTF document's `metallicFactor` was the only
   *  reflectivity signal the direct model had anywhere to put; then the
   *  physical path started reading it as metalness and every hand-authored
   *  material that had set `specular` to mean "shiny" turned into a metal and
   *  went dark. */
  metallic?: number;
  /** Nearest-neighbour texture sampling — the pixel-art default the rest of
   *  the engine assumes. Set false for a photographic texture. */
  pixelated?: boolean;
  /** Tangent-space normal map, sampled with the same uv as `texture`. RGB is
   *  the usual `xyz * 0.5 + 0.5` encoding; the blue channel points out of the
   *  surface, which is why an unmodified normal map looks lilac.
   *
   *  No TANGENT vertex attribute is needed: the basis is rebuilt per pixel
   *  from screen-space derivatives of the position and uv. That costs a few
   *  ALU ops and, unlike a baked tangent, cannot disagree with the uvs the
   *  mesh actually ships. It does need real uvs — a mesh without them gets a
   *  degenerate basis, so the map is ignored. */
  normalMap?: TexImageSource;
  /** Bump when the normal map's PIXELS change, as with `textureVersion`. */
  normalMapVersion?: number;
  /** How far the normal map tilts the surface, 0..1+ where 1 is the map's own
   *  strength and 0 is flat. Default 1. */
  normalScale?: number;
  /** Multiply uvs by this before sampling — how a small detail texture tiles
   *  across a large surface. Default `[1, 1]`. */
  uvScale?: readonly [number, number];
  /** Added to the uvs after `uvScale`. Default `[0, 0]`. */
  uvOffset?: readonly [number, number];
  /** Repeat the texture outside 0..1 instead of clamping to its edge pixels.
   *  Required for anything that tiles; off by default because clamping is what
   *  an atlas or a sprite needs and wrapping one bleeds its neighbour in. */
  repeat?: boolean;
  /** Where the uvs come from before `uvScale`/`uvOffset` apply.
   *
   *  `mesh` (the default) reads the mesh's own TEXCOORD_0. `planarXZ` drops
   *  the world position straight down the Y axis instead, so one tiling
   *  texture runs continuously across a whole environment and no mesh in it
   *  has to be unwrapped — the standard trick for ground. The seams show on
   *  vertical faces, which is why it is per-material rather than global. */
  uvProjection?: "mesh" | "planarXZ";
  /** How `texture` combines with `color`.
   *
   *  `multiply` (the default) tints: the texture darkens the base colour and a
   *  transparent texel makes the surface transparent. `over` composites the
   *  texture on top using its own alpha, leaving the base colour showing
   *  through where the texture is clear — what a decal or line sheet painted
   *  over a solid colour needs. */
  textureBlend?: "multiply" | "over";
}

/** How fog thickens with distance. `layered` is the odd one out: it is a
 *  ground-hugging slab rather than a uniform medium, so a hill pokes out of it
 *  while the valley behind stays white. */
export type FogMode = "linear" | "exponential" | "exponentialSquared" | "layered";

/** Atmosphere that keeps a large scene from ending in a hard silhouette
 *  against the background. Every mode produces a *visibility* factor `f` in
 *  0..1 which the shader uses as `mix(color, shaded, f)` — 1 is clear air.
 *
 *      linear              f = clamp((end - d) / (end - start), 0, 1)
 *      exponential         f = exp(-D * density),        D = max(d - start, 0) / attenuation * 4
 *      exponentialSquared  f = exp(-(D * density)²)
 *      layered             a slab below `height`, `range` thick, integrated
 *                          along the view ray and attenuated horizontally
 *
 *  where `d` is the distance from the camera. The layered integral is what
 *  makes the slab hold still as the camera moves through it instead of
 *  sliding with the near plane. */
export interface Fog3D {
  /** Fog colour as `[r, g, b]`, each 0..1. Usually close to the background. */
  color: readonly [number, number, number];
  /** Which falloff curve to use. Default `exponential`. */
  mode?: FogMode;
  /** Distance at which fog begins. `linear` and both exponentials only. */
  start?: number;
  /** Distance at which `linear` fog reaches full strength. Default 300. */
  end?: number;
  /** Thickness multiplier for both exponentials. Default 0.3. */
  density?: number;
  /** Horizontal distance scale for the exponentials and for `layered`.
   *  Larger means the fog takes longer to build up. Default 5. */
  attenuation?: number;
  /** World Y of the top of a `layered` slab. Default 0. */
  height?: number;
  /** Depth of the `layered` slab below `height`. Default 1.2. */
  range?: number;
}

/** A glTF-compatible linear blend skin. Joint indices refer to nodes in the
 *  same flat scene array, and inverse bind matrices are column-major 4×4
 *  matrices, one per joint. `matrices` is filled by `updateWorldMatrices`. */
export interface Skin3D {
  joints: readonly number[];
  inverseBindMatrices: Float32Array;
  matrices?: Float32Array;
}

/** One thing in the scene: a transform, optionally a mesh to draw with a
 *  material, optionally parented to an earlier node. */
export interface Node3D {
  /** Stable name — for `Scene.find`, for animation tracks to target, and for
   *  debugging a hierarchy that has gone wrong. */
  name?: string;
  /** Local position, relative to the parent. */
  position: Vec3;
  /** Local rotation. */
  rotation: Quat;
  /** Local scale. */
  scale: Vec3;
  /** What to draw. A node with no mesh is a pure transform — a pivot, a bone,
   *  an attachment point. */
  mesh?: MeshData;
  /** How to draw it. */
  material?: Material;
  /** Optional skeletal skin used by `mesh.joints` and `mesh.weights`. */
  skin?: Skin3D;
  /** Index of the parent node in the same array, which MUST be smaller than
   *  this node's own index. */
  parent?: number;
  /** Hide this node (its children still resolve — hiding a pivot does not hide
   *  what hangs off it, which is usually what you want for a debug toggle). */
  hidden?: boolean;
  /** World matrix, written by `updateWorldMatrices`. Do not set by hand. */
  world?: Mat4;
}

/** A directional light — a direction and a colour, no position. One or two of
 *  these plus ambient is what a preview or a stylised game wants; point and
 *  spot lights are a shadow-mapping conversation, not a lighting one. */
export interface DirectionalLight {
  /** The direction the light TRAVELS (so a sun overhead points down, −Y).
   *  Normalized on use, so an unnormalized vector is fine. */
  direction: Vec3;
  /** Light colour as `[r, g, b]`, each 0..1. Values above 1 are allowed and
   *  simply overexpose. */
  color?: readonly [number, number, number];
  /** Brightness multiplier. */
  intensity?: number;
}

/** What the shader does with a colour on its way to the framebuffer.
 *
 *  `"none"` is the direct model and the default: material colours are display
 *  values, a light of intensity 1 leaves a face-on surface at its own colour,
 *  and what the shader computes is what the pixel gets. It is predictable and
 *  it is what a gizmo, a preview or a flat-shaded game wants.
 *
 *  `"aces"` is the physical model, and it is a different contract rather than
 *  an extra step on the end. Colours are treated as sRGB and decoded before
 *  lighting, the diffuse term is divided by π so intensities read as
 *  illuminance rather than as a multiplier, and the result is run through the
 *  ACES filmic curve and re-encoded. The visible consequence is the shoulder:
 *  a lit face can be given four or five times the light it needs and roll off
 *  to white smoothly instead of clipping, which is what lets an ambient fill
 *  bright enough to keep unlit faces readable coexist with a strong key.
 *
 *  Do not mix the two by feeding `"none"` intensities to `"aces"`. Under
 *  `"none"` a key and a fill that sum to 1 are correctly exposed; under
 *  `"aces"` the same pair renders muted and dark, because the π and the curve
 *  are both expecting numbers several times larger. */
export type ToneMapping = "none" | "aces";

/** Everything a `Renderer3D` needs to draw a frame. */
export interface Scene3D {
  /** Nodes in dependency order — every parent before its children. */
  nodes: Node3D[];
  /** Directional lights. An empty list plus zero ambient renders black, which
   *  is a surprisingly common first-run mistake; `createScene` seeds one. */
  lights: DirectionalLight[];
  /** Uniform fill light as `[r, g, b]`, keeping shadowed faces readable.
   *  With `ambientGround` set this is the SKY half of a hemisphere instead. */
  ambient: readonly [number, number, number];
  /** Ground half of an ambient hemisphere, as `[r, g, b]`.
   *
   *  Set it and `ambient` stops being uniform: a face pointing straight up
   *  gets `ambient`, one pointing straight down gets this, and the two blend
   *  by the normal's Y. That single gradient is most of what separates a fill
   *  that reads as sky from one that reads as a grey wash, and it costs one
   *  `mix`. Left unset, the fill stays uniform. */
  ambientGround?: readonly [number, number, number];
  /** How the shader turns computed light into a pixel. Defaults to `"none"`.
   *  Read `ToneMapping` before changing it: the two modes want light
   *  intensities on different scales. */
  toneMapping?: ToneMapping;
  /** Background as `[r, g, b, a]`. An alpha below 1 lets whatever is behind
   *  the 3D viewport show through — which is how a model sits on a UI panel
   *  without a box of sky around it. */
  background: readonly [number, number, number, number];
  /** Optional distance fog. Unlit materials are left alone: a gizmo or a
   *  nameplate that opted out of lighting has opted out of atmosphere too. */
  fog?: Fog3D;
}

/** The fog mode as the shaders see it. Resolved here rather than in each
 *  backend so WebGL2 and WebGPU cannot drift apart, and so the guards against
 *  a divide-by-zero live in one place. `params` means `(start, end, unused)`
 *  for linear, `(start, density, attenuation)` for the exponentials and
 *  `(height, range, attenuation)` for layered. */
export function fogUniform(fog: Fog3D): { mode: number; params: [number, number, number] } {
  const attenuation = Math.max(fog.attenuation ?? 5, 1e-3);
  switch (fog.mode ?? "exponential") {
    case "linear": {
      const start = fog.start ?? 0;
      // An end at or before the start is a zero-width ramp; nudge it so the
      // shader's division stays finite and the fog reads as a hard cut.
      return { mode: 0, params: [start, Math.max(fog.end ?? 300, start + 1e-3), 0] };
    }
    case "exponentialSquared":
      return { mode: 2, params: [fog.start ?? 0, fog.density ?? 0.3, attenuation] };
    case "layered":
      return { mode: 3, params: [fog.height ?? 0, Math.max(fog.range ?? 1.2, 1e-3), attenuation] };
    default:
      return { mode: 1, params: [fog.start ?? 0, fog.density ?? 0.3, attenuation] };
  }
}

/** A node with sane defaults: identity transform, no mesh. Spread over it to
 *  set what you care about. */
export function node(init: Partial<Node3D> = {}): Node3D {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: Quat.create(),
    scale: { x: 1, y: 1, z: 1 },
    ...init,
  };
}

/** An empty scene lit well enough to see something immediately: one key light
 *  from over the viewer's shoulder, modest ambient, transparent background. */
export function createScene(init: Partial<Scene3D> = {}): Scene3D {
  return {
    nodes: [],
    lights: [{ direction: { x: -0.4, y: -1, z: -0.6 }, intensity: 1 }],
    ambient: [0.32, 0.34, 0.4],
    background: [0, 0, 0, 0],
    ...init,
  };
}

/** Append a node and return its index — the handle a child passes as `parent`
 *  and an animation track uses as its target.
 *
 *  Throws when the parent index is not already in the scene: that is the
 *  ordering invariant this file depends on, and a forward reference would
 *  otherwise show up as a mesh silently stuck at the origin. */
export function addNode(scene: Scene3D, n: Node3D): number {
  if (n.parent !== undefined && (n.parent < 0 || n.parent >= scene.nodes.length)) {
    throw new Error(
      `Node3D parent ${n.parent} must be an index already in the scene (length ${scene.nodes.length}) — parents come first.`,
    );
  }
  scene.nodes.push(n);
  return scene.nodes.length - 1;
}

/** Index of the first node with this name, or −1. */
export function findNode(scene: Scene3D, name: string): number {
  return scene.nodes.findIndex((n) => n.name === name);
}

/** Resolve every node's world matrix from its TRS and its parent chain — one
 *  forward pass, no recursion, which is only correct because parents precede
 *  children. Call once per frame after animating, before rendering. */
export function updateWorldMatrices(scene: Scene3D): void {
  for (const n of scene.nodes) {
    const local = Mat4.compose(n.position, n.rotation, n.scale, (n.world ??= Mat4.create()));
    if (n.parent !== undefined) {
      const parent = scene.nodes[n.parent].world;
      // The parent was resolved earlier in this same loop.
      if (parent) Mat4.mul(parent, local, n.world);
    }
  }

  // A joint matrix transforms a vertex from mesh space to the current joint
  // pose: inverse(meshWorld) × jointWorld × inverseBind. Keeping these on the
  // scene node makes animation and rendering independent of a particular GPU
  // backend, and is also useful to a CPU renderer or an exporter.
  const inverseMesh = Mat4.create();
  const jointPose = Mat4.create();
  const jointMatrix = Mat4.create();
  for (const n of scene.nodes) {
    const skin = n.skin;
    if (!skin) continue;
    const count = skin.joints.length;
    if (skin.inverseBindMatrices.length < count * 16) {
      throw new Error(`Skin3D needs ${count} inverse bind matrices.`);
    }
    if (!skin.matrices || skin.matrices.length !== count * 16) {
      skin.matrices = new Float32Array(count * 16);
    }
    const meshInverse = n.world && Mat4.invert(n.world, inverseMesh);
    for (let i = 0; i < count; i++) {
      const joint = scene.nodes[skin.joints[i]];
      const destination = skin.matrices.subarray(i * 16, i * 16 + 16);
      if (!joint?.world || !meshInverse) {
        Mat4.identity(destination);
        continue;
      }
      const bind = skin.inverseBindMatrices.subarray(i * 16, i * 16 + 16);
      Mat4.mul(joint.world, bind, jointPose);
      Mat4.mul(meshInverse, jointPose, jointMatrix);
      destination.set(jointMatrix);
    }
  }
}

/** True when the node, or anything it hangs off, is hidden. Visibility is
 *  inherited even though `hidden` itself is not — hiding a limb hides the hand
 *  on it, which is the only useful reading. */
export function isVisible(scene: Scene3D, index: number): boolean {
  let at: number | undefined = index;
  while (at !== undefined) {
    const n: Node3D = scene.nodes[at];
    if (n.hidden) return false;
    at = n.parent;
  }
  return true;
}
