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
import type { RenderTarget3D } from "./renderer.js";
import type { Vec3 } from "@src/math/vec3.js";

/** How a surface responds to light. Deliberately small: a colour, an optional
 *  texture, and the two switches that change how a mesh reads at a glance. A
 *  general material/shader API is a much larger design question and is not
 *  this. */
export interface Material {
  /** Base colour as `[r, g, b, a]`, each 0..1. Multiplied with the texture and
   *  with any per-vertex colours. */
  color?: readonly [number, number, number, number];
  /** Colour multiplied into the sampled texture before `textureBlend`.
   *  This lets a grayscale mask have its own tint while `color` remains the
   *  surface's base colour. Defaults to white. */
  textureColor?: readonly [number, number, number, number];
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
  /** Add this surface to what is behind it instead of blending over it.
   *  Needs `transparent`, which is what puts the surface in the blended pass
   *  at all.
   *
   *  This is the mode light comes in: fire, sparks, a glow, a dust mote lit
   *  from behind, a wind streak over a bright floor. Alpha blending REPLACES
   *  what is behind the surface in proportion to its alpha, so a white card at
   *  0.6 over a coloured floor is a grey-white patch — the card reads as an
   *  object stuck to the screen. Adding it instead brightens what is already
   *  there and leaves the floor's own colour showing through, which is what a
   *  streak of light does.
   *
   *  It also makes the draw order stop mattering: addition commutes, so two
   *  additive surfaces give the same picture either way round, where two
   *  alpha-blended ones do not. They are still drawn in the blended pass, and
   *  still sorted with it — no reason to split a second pass for a property
   *  that does not need one. */
  additive?: boolean;
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
  /** Put this node's shape into the depth buffer the overlay pass tests
   *  against, so it hides the overlays that asked to be hidden.
   *
   *  "Behind the ball, in front of the course" is not a picture the overlay
   *  pass can produce on its own: an overlay skips the depth test entirely, so
   *  it is either over everything or over nothing. This pair of flags gives it
   *  a depth buffer with only the NOMINATED objects in it. After the scene is
   *  drawn, the depth buffer is cleared, every node carrying this flag is
   *  re-drawn for its shape alone with colour writes off, and each
   *  `overlayOccluded` overlay tests against that instead of ignoring depth.
   *
   *  Two consequences to know before reaching for it. The occluder hides an
   *  overlay by its GEOMETRY rather than by its visible pixels — the course is
   *  not in that buffer, so an occluder that is itself behind a hill still cuts
   *  the overlay out; pair it with `occludedAlpha` and the cut-out reads as the
   *  ghost, which is the honest picture. And the frame's depth buffer ends up
   *  holding the prepass, so a scene that renders a second pass over the first
   *  with `clear: false` and expects to depth-test against it cannot also gate
   *  overlays.
   *
   *  Ignored on a `depthTest: false` material — an overlay has no depth of its
   *  own worth testing against. Costs one extra draw call per flagged node, and
   *  only in a frame that also contains an `overlayOccluded` overlay: with
   *  either half of the pair missing there is nothing to occlude or nothing to
   *  occlude with, and the pass runs exactly as it did before. */
  occludesOverlays?: boolean;
  /** Let `occludesOverlays` nodes hide this overlay, instead of drawing over
   *  everything unconditionally.
   *
   *  Only meaningful with `depthTest: false`, since that is what puts a surface
   *  in the overlay pass at all. It is opt-in per overlay because the two kinds
   *  usually coexist: an aiming guide wants to disappear behind the ball it is
   *  aimed from, while the readout naming the club must stay legible whatever
   *  is in front of it.
   *
   *  Such an overlay does not write depth, so it cannot occlude the next
   *  overlay in turn — the buffer belongs to the nominated occluders for the
   *  whole pass, and an overlay writing into it would become a second occluder
   *  nobody asked for. Overlays still paint in node order, as before. */
  overlayOccluded?: boolean;
  /** Also draw this surface where something is IN FRONT of it, at this
   *  fraction of its alpha. 0 or unset draws it only where it is visible,
   *  which is the ordinary behaviour.
   *
   *  The difference from `depthTest: false` is which of the two pictures wins.
   *  An overlay ignores the scene's depth and is drawn over everything, so it
   *  stops reading as an object in the world at all. This keeps the ordinary
   *  pass exactly as it was — solid where the surface is genuinely visible —
   *  and adds a second, ghost pass over the part a wall or a hill is covering.
   *  The result reads as "the thing is behind that", which is the information
   *  the player wants, rather than as "the thing is in front of that", which
   *  is a lie.
   *
   *  For anything the player is tracking and can lose: the ball in a game
   *  whose camera the terrain gets in front of, a unit behind a building, a
   *  waypoint marker that should still say how far away it is. Around 0.25 is
   *  a hint; much above 0.5 and the ghost competes with the real one.
   *
   *  Implemented as a second draw with the depth test REVERSED and depth
   *  writes off — not with the test switched off, which would paint the whole
   *  surface over the scene and lose the cue entirely. It costs one extra draw
   *  call per node that asks for it. */
  occludedAlpha?: number;
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
   *  The basis comes from the mesh's `tangents` when it has them, and is
   *  otherwise rebuilt per pixel from screen-space derivatives of the position
   *  and uv — a few ALU ops, no attribute, and it cannot disagree with the uvs
   *  the mesh actually ships. See `MeshData.tangents` for when the derived one
   *  is not good enough. Either way it needs real uvs: a mesh without them
   *  gets a degenerate basis, so the map is ignored. */
  normalMap?: TexImageSource;
  /** Bump when the normal map's PIXELS change, as with `textureVersion`. */
  normalMapVersion?: number;
  /** How far the normal map tilts the surface, 0..1+ where 1 is the map's own
   *  strength and 0 is flat. Default 1. */
  normalScale?: number;
  /** A pattern blended over the base colour in Photoshop's OVERLAY mode, at
   *  `detailStrength`. Sampled with `detailUv` and the material's own
   *  `pixelated`/`repeat` settings; `uvScale`/`uvOffset` do NOT apply, because
   *  a detail unwrap is already authored at the density it wants.
   *
   *  Overlay, not multiply: the point of a detail map is to add relief without
   *  changing what colour the surface IS. Multiplying a pattern in can only
   *  darken, so a tiled overlay reads as dirt and the artist compensates by
   *  brightening the base colour until the two only agree at one strength.
   *  Overlay pivots around mid-grey — lighter than half lifts, darker drops,
   *  exactly half does nothing — so the surface keeps its own value at any
   *  strength and the map is free to be an unbiased pattern.
   *
   *  The OVERLAY blend happens in DISPLAY space, before any linearization:
   *  overlay's 0.5 pivot is a perceptual midpoint, and run against linear
   *  light it pivots around a value most of a stop darker than the one the
   *  pattern was painted against. `over` is the other way round — it is an
   *  alpha composite of one light against another, so under
   *  `toneMapping: "aces"` it runs in linear and comes back. Mixing the same
   *  weight in display space instead lands about twice as far from the base
   *  once the surface is squared, which is a real error rather than a taste:
   *  a 6% wash reads as 11%. */
  detailMap?: TexImageSource;
  /** Bump when the detail map's PIXELS change, as with `textureVersion`. */
  detailMapVersion?: number;
  /** The secondary map already has its alpha multiplied into its RGB.
   *
   *  Every other texture here is straight-alpha, which is what an image decoder
   *  and a 2D canvas both hand over. A render target is the exception: anything
   *  drawn into one through an additive or source-over blend accumulates
   *  `colour * alpha`, so its RGB is premultiplied and a straight-alpha read of
   *  it is `1/alpha` too bright. That error is worst exactly where alpha is
   *  lowest, so a soft-edged decal does not merely glow — it grows a bright
   *  fringe and reads as fatter than it is.
   *
   *  Set this when the decal is a render target, or an emulation of one.
   *  `over` only; the overlay blend never looks at alpha. */
  detailPremultiplied?: boolean;
  /** How much of the overlay to mix in, 0..1. Default 0, which is off — a
   *  detail map with no strength costs a sample and changes nothing. */
  detailStrength?: number;
  /** How the secondary map combines with the surface. `overlay` is the
   * contrast-preserving detail default; `over` uses the map's alpha to paint
   * its RGB over the base, which is useful for a live decal canvas. */
  detailBlend?: "overlay" | "over";
  /** RGB multiplier for an alpha-over secondary map. Default 1. Kept separate
   * from `detailStrength`, which weights the map's alpha rather than its light. */
  detailColorScale?: number;
  /** Let an `over` secondary map composite into the surface's OPACITY as well
   *  as its colour, at the same weight: `a = mix(a, map.a, map.a * strength)`.
   *  Default off, which leaves `transparent` meaning exactly what it meant.
   *
   *  Off, a decal can only paint a surface that is already there. On, the
   *  decal is what makes the surface be there at all — a material whose base
   *  colour is fully transparent shows up only where the map has ink on it,
   *  and fades back out as the ink does. That is a real authoring idiom and
   *  not an edge case: an invisible floor that a live canvas reveals cannot be
   *  expressed any other way, because the reveal has to be per fragment.
   *
   *  Needs `transparent`; without it the surface is in the opaque pass and the
   *  alpha it computes is written to a channel nothing reads. Ignored by the
   *  `overlay` blend, which never looks at alpha at all. */
  detailOpacity?: boolean;
  /** Which uv set the detail map reads: 0 (the default) is the mesh's `uvs`,
   *  1 is its `uvs1`. A mesh with no `uvs1` gets zeros, which samples one
   *  texel of the map across the whole surface. */
  detailUv?: 0 | 1;
  /** Generate the secondary map's uvs from the world position instead of from
   * the mesh. Deliberately independent of `uvProjection`, so a projected decal
   * does not disturb an albedo or normal map's authored unwrap.
   *
   * `planarXZ` drops the world position down the Y axis — one continuous
   * pattern across a whole floor, smeared on anything vertical. `triplanar`
   * pays for two more samples and has no smear: it projects onto all three
   * world planes and blends them by the face's own normal raised to the
   * eighth, so a shape covered in it reads at ONE density whichever way each
   * face points, with a blend band a few degrees wide rather than a quadrant.
   *
   * Reach for `triplanar` when the surface has no usable unwrap for the
   * pattern — which is the common case for level geometry, where the second uv
   * set is a packed atlas and its density varies by an order of magnitude
   * between islands. A pattern laid on that reads as different sizes on
   * different faces of one wall, and no single `detailUvScale` fixes it.
   *
   * The mask still reads the MESH uv under `triplanar`, since a mask is a
   * planar-projection idea and nothing pairs the two. */
  detailUvProjection?: "mesh" | "planarXZ" | "triplanar";
  /** Secondary-map uv scale, in TILES PER UNIT of whatever the projection
   * reads — so a larger number is a smaller pattern, and the world size of one
   * tile is its reciprocal. With no value, uv0 inherits `uvScale`, while uv1
   * and either projection use `[1, 1]`.
   *
   * Under `triplanar` it is a HORIZONTAL/VERTICAL pair rather than a per-plane
   * pair: `x` scales both axes of the ground plane and the horizontal axis of
   * the two upright ones, `y` scales only their vertical axis. A pattern with
   * a distinct vertical rhythm — a slime run, a tide line, brickwork — is the
   * ordinary case for a wall, and reading `y` as "the second axis of each
   * plane" instead stretched the ground plane by the ratio of the two and made
   * a wall's top cap read at a different size from its sides. */
  detailUvScale?: readonly [number, number];
  /** Secondary-map uv offset. With no value, uv0 inherits `uvOffset`, while
   * uv1 and either projection use `[0, 0]`. */
  detailUvOffset?: readonly [number, number];
  /** Snap the world position to a grid of this many units before a PROJECTED
   * secondary map samples it — `ceil(p / step) * step`, componentwise.
   *
   * A projection reads a continuous position, so it magnifies a pattern
   * smoothly however crisp the sampler is: `pixelated` quantizes the texture's
   * own texels, and at any real tiling those are far finer than the blocks a
   * pixel-art surface wants. Quantizing the POSITION instead gives blocks of a
   * chosen world size, aligned to the world rather than to the mesh or to the
   * screen, and identical on every face a triplanar sample touches.
   *
   * Default 0, which is off. Ignored under `mesh`, which has no world position
   * to snap. The mask is unaffected — it reads the mesh uv. */
  detailWorldStep?: number;
  /** A second pattern that GATES the `over` secondary map, sampled from the
   *  same source uvs through `detailMaskUvScale`/`detailMaskUvOffset` — so it
   *  runs at its own frequency over the same projection rather than following
   *  the decal's.
   *
   *  Where the mask's alpha is under 0.01 the secondary map is off entirely;
   *  everywhere else the decal's RGB is multiplied by its own alpha, by the
   *  mask's RGB and by the mask's alpha before the mix. That is a live decal
   *  canvas cut into shapes: one canvas texel becomes whatever the mask draws
   *  inside it, at screen resolution rather than at the canvas's.
   *
   *  Sampled through the material's own `pixelated`/`repeat`, like everything
   *  else on it — one sampler serves the whole material. A mask tiles by
   *  definition, so it needs `repeat`; and it wants the same filter as the map
   *  it is cutting, which in practice it has, since a decal canvas crisp enough
   *  to be worth masking is a nearest one. Ignored by the `overlay` blend,
   *  which has no alpha to gate. */
  detailMask?: TexImageSource;
  /** Bump when the detail mask's PIXELS change, as with `textureVersion`. */
  detailMaskVersion?: number;
  /** Detail-mask uv scale, over the same source the secondary map reads.
   *  Zero — the default — means there is no mask: a mask scaled to zero would
   *  stretch one texel across the world, which is never what one is for. */
  detailMaskUvScale?: readonly [number, number];
  /** Detail-mask uv offset, applied after `detailMaskUvScale`. Default
   *  `[0, 0]`. */
  detailMaskUvOffset?: readonly [number, number];
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
   *  has to be unwrapped — the standard trick for ground. `sphere` maps the
   *  mesh's local surface position to equirectangular coordinates, which is
   *  useful for a pattern on a round object whose mesh UVs belong to another
   *  map. The planar seams show on vertical faces, while spherical mapping has
   *  the usual single seam at the back; that is why this is per-material rather
   *  than global.
   *
   *  This moves the ALBEDO map only. `normalMap` keeps the mesh's own uv
   *  whatever this says, because a tangent-space normal map is not a picture
   *  that can be laid anywhere: its vectors are expressed in the frame the
   *  unwrap builds, and the mesh's tangents go on describing that unwrap after
   *  the projection has replaced the uv it was read at. Re-projecting one
   *  makes its BUMP LAYOUT visible as if it were albedo — the tell is a
   *  lilac-blue sheet's plate-and-strip pattern showing through a surface it
   *  was never meant to draw on. */
  uvProjection?: "mesh" | "planarXZ" | "sphere";
  /** How `texture` combines with `color`.
   *
   *  `multiply` (the default) tints: the texture darkens the base colour and a
   *  transparent texel makes the surface transparent. `over` composites the
   *  texture on top using its own alpha, leaving the base colour showing
   *  through where the texture is clear — what a decal or line sheet painted
   *  over a solid colour needs. `mask` treats the texture as a grayscale mask:
   *  white leaves `color` alone and black replaces it with `textureColor`, so
   *  a mask tint cannot recolour the base surface. */
  textureBlend?: "multiply" | "over" | "mask";
  /** A glassy layer OVER the surface that answers to where the CAMERA is.
   *  Absent, or at zero strength, and not one term of it is computed. */
  glaze?: Glaze;
  /** A wash of colour laid on by ORIENTATION and HEIGHT — what has settled on
   *  the surface rather than what the surface is made of. Absent, or with
   *  nothing to lay on, and not one term of it is computed. */
  settle?: Settle;
}

/** A faked reflective coat: view-dependent light added on top of a surface
 *  that has already been shaded.
 *
 *  Nothing here is correct and none of it is trying to be. A correct reflection
 *  means rendering the scene again from the surface, and at that price the
 *  effect stops being worth having. What this buys instead is the one thing no
 *  amount of painting into a texture can buy: **the highlights move when the
 *  CAMERA moves, and hold still when it holds still.** That is the entire cue
 *  the eye reads as wet, polished or frozen, and it is why a baked sheen always
 *  reads as a pattern painted onto a surface however well it is painted — the
 *  pattern is nailed to the floor, and real reflections are nailed to the eye.
 *
 *  Four terms, cheapest first:
 *
 *  - **Fresnel.** The coat is weak where the surface faces you and strong at a
 *    grazing angle, which is what every dielectric does, and what makes a flat
 *    floor read as hard and wet towards its far edge. Seen from a low orbit
 *    this is most of the visible effect, and it is one `pow`.
 *  - **A faked sky**, looked up by the REFLECTED ray: a two-stop vertical
 *    gradient plus a tight lobe around the scene's own first light. The lobe is
 *    what sweeps as the camera turns — on a flat face the reflected ray's
 *    horizontal part swings a degree for every degree of orbit, so the glint
 *    crosses the surface while nothing in the scene has moved at all.
 *  - **`ripple`**, which tilts the normal a little before any of the above is
 *    looked up. This is what breaks the sky into moving glints instead of one
 *    smooth wash, and it is the term that makes a surface worth looking at
 *    while the camera is standing still.
 *  - **`parallax`**, the surface's OWN albedo re-sampled along the reflected
 *    ray. One fetch, of a texture already bound and already in cache, and it is
 *    the term that puts something UNDERNEATH the surface instead of on it.
 *    Without it, ice is a shiny floor.
 *  - **`streak`**, a diagonal drawn where the reflected ray lands, on the block
 *    grid `worldStep` sets. Arithmetic, not a map, and it is the answer to
 *    wanting a PATTERN in the highlight that is not also painted on the floor —
 *    see `Glaze.streak` for why a baked one always ends up in both.
 *
 *  **No new texture is sampled by any of this, and that is a deliberate
 *  choice rather than a saving.** The parallax re-reads the material's own
 *  `texture` and everything else is arithmetic, so this adds no binding, no
 *  upload path and no entry to the loader's sampler-choice chain. A term with
 *  a map of its own would need all three, and a material that reaches a
 *  sampler nothing bound does not fail loudly — it draws whatever the last
 *  draw happened to leave there.
 *
 *  Added AFTER lighting and BEFORE fog, because it is light. A distant glazed
 *  surface has to fade into the atmosphere with everything else; a coat added
 *  after the fog sits on top of the horizon glowing. */
export interface Glaze {
  /** Master weight, 0..1. At 0 — or with the whole object absent — the shader
   *  computes no term and takes no extra sample, which is what makes this safe
   *  to leave on a material that is only sometimes glazed. */
  strength: number;
  /** Colour of the faked sky, as `[r, g, b]`. Default white.
   *
   *  A cold near-white is ice or glass, a warm grey is polished stone, and the
   *  scene's own horizon colour is standing water. It tints the gradient AND
   *  the light lobe, so it is the colour of the whole reflection rather than a
   *  wash over part of it. */
  tint?: readonly [number, number, number];
  /** A CUBE PROBE of the scene for the coat to reflect, instead of the faked
   *  gradient — trashgolf's item 356, stage 2.
   *
   *  A `RenderTarget3D` holding six 90-degree faces of one point, laid out as a
   *  3x2 atlas in the order `+X -X +Y / -Y +Z -Z`. `cubeProbeViews` builds the six
   *  cameras and rectangles that fill it, and the shader's lookup is written
   *  against that same order — the two are one convention and changing either
   *  alone scrambles the reflection.
   *
   *  **What it replaces is the GRADIENT and nothing else.** `tint` still multiplies
   *  it, the light lobe, the sparkle and the streak are still added on top, and the
   *  Fresnel still decides how much of any of it is seen. So a probe makes the coat
   *  reflect the room it is in without changing how the coat behaves.
   *
   *  It costs one texture fetch per glazed pixel, and the SIX RENDERS that fill it
   *  are the caller's to spend — once when a level loads is what this is designed
   *  for, and is nearly free. Filling it every frame is a different feature with a
   *  different price.
   *
   *  Sampled with the target's own NEAREST filtering, so adjacent faces cannot
   *  bleed into each other and no inset is needed. */
  environment?: RenderTarget3D;
  /** A PLANAR reflection of the scene, sampled in SCREEN space — item 356 stage 3.
   *
   *  The scene rendered again from a camera mirrored about this surface's own
   *  plane, into a target the caller refills every frame. Where the cube probe
   *  answers "what does the room look like in this direction", this answers "what
   *  is directly behind this pixel in the mirror" — which is the difference between
   *  a surface that takes the room's colour and one that shows the ball, the props
   *  and the walls standing under themselves.
   *
   *  Sampled by the pixel's own projected position, so the target must hold the
   *  same view as the frame being drawn. It may be smaller: the sampler normalises,
   *  and half resolution is the usual trade.
   *
   *  **ALPHA is coverage.** Clear the mirrored render to a transparent background
   *  and the reflection falls back to `environment`, or to the faked sky, wherever
   *  no mirrored geometry stood. An opaque clear reflects the background colour
   *  over the whole surface instead.
   *
   *  It composites OVER `environment` and under everything else the coat adds, so a
   *  surface can carry both: the probe fills the sky and the far room, and this
   *  fills what is actually standing in front of the camera. */
  planar?: RenderTarget3D;
  /** Grazing-angle exponent. Default 4.
   *
   *  Lower spreads the coat over the whole surface and reads as haze on top of
   *  it; higher pins it to the silhouette and the far edge. Below about 2 a
   *  surface stops looking reflective and starts looking foggy, because a
   *  reflection you can see head-on is a reflection with no Fresnel in it. */
  fresnel?: number;
  /** How far the reflected ray drags the surface's own `texture` when it is
   *  re-sampled underneath, in the units the material's `uvProjection` reads —
   *  WORLD units under `planarXZ`, uv units under the mesh's own unwrap, the
   *  same convention `detailUvScale` uses. Default 0, which skips the extra
   *  fetch entirely.
   *
   *  A fake depth, not a raymarch: one offset, one sample, no iteration. It is
   *  convincing exactly as long as the offset stays small against the features
   *  in the texture. Push it and the surface reads as a second sliding copy of
   *  itself rather than as something seen through a few centimetres of ice.
   *
   *  **Forced to 0 on a material with no `texture`**, by `glazeParallax()`, and
   *  that guard is not a detail — see it for what the two backends would
   *  otherwise each draw. */
  parallax?: number;
  /** Animation phase for `ripple` and `sparkle`, in whatever unit the caller is
   *  counting. Default 0.
   *
   *  The renderer has no clock of its own and is not being given one here. A
   *  global time uniform would make every glazed surface in a scene share one
   *  phase, and — worse — it would make a rendered frame depend on WHEN it was
   *  rendered, which is the end of comparing two of them. Advancing this is a
   *  number the caller already has, and parking it is what makes a frame
   *  reproducible. */
  scroll?: number;
  /** Ripple frequency, in waves per world unit. Default 0.25 — one wave every
   *  four units, a slow swell rather than a chop. */
  scrollScale?: number;
  /** How far the ripple tilts the normal before the sky is looked up. Default
   *  0.08.
   *
   *  It perturbs the REFLECTION's normal only, never the surface's own lighting
   *  normal, so a rippled floor does not start self-shading in bands. Past
   *  about 0.3 the tilt can point the reflected ray below the horizon on a flat
   *  face and the coat starts to flicker. */
  ripple?: number;
  /** Glitter: a sparkle at a frequency far above the ripple, gated by the same
   *  light lobe so it appears where the light is rather than everywhere. 0..1,
   *  default 0.
   *
   *  Kept apart from `ripple` because the two say different things — the ripple
   *  is the SHAPE of the surface and the sparkle is the GRAIN in it. Frost,
   *  snow and crushed ice have a great deal of it; water and polished stone
   *  have none at all. */
  sparkle?: number;
  /** Snap the world position to a grid of this many units before `ripple`,
   *  `sparkle` and `streak` read it — `ceil(p / step) * step`, componentwise,
   *  exactly as `Material.detailWorldStep` does for a projected secondary map.
   *
   *  Default 0, which is off. It is what makes a coat read as PIXEL ART rather
   *  than as a smooth sheen, and it is not the same thing as `pixelated`: the
   *  ripple and the grain are computed per fragment from a continuous position,
   *  so no sampler filter reaches them. Quantizing the position gives blocks of
   *  a chosen world size, aligned to the world rather than to the mesh or to
   *  the screen.
   *
   *  **Quantized in SPACE, continuous in VALUE, and the distinction is the
   *  whole point.** The pattern lands in whole blocks, while `scroll` and the
   *  camera go on moving it smoothly — nothing about this snaps the phase, and
   *  a coat whose phase steps reads as a stutter rather than as pixel art. */
  worldStep?: number;
  /** A DIAGONAL added to the faked sky, and the one term of the coat that
   *  exists only where the camera puts it. 0..1, default 0.
   *
   *  A triangular ramp across `streakPeriod` world units of `x + z`, so it is
   *  an exact 45-degree staircase — one block across for one block down under
   *  `worldStep`, which is what keeps its steps the same size as the blocks it
   *  is drawn on and in phase with them. A diagonal at any other pitch beats
   *  against them at the difference frequency and reads as a bug.
   *
   *  **Why this is not a texture, and why it cannot be baked into one.** The
   *  obvious way to draw lines on ice is to paint them into the albedo, and
   *  `parallax` then re-samples that albedo along the reflected ray — so one
   *  canvas serves both the sliding highlight and the surface's own flat
   *  colour, the pattern appears TWICE, and the second copy lies motionless on
   *  the floor. That is what a baked diagonal actually looks like in play, and
   *  it is what this term exists to avoid: it is evaluated at the point the
   *  reflected ray lands on and added to the sky, so it slides as the camera
   *  orbits and there is nothing left of it in a still surface.
   *
   *  It samples the world's XZ plane, so it is a FLOOR idea — on a vertical
   *  face every pixel up one column shares an XZ position, which turns any such
   *  term into a vertical stripe with no variation along its length. Leave it
   *  at 0 on walls, the way `ripple` and `sparkle` are left at 0 on them. */
  streak?: number;
  /** How many world units between diagonals, and it should be a whole multiple
   *  of `worldStep` — otherwise the staircase's steps are not the blocks'.
   *  Default 0, which switches the streak off however much of it was asked for:
   *  a zero period is a division the shader cannot make. */
  streakPeriod?: number;
  /** How far the reflected ray drags the diagonal, in world units. Default 0 —
   *  at which the streak is a stripe painted on the world rather than a
   *  highlight, still and unmoving as the camera orbits.
   *
   *  This is `parallax`'s idea applied to an analytic pattern, and it is a
   *  separate number because `parallax` is forced to 0 on a material with no
   *  texture while the streak needs none. */
  streakDrag?: number;
}

/** A colour laid over a surface by which way it FACES and how high it SITS —
 *  snow on the tops of things, dust on ledges, moss climbing from the ground,
 *  a tide line, rust at a waterline.
 *
 *  Two independent keys, either of which may be off:
 *
 *  - **`up`** weights the wash by `dot(normal, +Y)`, so it collects on faces
 *    pointing at the sky and leaves vertical ones alone. That is the whole of
 *    "snow settles on the top": no geometry, no second unwrap, one dot product.
 *  - **`rise`** weights it by world height above `baseY`, strongest at the foot
 *    and gone by `baseY + rise`.
 *
 *  The PAIR matters more than either half. `up` alone frosts the tops of
 *  everything and leaves the uprights untouched, which reads as a lighting bug
 *  rather than as weather. `rise` alone paints a band round everything at one
 *  height, which reads as a flood. Together they describe a surface something
 *  has fallen ONTO and crept UP, and that is the difference between a scene
 *  that is cold and a scene with a cold filter over it.
 *
 *  This is ALBEDO — it changes what colour the surface IS, so it is applied
 *  before lighting and is lit like anything else. A snow cap that did not take
 *  the scene's own light would read as a sticker.
 *
 *  Alpha-over rather than overlay, and therefore in linear light under
 *  `toneMapping: "aces"`, for the reason `detailMap` sets out at length: what
 *  has settled on a surface HIDES the surface, it does not modulate it. */
export interface Settle {
  /** Colour of whatever has settled, as `[r, g, b]`. */
  color: readonly [number, number, number];
  /** How much collects on a face pointing straight up, 0..1. Default 0. */
  up?: number;
  /** How quickly the `up` wash gives out as a face tilts from the sky. Default
   *  4.
   *
   *  The exponent on `dot(normal, +Y)`: 1 is a broad smear reaching most of the
   *  way down a slope, 8 confines it to nearly-flat tops. The default sits
   *  where a ramp keeps a little and a wall keeps none, which is what settling
   *  looks like. */
  upSharpness?: number;
  /** World Y the `rise` climbs from — the ground line. Default 0. Everything
   *  BELOW it is covered at full `riseAmount`, which is what a ground line
   *  means. */
  baseY?: number;
  /** How far above `baseY` the rise reaches, in world units. Default 0, off. */
  rise?: number;
  /** How strong the rise is at `baseY` itself, 0..1. Default 0.
   *
   *  Kept apart from `up` so one surface can carry both at different weights,
   *  which is the ordinary case rather than an exotic one: a wall wants a
   *  strong foot and a weak cap, and the floor it stands on wants the cap term
   *  and no foot at all. */
  riseAmount?: number;
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

/** `Material.detailUvProjection` as the shaders see it: 0 mesh uv, 1 planar
 *  XZ, 2 triplanar. Resolved here rather than in each backend so WebGL2 and
 *  WebGPU cannot drift apart on what an unset value means. */
export function detailProjectionMode(material: Material): 0 | 1 | 2 {
  if (material.detailUvProjection === "planarXZ") return 1;
  if (material.detailUvProjection === "triplanar") return 2;
  return 0;
}

/** `Material.detailWorldStep` as the shaders see it: the grid the world
 *  position snaps to before a projected secondary map reads it, and 0 for off.
 *  Resolved here for the same reason as `detailProjectionMode` — and because a
 *  step under the mesh's own uv is meaningless, so the mode gates it in ONE
 *  place rather than in each backend's uniform block. */
export function detailWorldStep(material: Material): number {
  if (detailProjectionMode(material) === 0) return 0;
  const step = material.detailWorldStep ?? 0;
  return Number.isFinite(step) && step > 0 ? step : 0;
}

/** `Material.glaze`'s master weight as the shaders see it, and 0 for every way
 *  of not having one. Resolved here for the same reason as the two above: it is
 *  the single test both backends branch the whole coat on, and a backend that
 *  disagreed about what "off" means would draw a different frame. */
export function glazeStrength(material: Material): number {
  const strength = material.glaze?.strength ?? 0;
  return Number.isFinite(strength) && strength > 0 ? Math.min(strength, 1) : 0;
}

/** `Glaze.parallax` as the shaders see it — and **0 whenever the material has
 *  no `texture`**, which is the guard this function exists for.
 *
 *  The parallax term re-samples the material's OWN albedo. A material with no
 *  albedo has nothing to re-sample, and the two backends do not fail the same
 *  way when asked to anyway: WebGL2's sampler uniform sits at texture unit 0,
 *  so an unbound material reads whatever the PREVIOUS draw left bound there,
 *  while WebGPU falls to its 1x1 blank and reads white. Neither raises an
 *  error, neither looks like a bug in a screenshot, and the WebGL2 half changes
 *  with draw order — so it would come and go as the scene was re-sorted.
 *
 *  This is the shape of bug that once cost a whole course its detail blend by
 *  quietly handing a material a sampler nobody had configured. One test in one
 *  place is not enough for it; the resolution has to be somewhere neither
 *  backend can skip. */
export function glazeParallax(material: Material): number {
  if (!material.texture) return 0;
  const parallax = material.glaze?.parallax ?? 0;
  return Number.isFinite(parallax) ? parallax : 0;
}

/** `Glaze`'s pixel grid and its diagonal, packed as the one vec4 both shaders
 *  read: `[worldStep, streak, streakPeriod, streakDrag]`.
 *
 *  Packed and resolved here rather than in each backend for the reason
 *  `detailWorldStep` and `glazeParallax` are: these four are gated on each
 *  other, and a backend that read the gate differently would draw a different
 *  frame. Two gates, specifically —
 *
 *  - a `worldStep` that is not a positive finite number is off, because
 *    `ceil(p / step)` at zero is a division by zero and at a negative step
 *    snaps the wrong way;
 *  - a `streak` with no positive finite `streakPeriod` is off ENTIRELY, and
 *    that is the one worth stating: the shader divides `x + z` by the period,
 *    so an amount without a period is not a faint diagonal, it is a NaN across
 *    every pixel of the coat.
 *
 *  Returned rather than written, so the callers stay one `uniform4f` and one
 *  `drawData.set` and there is nowhere for the order of the four to drift. */
export function glazeGrid(material: Material): [number, number, number, number] {
  const glaze = material.glaze;
  const step = glaze?.worldStep ?? 0;
  const worldStep = Number.isFinite(step) && step > 0 ? step : 0;
  const asked = glaze?.streak ?? 0;
  const period = glaze?.streakPeriod ?? 0;
  const usable = Number.isFinite(period) && period > 0;
  const streak = usable && Number.isFinite(asked) && asked > 0 ? asked : 0;
  const drag = glaze?.streakDrag ?? 0;
  return [
    worldStep,
    streak,
    streak > 0 ? period : 0,
    streak > 0 && Number.isFinite(drag) ? drag : 0,
  ];
}

/** Whether `Material.settle` has anything to lay on: a wash with no `up` and no
 *  usable `rise` is an object that costs a normalize and changes nothing.
 *  Resolved here so both backends agree on which materials skip the branch. */
export function settleActive(material: Material): boolean {
  const settle = material.settle;
  if (!settle) return false;
  const up = settle.up ?? 0;
  const rise = settle.rise ?? 0;
  const riseAmount = settle.riseAmount ?? 0;
  return up > 0 || (rise > 0 && riseAmount > 0);
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

/** The material a node's `occludedAlpha` ghost pass draws with: the same
 *  surface, blended, at a fraction of the alpha it was authored with.
 *
 *  Both backends call this so the two agree on what the ghost looks like —
 *  which they have to, since a scene is expected to render the same either
 *  way. The alpha is scaled rather than replaced, so a surface that was
 *  already half transparent gives a fainter ghost than a solid one, and
 *  `transparent` is forced on because the ghost is blended whatever the node
 *  is. */
export function ghostMaterial(material: Material): Material {
  const color = material.color ?? [1, 1, 1, 1];
  const alpha = color[3] * (material.occludedAlpha ?? 0);
  return {
    ...material,
    transparent: true,
    occludedAlpha: 0,
    color: [...color.slice(0, 3), alpha] as [number, number, number, number],
  };
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
