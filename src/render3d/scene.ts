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
  /** Nearest-neighbour texture sampling — the pixel-art default the rest of
   *  the engine assumes. Set false for a photographic texture. */
  pixelated?: boolean;
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

/** Everything a `Renderer3D` needs to draw a frame. */
export interface Scene3D {
  /** Nodes in dependency order — every parent before its children. */
  nodes: Node3D[];
  /** Directional lights. An empty list plus zero ambient renders black, which
   *  is a surprisingly common first-run mistake; `createScene` seeds one. */
  lights: DirectionalLight[];
  /** Uniform fill light as `[r, g, b]`, keeping shadowed faces readable. */
  ambient: readonly [number, number, number];
  /** Background as `[r, g, b, a]`. An alpha below 1 lets whatever is behind
   *  the 3D viewport show through — which is how a model sits on a UI panel
   *  without a box of sky around it. */
  background: readonly [number, number, number, number];
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
