/** A particle emitter that draws as one ordinary mesh.
 *
 *  There is no particle STAGE in either backend and this deliberately does not
 *  add one. An emitter owns a `MeshData` sized for its capacity, rewrites the
 *  vertices every `update`, and bumps `MeshData.version` so the backend
 *  re-uploads. Put that mesh on a `Node3D` with a transparent material and it
 *  draws like anything else — same lighting opt-out, same sorting, same
 *  culling, both backends, no new shader.
 *
 *  The trade is one draw call per EMITTER rather than per particle, which is
 *  the number that matters: a scene with a hundred emitters of thirty
 *  particles each is a hundred draws, not three thousand. Instancing would beat
 *  it, but only once the per-emitter count is much larger than these, and it
 *  would cost a shader permutation in each backend to find out.
 *
 *  ## Space
 *
 *  Particles live in the emitter node's LOCAL space, so moving or turning the
 *  node carries them with it. That means billboarding needs the camera in that
 *  space too, which is what `update`'s `view` argument is — use `localViewer`
 *  to work it out from the node's world matrix.
 *
 *  ## Capacity
 *
 *  Fixed, and allocated once. Particles beyond it are not emitted rather than
 *  replacing a live one, and the unused tail of the mesh is collapsed to a
 *  degenerate quad at the origin. A fixed length is what keeps a version bump
 *  a rewrite rather than a reallocation.
 */
import { Mat4 } from "../math/mat4.js";
import type { MeshData } from "./mesh.js";
/** A scalar that may be a constant or a range picked per particle. */
export type Range = number | readonly [number, number];
/** How a particle's quad is turned to face the world. */
export type BillboardMode = 
/** Square-on to the camera, spun about the view axis by nothing. */
"billboard"
/** Stretched along its own velocity and rolled to face the camera about
 *  that axis — a streak, a spark, a rain line. A particle that is not
 *  moving has no axis to stretch along and falls back to `billboard`.
 *
 *  The stretch runs along the sprite's U axis and the quad's head sits on
 *  the particle with the tail behind it, which is what a streak texture is
 *  drawn for. `lengthScale` multiplies `size.y` to get that length, and
 *  `size.x` becomes the thickness. */
 | "stretched"
/** Flat in the XZ plane, facing straight up. For something that reads as
 *  lying ON the ground: a scorch, a ripple, a shadow puddle. */
 | "horizontal"
/** Upright: turns to face the camera about the Y axis and no further, so its
 *  top stays the world's top however far the camera looks down. For anything
 *  that stands IN the scene — smoke, a flame, a dust column. A plain
 *  `billboard` seen from above lies over towards the camera and stops
 *  reading as standing up. */
 | "vertical";
/** A billboard orientation, or authored geometry copied once per particle. */
export type ParticleRenderMode = BillboardMode | "mesh";
/** One scheduled emission inside an emitter cycle. */
export interface ParticleBurst {
    /** Seconds from the beginning of the cycle. Default 0. */
    time?: number;
    /** Particles emitted at once, sampled when the burst fires. */
    count: Range;
    /** Repetitions inside the same cycle. Default 1. */
    cycles?: number;
    /** Seconds between repetitions. Default 0. */
    interval?: number;
    /** Chance that each repetition fires, 0..1. Default 1. */
    probability?: number;
}
export interface SpriteSheet {
    /** Frames across and down the texture. */
    columns: number;
    rows: number;
    /** How many times to run the sheet over one particle's life. Default 1. */
    cycles?: number;
    /** Which frame to show, given how far through its life a particle is
     *  (0..1). Return a frame index, fractional or not — it is floored. The
     *  default runs the whole sheet linearly, which is what a flipbook wants;
     *  pass one to hold, ease, or play a subset. */
    frameOverTime?: (t: number) => number;
}
export interface EmitterOptions {
    /** Particles per second. */
    rate: number;
    /** Seconds a particle lives. */
    lifetime: Range;
    /** Units per second along `direction` at birth. */
    speed?: Range;
    /** Full extents of the box particles are born inside, centred on the node.
     *  Omitted — and with no `circle` either — they are all born at the origin. */
    box?: {
        x: number;
        y: number;
        z: number;
    };
    /** Births each particle somewhere on a disc in the shape's local XY plane
     *  and sends it straight out along its OWN radius, so the launch direction
     *  differs per particle and `direction` says nothing. A splash, a shockwave
     *  ring, an impact burst: the fan is the whole effect, and a shape that can
     *  only agree on one direction turns it into a jet.
     *
     *  This is Cocos' `ShapeModule` Circle, read off the engine rather than
     *  guessed (`cc.13039.js:52200-52206`, with `LH` at `:51042`): the angle is
     *  uniform in `[0, arc)`, the distance from the centre is uniform in
     *  `[radius * (1 - radiusThickness), radius]` — uniform in the RADIUS, not
     *  in area, so a filled disc is denser towards its middle than a scatter of
     *  points would be, and reproducing that is the difference between a puff
     *  with a hot core and one with a hollow one — and then
     *  `velocity = normalize(position)` scaled by `speed`. A particle born
     *  exactly at the centre gets no direction at all and stays put, which is
     *  what Cocos' `Vec3.normalize` does with a zero vector.
     *
     *  `shapeRotation` turns the disc AND every launch direction with it, which
     *  is how an authored ring gets laid flat in XZ by a quarter turn about X.
     *  `offset` moves it off the node origin.
     *
     *  A shape is one shape: `_shapeType` is a single value, and where both are
     *  passed the circle is what gets emitted and `box` and `direction` are
     *  ignored. */
    circle?: {
        /** Distance from the centre to the rim, after any scale is folded in. */
        radius: number;
        /** How much of the disc is filled inwards from the rim: 0 births every
         *  particle exactly on the rim, 1 fills it to the centre. Cocos' default,
         *  and this one, is 1. */
        radiusThickness?: number;
        /** How much of the turn is used, in RADIANS, measured from +X towards +Y.
         *  Default is a full turn. */
        arc?: number;
    };
    /** Offset of the emission shape from the node origin. */
    offset?: {
        x: number;
        y: number;
        z: number;
    };
    /** Euler rotation of the emission shape, in radians. It turns both box
     * positions and the launch direction. */
    shapeRotation?: {
        x: number;
        y: number;
        z: number;
    };
    /** Which way particles set off, in local space, normalized on the way in.
     *  Default is +Z. Other engines' box emitters do not agree on the sign —
     *  Cocos', for one, sets off down −Z — so an emitter ported from authored
     *  data should pass this rather than rely on the default.
     *
     *  One direction for the whole emitter, so a `circle` overrides it entirely
     *  rather than combining with it. */
    direction?: {
        x: number;
        y: number;
        z: number;
    };
    /** Particle size, sampled once at birth. `z` is used by mesh particles and
     * defaults to `x`; billboards use x/y. */
    size: {
        x: Range;
        y: Range;
        z?: Range;
    };
    /** How the authored size is scaled as a particle ages, given how far through
     *  its life it is (0..1).
     *
     *  Multiplies `size`, so the authored value stays the particle's full size
     *  and this is the shape of the pop, the swell or the fade-out around it —
     *  which is how every authoring tool stores it, and why the two are separate
     *  here rather than one curve of absolute sizes.
     *
     *  Writes into `out` rather than returning, because it is called for every
     *  live particle every frame and an allocation there is the whole cost. Per
     *  axis: a burst that stretches as it rises is one curve on `y` and another
     *  on `x`, and a uniform one writes the same number three times. `z` is used
     *  by mesh particles alone.
     *
     *  Sampled fresh each frame rather than at birth — that is the difference
     *  between this and `size` — so the curve plays out across the life. */
    sizeOverTime?: (t: number, out: {
        x: number;
        y: number;
        z: number;
    }) => void;
    /** Multiplied into the material's own colour, per vertex. */
    color?: readonly [number, number, number, number];
    /** How `color` is scaled as a particle ages, given how far through its life
     *  it is (0..1).
     *
     *  `sizeOverTime`'s counterpart, and the same bargain: a MULTIPLIER, so
     *  `color` stays the particle's full colour and this is the fade, the cool-off
     *  or the flash around it — which is how every authoring tool stores a
     *  colour-over-lifetime, as a gradient laid over the start colour.
     *
     *  Alpha is the channel that usually carries the effect. A spark that holds
     *  full opacity to the frame it vanishes reads as a bead; the same spark
     *  fading to a tenth over its life reads as a flash. On a material with
     *  `additive` set that fade is the only thing dimming it, because both
     *  backends premultiply at the render boundary — so an alpha curve really is
     *  a brightness curve there.
     *
     *  Writes into `out` rather than returning, for `sizeOverTime`'s reason: this
     *  runs for every live particle every frame and an allocation there is the
     *  whole cost. Sampled fresh each frame, so the curve plays out across the
     *  life; a particle's own vertex colours are only rewritten when a curve was
     *  passed, so an emitter without one costs nothing. */
    colorOverTime?: (t: number, out: {
        r: number;
        g: number;
        b: number;
        a: number;
    }) => void;
    /** Units per second squared, downward. */
    gravity?: number;
    mode?: ParticleRenderMode;
    /** Geometry copied for every particle in `"mesh"` mode. The source stays
     * untouched; the emitter owns one fixed-capacity dynamic batch. */
    mesh?: MeshData;
    /** Turn an authored MESH to face the camera, about world up.
     *
     *  For `mode: "mesh"` only, and it REPLACES the birth yaw rather than adding
     *  to it: a mesh that faces the viewer has no use for an authored heading,
     *  and composing the two would make it face the camera from a random offset.
     *  Pitch and roll are left alone, so a model authored leaning keeps its lean.
     *
     *  A yaw and not a full look-at, deliberately. These are objects standing in
     *  a world with a ground plane — a question mark, a heart — and tipping one
     *  back to square up with a high camera reads as the model falling over. */
    faceCamera?: boolean;
    /** Initial Euler rotation, sampled at birth, in radians.
     *
     *  All three axes turn an authored MESH. For a billboard only `z` means
     *  anything, and it is the roll about the view axis — the same thing the
     *  engines that ship this call a particle's rotation, since a camera-facing
     *  quad has no other axis to turn about that shows. */
    rotation?: {
        x?: Range;
        y?: Range;
        z?: Range;
    };
    /** Authored-mesh radians per second about each local axis. */
    angularVelocity?: {
        x?: Range;
        y?: Range;
        z?: Range;
    };
    /** For `"stretched"`: how many times `size.y` is stretched along the
     *  velocity. The trail's length is `size.y * lengthScale` and its thickness
     *  is `size.x`. */
    lengthScale?: number;
    sheet?: SpriteSheet;
    /** Length of one emission cycle in seconds. Needed when bursts loop. */
    duration?: number;
    /** Repeat `duration` and its bursts. Default true. */
    loop?: boolean;
    /** Scheduled emissions in addition to `rate`. */
    bursts?: readonly ParticleBurst[];
    /** The most particles alive at once. Defaults to what `rate` and the longest
     *  `lifetime` imply, plus a little slack. */
    capacity?: number;
    /** Where randomness comes from, so a test can make an emitter repeatable.
     *  Defaults to `Math.random`. */
    random?: () => number;
}
export interface Emitter {
    /** The mesh to hang on a node. Its identity never changes. */
    readonly mesh: MeshData;
    /** Step the simulation and rebuild the mesh.
     *
     *  `view` is the camera position in the emitter node's LOCAL space — see
     *  `localViewer`. It only affects which way the quads face, so an emitter
     *  updated with a stale one simulates correctly and looks wrong, rather than
     *  the other way round. */
    update(dtSeconds: number, view: {
        x: number;
        y: number;
        z: number;
    }): void;
    /** Kill every particle and empty the mesh. */
    reset(): void;
    /** Stop emitting new particles. Live ones still run out their lives. */
    pause(): void;
    /** Emit again. */
    resume(): void;
    /** How many particles are alive, for tests and debug readouts. */
    readonly alive: number;
}
/** Where the camera is in a node's local space.
 *
 *  Billboarding has to happen in the space the particles are simulated in, and
 *  a node under a rotated or scaled parent is not in world space. Pass the
 *  node's `world` matrix — `updateWorldMatrices` fills it — and the camera's
 *  world position. A matrix that cannot be inverted (a zero scale somewhere up
 *  the chain) gives the camera position back unchanged, which is wrong but
 *  finite; the node is not being drawn at a sane size anyway. */
export declare function localViewer(world: Mat4 | undefined, camera: {
    x: number;
    y: number;
    z: number;
}, out?: {
    x: number;
    y: number;
    z: number;
}): {
    x: number;
    y: number;
    z: number;
};
export declare function createEmitter(opts: EmitterOptions): Emitter;
