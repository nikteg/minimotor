import { Mat4 } from "../math/mat4.js";
import { Quat } from "../math/quat.js";
import type { MeshData } from "./mesh.js";
import type { Vec3 } from "../math/vec3.js";
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
     *  has to be unwrapped — the standard trick for ground. The seams show on
     *  vertical faces, which is why it is per-material rather than global.
     *
     *  This moves the ALBEDO map only. `normalMap` keeps the mesh's own uv
     *  whatever this says, because a tangent-space normal map is not a picture
     *  that can be laid anywhere: its vectors are expressed in the frame the
     *  unwrap builds, and the mesh's tangents go on describing that unwrap after
     *  the projection has replaced the uv it was read at. Re-projecting one
     *  makes its BUMP LAYOUT visible as if it were albedo — the tell is a
     *  lilac-blue sheet's plate-and-strip pattern showing through a surface it
     *  was never meant to draw on. */
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
/** `Material.detailUvProjection` as the shaders see it: 0 mesh uv, 1 planar
 *  XZ, 2 triplanar. Resolved here rather than in each backend so WebGL2 and
 *  WebGPU cannot drift apart on what an unset value means. */
export declare function detailProjectionMode(material: Material): 0 | 1 | 2;
/** `Material.detailWorldStep` as the shaders see it: the grid the world
 *  position snaps to before a projected secondary map reads it, and 0 for off.
 *  Resolved here for the same reason as `detailProjectionMode` — and because a
 *  step under the mesh's own uv is meaningless, so the mode gates it in ONE
 *  place rather than in each backend's uniform block. */
export declare function detailWorldStep(material: Material): number;
/** The fog mode as the shaders see it. Resolved here rather than in each
 *  backend so WebGL2 and WebGPU cannot drift apart, and so the guards against
 *  a divide-by-zero live in one place. `params` means `(start, end, unused)`
 *  for linear, `(start, density, attenuation)` for the exponentials and
 *  `(height, range, attenuation)` for layered. */
export declare function fogUniform(fog: Fog3D): {
    mode: number;
    params: [number, number, number];
};
/** A node with sane defaults: identity transform, no mesh. Spread over it to
 *  set what you care about. */
export declare function node(init?: Partial<Node3D>): Node3D;
/** An empty scene lit well enough to see something immediately: one key light
 *  from over the viewer's shoulder, modest ambient, transparent background. */
export declare function createScene(init?: Partial<Scene3D>): Scene3D;
/** Append a node and return its index — the handle a child passes as `parent`
 *  and an animation track uses as its target.
 *
 *  Throws when the parent index is not already in the scene: that is the
 *  ordering invariant this file depends on, and a forward reference would
 *  otherwise show up as a mesh silently stuck at the origin. */
export declare function addNode(scene: Scene3D, n: Node3D): number;
/** Index of the first node with this name, or −1. */
export declare function findNode(scene: Scene3D, name: string): number;
/** Resolve every node's world matrix from its TRS and its parent chain — one
 *  forward pass, no recursion, which is only correct because parents precede
 *  children. Call once per frame after animating, before rendering. */
export declare function updateWorldMatrices(scene: Scene3D): void;
/** The material a node's `occludedAlpha` ghost pass draws with: the same
 *  surface, blended, at a fraction of the alpha it was authored with.
 *
 *  Both backends call this so the two agree on what the ghost looks like —
 *  which they have to, since a scene is expected to render the same either
 *  way. The alpha is scaled rather than replaced, so a surface that was
 *  already half transparent gives a fainter ghost than a solid one, and
 *  `transparent` is forced on because the ghost is blended whatever the node
 *  is. */
export declare function ghostMaterial(material: Material): Material;
/** True when the node, or anything it hangs off, is hidden. Visibility is
 *  inherited even though `hidden` itself is not — hiding a limb hides the hand
 *  on it, which is the only useful reading. */
export declare function isVisible(scene: Scene3D, index: number): boolean;
