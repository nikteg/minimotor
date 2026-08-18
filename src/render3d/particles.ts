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

import { Mat4 } from "@src/math/mat4.js";
import { Vec3 } from "@src/math/vec3.js";
import type { MeshData } from "./mesh.js";

/** A scalar that may be a constant or a range picked per particle. */
export type Range = number | readonly [number, number];

/** How a particle's quad is turned to face the world. */
export type BillboardMode =
  /** Square-on to the camera, spun about the view axis by nothing. */
  | "billboard"
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
  box?: { x: number; y: number; z: number };
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
  offset?: { x: number; y: number; z: number };
  /** Euler rotation of the emission shape, in radians. It turns both box
   * positions and the launch direction. */
  shapeRotation?: { x: number; y: number; z: number };
  /** Which way particles set off, in local space, normalized on the way in.
   *  Default is +Z. Other engines' box emitters do not agree on the sign —
   *  Cocos', for one, sets off down −Z — so an emitter ported from authored
   *  data should pass this rather than rely on the default.
   *
   *  One direction for the whole emitter, so a `circle` overrides it entirely
   *  rather than combining with it. */
  direction?: { x: number; y: number; z: number };
  /** Particle size, sampled once at birth. `z` is used by mesh particles and
   * defaults to `x`; billboards use x/y. */
  size: { x: Range; y: Range; z?: Range };
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
  sizeOverTime?: (t: number, out: { x: number; y: number; z: number }) => void;
  /** Multiplied into the material's own colour, per vertex. */
  color?: readonly [number, number, number, number];
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
  rotation?: { x?: Range; y?: Range; z?: Range };
  /** Authored-mesh radians per second about each local axis. */
  angularVelocity?: { x?: Range; y?: Range; z?: Range };
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
  update(dtSeconds: number, view: { x: number; y: number; z: number }): void;
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
export function localViewer(
  world: Mat4 | undefined,
  camera: { x: number; y: number; z: number },
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const inverse = world ? Mat4.invert(world, scratchMatrix) : null;
  if (!inverse) {
    out.x = camera.x;
    out.y = camera.y;
    out.z = camera.z;
    return out;
  }
  const m = inverse;
  const w = m[3] * camera.x + m[7] * camera.y + m[11] * camera.z + m[15] || 1;
  out.x = (m[0] * camera.x + m[4] * camera.y + m[8] * camera.z + m[12]) / w;
  out.y = (m[1] * camera.x + m[5] * camera.y + m[9] * camera.z + m[13]) / w;
  out.z = (m[2] * camera.x + m[6] * camera.y + m[10] * camera.z + m[14]) / w;
  return out;
}

const scratchMatrix = Mat4.create();

function pick(range: Range, random: () => number): number {
  return typeof range === "number" ? range : range[0] + (range[1] - range[0]) * random();
}

function highest(range: Range): number {
  return typeof range === "number" ? range : Math.max(range[0], range[1]);
}

export function createEmitter(opts: EmitterOptions): Emitter {
  const random = opts.random ?? Math.random;
  const lifetime = opts.lifetime;
  const speed = opts.speed ?? 0;
  const mode: ParticleRenderMode = opts.mode ?? "billboard";
  const source = mode === "mesh" ? opts.mesh : undefined;
  if (mode === "mesh" && (!source || source.positions.length === 0)) {
    throw new Error('A particle emitter in "mesh" mode needs a non-empty mesh.');
  }
  const sizeX = opts.size.x;
  const sizeY = opts.size.y;
  const sizeZ = opts.size.z ?? sizeX;
  const lengthScale = opts.lengthScale ?? 1;
  const gravity = opts.gravity ?? 0;
  const color = opts.color ?? [1, 1, 1, 1];
  const sheet = opts.sheet;
  const cycles = sheet?.cycles ?? 1;
  const frames = sheet ? Math.max(1, sheet.columns * sheet.rows) : 1;
  const bursts = opts.bursts ?? [];
  const duration = Math.max(0, opts.duration ?? 0);
  const looping = opts.loop ?? true;
  const burstPerCycle = bursts.reduce(
    (sum, burst) => sum + Math.ceil(highest(burst.count)) * Math.max(1, burst.cycles ?? 1),
    0,
  );
  const overlappingCycles =
    looping && duration > 0 ? Math.ceil(highest(lifetime) / duration) + 1 : 1;
  // One more than the steady state, because the particle emitted on the frame
  // the oldest one dies is briefly the (n+1)th.
  const capacity = Math.max(
    1,
    opts.capacity ??
      Math.ceil(opts.rate * highest(lifetime)) + burstPerCycle * overlappingCycles + 1,
  );

  const rotate = (
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    out: { x: number; y: number; z: number },
  ): void => {
    const sx = Math.sin(rx);
    const cx = Math.cos(rx);
    const sy = Math.sin(ry);
    const cy = Math.cos(ry);
    const sz = Math.sin(rz);
    const cz = Math.cos(rz);
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    out.x = x2 * cz - y1 * sz;
    out.y = x2 * sz + y1 * cz;
    out.z = z2;
  };

  const shapeRotation = opts.shapeRotation ?? { x: 0, y: 0, z: 0 };
  const offset = opts.offset ?? { x: 0, y: 0, z: 0 };
  const turned = { x: 0, y: 0, z: 0 };

  // Cocos' own defaults for the two that are usually left alone
  // (`cc.13039.js:52496-52526`): a solid disc through a full turn.
  const circle = opts.circle;
  const circleRadius = circle?.radius ?? 0;
  const circleInner = circleRadius * (1 - (circle?.radiusThickness ?? 1));
  const circleArc = circle?.arc ?? Math.PI * 2;

  const direction = { x: 0, y: 0, z: 1 };
  if (opts.direction) {
    const d = opts.direction;
    const length = Math.hypot(d.x, d.y, d.z);
    if (length > 0) {
      direction.x = d.x / length;
      direction.y = d.y / length;
      direction.z = d.z / length;
    }
  }
  rotate(
    direction.x,
    direction.y,
    direction.z,
    shapeRotation.x,
    shapeRotation.y,
    shapeRotation.z,
    turned,
  );
  direction.x = turned.x;
  direction.y = turned.y;
  direction.z = turned.z;

  // Struct-of-arrays, sized once. `age` is NaN for a slot that is free, which
  // is one test rather than a parallel liveness array.
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const vx = new Float32Array(capacity);
  const vy = new Float32Array(capacity);
  const vz = new Float32Array(capacity);
  const age = new Float32Array(capacity).fill(NaN);
  const life = new Float32Array(capacity);
  const scaleX = new Float32Array(capacity);
  const scaleY = new Float32Array(capacity);
  const scaleZ = new Float32Array(capacity);
  const rotationX = new Float32Array(capacity);
  const rotationY = new Float32Array(capacity);
  const rotationZ = new Float32Array(capacity);
  const angularX = new Float32Array(capacity);
  const angularY = new Float32Array(capacity);
  const angularZ = new Float32Array(capacity);

  const verticesPerParticle = source ? source.positions.length / 3 : 4;
  const sourceIndices = source?.indices ?? new Uint16Array([0, 1, 2, 0, 2, 3]);
  const indicesPerParticle = sourceIndices.length;
  const positions = new Float32Array(capacity * verticesPerParticle * 3);
  const uvs = new Float32Array(capacity * verticesPerParticle * 2);
  const colors = new Float32Array(capacity * verticesPerParticle * 4);
  const normals = new Float32Array(capacity * verticesPerParticle * 3);
  const indices =
    capacity * verticesPerParticle > 65535
      ? new Uint32Array(capacity * indicesPerParticle)
      : new Uint16Array(capacity * indicesPerParticle);
  for (let i = 0; i < capacity; i++) {
    const v = i * verticesPerParticle;
    const o = i * indicesPerParticle;
    for (let at = 0; at < indicesPerParticle; at++) indices[o + at] = v + sourceIndices[at];
    // Colours never vary per corner, so they are written once per particle at
    // birth rather than every frame.
    for (let vertex = 0; vertex < verticesPerParticle; vertex++) {
      const c = (v + vertex) * 4;
      const sourceColor = source?.colors;
      colors[c] = color[0] * (sourceColor?.[vertex * 4] ?? 1);
      colors[c + 1] = color[1] * (sourceColor?.[vertex * 4 + 1] ?? 1);
      colors[c + 2] = color[2] * (sourceColor?.[vertex * 4 + 2] ?? 1);
      colors[c + 3] = color[3] * (sourceColor?.[vertex * 4 + 3] ?? 1);
    }
  }

  const mesh: MeshData = { positions, normals, uvs, colors, indices, version: 0 };

  let pending = 0;
  let emitting = true;
  let alive = 0;
  let emissionTime = 0;
  let burstStarted = false;

  function spawn(): void {
    let slot = -1;
    for (let i = 0; i < capacity; i++) {
      if (Number.isNaN(age[i])) {
        slot = i;
        break;
      }
    }
    // Full. Dropping the particle rather than recycling the oldest keeps a
    // burst from cutting live ones short, which reads as flicker.
    if (slot < 0) return;
    let bx = 0;
    let by = 0;
    let bz = 0;
    // The distance the circle put the particle from its centre, which is also
    // what turns its position back into its outward direction below. Zero for
    // every other shape, and those use the emitter's one `direction` instead.
    let radial = 0;
    if (circle) {
      // Angle first, then distance. Cocos draws them in that order
      // (`generateArcAngle` is evaluated into the argument list before `LH`
      // lerps the radius), and a caller that passes a seeded `random` to
      // reproduce a burst gets a different disc if they are swapped.
      const angle = circleArc * random();
      radial = circleInner + (circleRadius - circleInner) * random();
      bx = Math.cos(angle) * radial;
      by = Math.sin(angle) * radial;
    } else if (opts.box) {
      bx = (random() - 0.5) * opts.box.x;
      by = (random() - 0.5) * opts.box.y;
      bz = (random() - 0.5) * opts.box.z;
    }
    rotate(bx, by, bz, shapeRotation.x, shapeRotation.y, shapeRotation.z, turned);
    px[slot] = turned.x + offset.x;
    py[slot] = turned.y + offset.y;
    pz[slot] = turned.z + offset.z;
    const launch = pick(speed, random);
    if (circle) {
      // `velocity = normalize(position) * speed`, with the shape rotation
      // applied to it exactly as it was to the position — Cocos rotates both
      // by the same quat at the end of `emit`. A Euler rotation preserves
      // length, so the already-rotated offset divided by the radius it was
      // born at IS the rotated unit radius: no second rotate, and no second
      // normalize to disagree with the first about the last bit.
      //
      // Dead centre there is no radius to point along and the particle does
      // not move, which is what Cocos' `Vec3.normalize` returns for a zero
      // vector, and it keeps `radius: 0` from writing NaN into the whole mesh.
      const outward = radial > 0 ? launch / radial : 0;
      vx[slot] = turned.x * outward;
      vy[slot] = turned.y * outward;
      vz[slot] = turned.z * outward;
    } else {
      vx[slot] = direction.x * launch;
      vy[slot] = direction.y * launch;
      vz[slot] = direction.z * launch;
    }
    age[slot] = 0;
    life[slot] = Math.max(1e-4, pick(lifetime, random));
    scaleX[slot] = pick(sizeX, random);
    scaleY[slot] = pick(sizeY, random);
    scaleZ[slot] = pick(sizeZ, random);
    rotationX[slot] = pick(opts.rotation?.x ?? 0, random);
    rotationY[slot] = pick(opts.rotation?.y ?? 0, random);
    rotationZ[slot] = pick(opts.rotation?.z ?? 0, random);
    angularX[slot] = pick(opts.angularVelocity?.x ?? 0, random);
    angularY[slot] = pick(opts.angularVelocity?.y ?? 0, random);
    angularZ[slot] = pick(opts.angularVelocity?.z ?? 0, random);
    alive++;
  }

  /** The slack the burst window is compared with, on BOTH ends. An emission
   *  time accumulated one frame at a time never lands exactly on a multiple of
   *  `duration`, so a cycle boundary has to be recognised from either side of
   *  it or the burst that starts the cycle is lost. */
  const BURST_EPSILON = 1e-9;

  function fireBursts(start: number, end: number, includeStart: boolean): void {
    if (bursts.length === 0) return;
    const firstCycle = looping && duration > 0 ? Math.max(0, Math.floor(start / duration)) : 0;
    // `end + BURST_EPSILON`, matching the test below, and NOT `end`. The two
    // used to disagree: a frame whose `end` fell a hair SHORT of the next
    // boundary never considered that cycle at all, and the following frame —
    // whose `start` is the same number — then rejected the event for being
    // within `BURST_EPSILON` of its start. The window belonged to neither
    // frame and the burst was dropped. With a regular timestep that repeats at
    // every boundary until accumulated float error drifts the other way, which
    // is minutes of a looping effect emitting nothing: MEASURED at a fixed
    // 1/60 on a `duration: 1.5`, `lifetime: 1.5`, one-particle-per-cycle
    // emitter, dark from 1.5 s to 9.0 s.
    const lastCycle =
      looping && duration > 0 ? Math.max(0, Math.floor((end + BURST_EPSILON) / duration)) : 0;
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      if (!looping && cycle > 0) break;
      const origin = looping && duration > 0 ? cycle * duration : 0;
      for (const burst of bursts) {
        const repetitions = Math.max(1, Math.floor(burst.cycles ?? 1));
        const interval = Math.max(0, burst.interval ?? 0);
        for (let repeat = 0; repeat < repetitions; repeat++) {
          const local = Math.max(0, burst.time ?? 0) + repeat * interval;
          if (duration > 0 && local > duration) continue;
          const event = origin + local;
          const afterStart = includeStart
            ? event >= start - BURST_EPSILON
            : event > start + BURST_EPSILON;
          if (!afterStart || event > end + BURST_EPSILON) continue;
          const probability = Math.max(0, Math.min(1, burst.probability ?? 1));
          if (probability <= 0 || (probability < 1 && random() > probability)) continue;
          const count = Math.max(0, Math.floor(pick(burst.count, random)));
          for (let n = 0; n < count; n++) spawn();
        }
      }
    }
  }

  const worldUp = { x: 0, y: 1, z: 0 };
  const worldRight = { x: 1, y: 0, z: 0 };
  /** `sizeOverTime`'s answer for the particle being written, reused across
   *  every particle of every frame. */
  const sizeScale = { x: 1, y: 1, z: 1 };
  const sizeOverTime = opts.sizeOverTime;
  /** Fill `sizeScale` for one particle, or leave it at 1 when nothing was
   *  passed. */
  function scaleAt(slot: number): void {
    if (!sizeOverTime) return;
    sizeScale.x = 1;
    sizeScale.y = 1;
    sizeScale.z = 1;
    const span = life[slot];
    sizeOverTime(span > 0 ? Math.min(1, age[slot] / span) : 0, sizeScale);
  }
  const right = { x: 0, y: 0, z: 0 };
  const up = { x: 0, y: 0, z: 0 };
  const toView = { x: 0, y: 0, z: 0 };
  const along = { x: 0, y: 0, z: 0 };

  function writeQuad(slot: number, index: number, view: { x: number; y: number; z: number }): void {
    const x = px[slot];
    const y = py[slot];
    const z = pz[slot];
    toView.x = view.x - x;
    toView.y = view.y - y;
    toView.z = view.z - z;
    const viewLength = Math.hypot(toView.x, toView.y, toView.z) || 1;
    toView.x /= viewLength;
    toView.y /= viewLength;
    toView.z /= viewLength;

    scaleAt(slot);
    let halfWidth = (scaleX[slot] * sizeScale.x) / 2;
    let halfHeight = (scaleY[slot] * sizeScale.y) / 2;
    // How far along `right` the quad's centre is pushed. Zero for every mode
    // but `stretched`, which anchors its head on the particle instead of
    // straddling it — see below.
    let shift = 0;
    /** Whether the sprite is laid down reversed along the stretch. */
    let flipU = false;

    if (mode === "horizontal") {
      right.x = 1;
      right.y = 0;
      right.z = 0;
      up.x = 0;
      up.y = 0;
      up.z = 1;
    } else if (mode === "vertical") {
      // Yaw only: the horizontal perpendicular to the view, and world up.
      // Taken per particle rather than from one camera basis, so a card close
      // to the camera turns to face IT rather than to face the way the camera
      // is pointing — the same thing at any distance, and better up close.
      //
      // `cross(worldUp, toView)`, the same axis and the same sign as the
      // `billboard` branch below — see the note there for what the mirrored
      // one costs. Here `up` is world up rather than derived, so the mirror
      // did not turn the quad over; it drew every sprite back to front.
      right.x = toView.z;
      right.y = 0;
      right.z = -toView.x;
      if (Math.hypot(right.x, right.z) < 1e-6) {
        // Directly above or below: no yaw resolves it, so pick one.
        right.x = 1;
        right.z = 0;
      }
      Vec3.normalize(right, right);
      up.x = 0;
      up.y = 1;
      up.z = 0;
    } else if (mode === "stretched" && Math.hypot(vx[slot], vy[slot], vz[slot]) > 1e-6) {
      const speedNow = Math.hypot(vx[slot], vy[slot], vz[slot]);
      along.x = vx[slot] / speedNow;
      along.y = vy[slot] / speedNow;
      along.z = vz[slot] / speedNow;
      // The stretch runs along the sprite's U axis, not its V — so `right` is
      // the velocity and `up` is the perpendicular, which is the opposite of
      // the other two modes.
      //
      // This is not a free choice. A streak texture is drawn the way a streak
      // is read, left to right along the image, so a sheet's frames are wide
      // and short; stretching down V instead would take a 128x16 line, squeeze
      // its length into the quad's width and smear its 16-pixel thickness over
      // the whole trail. It is also what the engines that ship this mode do.
      //
      // **u decreases with the velocity, and that is a correction.** This used
      // to read the other way — u increasing toward the head, on the reasoning
      // that a frame drawn left to right should point the way the particle is
      // going. Reported from play against the one consumer with a directional
      // stretched sheet: both the course fans and the wind power-up blew
      // visibly backwards while every heading in their data was correct, and
      // the stretch axis is the only thing those two share.
      //
      // Cocos stretches along the quad's V instead — `camUp = velocity *
      // velocityScale + normalize(velocity) * lengthScale * s.y` — so its
      // sprites are authored against a different axis AND a different sense
      // from the one this mode was written to. Stretching along U is still
      // right for the art (a 2x8 sheet's cells are wide and short, so U is the
      // line's own length); which END of U leads is what was wrong.
      flipU = true;
      right.x = along.x;
      right.y = along.y;
      right.z = along.z;
      Vec3.cross(along, toView, up);
      if (Math.hypot(up.x, up.y, up.z) < 1e-6) {
        // Flying straight at the camera: any perpendicular will do, and the
        // quad is edge-on enough that which one is not visible.
        const helper = Math.abs(along.y) < 0.9 ? worldUp : worldRight;
        Vec3.cross(along, helper, up);
      }
      Vec3.normalize(up, up);
      halfWidth = (scaleY[slot] * sizeScale.y * lengthScale) / 2;
      halfHeight = (scaleX[slot] * sizeScale.x) / 2;
      // A streak shows where a particle has BEEN, so its head sits ON the
      // particle and the tail runs back down the velocity. Centring it instead
      // draws half the trail in front of the thing making it.
      shift = -halfWidth;
    } else {
      // Square-on. Cross with world up first, so the quad's own up stays as
      // near vertical as the view allows rather than rolling with the camera.
      //
      // This IS `cross(worldUp, toView)` written out — `(0,1,0) x (tx,ty,tz)`
      // is `(tz, 0, -tx)` — and the sign is the whole of it. The mirrored
      // `(-tz, 0, tx)` points camera-LEFT, and because `up` is then derived
      // from it the quad came out turned a half circle about the view axis:
      // BOTH u and v reversed, which is a rotation and not a mirror, so it
      // reads as upside down rather than as back to front. Six of the seven
      // billboard sheets a consumer ships are radially symmetric — sparks,
      // snow, ring bursts — and a half turn is invisible on those, which is
      // why this stood for so long. It was found on a heart.
      right.x = toView.z;
      right.y = 0;
      right.z = -toView.x;
      if (Math.hypot(right.x, right.z) < 1e-6) {
        // Directly above or below: no yaw resolves it, so pick one.
        right.x = 1;
        right.z = 0;
      }
      Vec3.normalize(right, right);
      Vec3.cross(toView, right, up);
      Vec3.normalize(up, up);
      // **The authored ROLL, about the view axis.** `rotation.z` used to reach
      // authored-mesh particles only, so a billboard drawn from a sheet whose
      // art is not square-on came out flat however it was authored — a stroke
      // puff authored at 75 degrees drew at 0 and read as the wrong shape at
      // the wrong size, because a long sprite laid across the view is not the
      // same picture as one laid along it.
      //
      // Rolled by turning the basis rather than the corners, so the sheet, the
      // shift and the size all ride along with no second place to keep in step.
      const roll = rotationZ[slot];
      if (roll !== 0) {
        const cos = Math.cos(roll);
        const sin = Math.sin(roll);
        const rx = right.x * cos + up.x * sin;
        const ry = right.y * cos + up.y * sin;
        const rz = right.z * cos + up.z * sin;
        up.x = up.x * cos - right.x * sin;
        up.y = up.y * cos - right.y * sin;
        up.z = up.z * cos - right.z * sin;
        right.x = rx;
        right.y = ry;
        right.z = rz;
      }
    }

    let frame = 0;
    if (sheet) {
      const t = age[slot] / life[slot];
      const progress = sheet.frameOverTime ? sheet.frameOverTime(t) : t * cycles * frames;
      frame = Math.min(frames - 1, Math.max(0, Math.floor(progress) % frames));
    }
    const column = sheet ? frame % sheet.columns : 0;
    const row = sheet ? Math.floor(frame / sheet.columns) : 0;
    const uLow = sheet ? column / sheet.columns : 0;
    const uHigh = sheet ? (column + 1) / sheet.columns : 1;
    // A stretched quad lays its sprite down reversed along the streak — see
    // `flipU`. Swapped here rather than by negating `right`, which would take
    // the shift and the perpendicular with it and turn the quad over instead of
    // mirroring the image on it.
    const u0 = flipU ? uHigh : uLow;
    const u1 = flipU ? uLow : uHigh;
    // `v = 0` is the top of the texture here, as everywhere in this engine, so
    // the sheet reads left to right and top to bottom the way it is drawn.
    const v0 = sheet ? row / sheet.rows : 0;
    const v1 = sheet ? (row + 1) / sheet.rows : 1;

    const base = index * 4;
    const corners: readonly (readonly [number, number, number, number])[] = [
      [-halfWidth, halfHeight, u0, v0],
      [halfWidth, halfHeight, u1, v0],
      [halfWidth, -halfHeight, u1, v1],
      [-halfWidth, -halfHeight, u0, v1],
    ];
    for (let corner = 0; corner < 4; corner++) {
      const [across, along2, u, v] = corners[corner];
      const p = (base + corner) * 3;
      positions[p] = x + right.x * (across + shift) + up.x * along2;
      positions[p + 1] = y + right.y * (across + shift) + up.y * along2;
      positions[p + 2] = z + right.z * (across + shift) + up.z * along2;
      // Facing the camera, so an emitter drawn with a lit material is lit
      // evenly rather than going dark as it turns. Most callers use `unlit`.
      normals[p] = toView.x;
      normals[p + 1] = toView.y;
      normals[p + 2] = toView.z;
      const t = (base + corner) * 2;
      uvs[t] = u;
      uvs[t + 1] = v;
    }
  }

  function writeMesh(
    slot: number,
    index: number,
    view: { x: number; y: number; z: number },
  ): void {
    if (!source) return;
    scaleAt(slot);
    // The yaw that puts the model's front on the viewer, in place of the
    // authored one — see `faceCamera`. `toView` is this frame's particle-to-eye
    // vector, and `atan2(x, z)` is the turn about world up that aims +Z down
    // it, which is the same convention the rest of this engine reads a heading
    // in.
    let yaw = rotationY[slot];
    if (opts.faceCamera) {
      const toEyeX = view.x - px[slot];
      const toEyeZ = view.z - pz[slot];
      if (Math.abs(toEyeX) > 1e-6 || Math.abs(toEyeZ) > 1e-6) {
        yaw = Math.atan2(toEyeX, toEyeZ);
      }
    }
    const meshX = scaleX[slot] * sizeScale.x;
    const meshY = scaleY[slot] * sizeScale.y;
    const meshZ = scaleZ[slot] * sizeScale.z;
    let frame = 0;
    if (sheet) {
      const t = age[slot] / life[slot];
      const progress = sheet.frameOverTime ? sheet.frameOverTime(t) : t * cycles * frames;
      frame = Math.min(frames - 1, Math.max(0, Math.floor(progress) % frames));
    }
    const column = sheet ? frame % sheet.columns : 0;
    const row = sheet ? Math.floor(frame / sheet.columns) : 0;
    const u0 = sheet ? column / sheet.columns : 0;
    const v0 = sheet ? row / sheet.rows : 0;
    const du = sheet ? 1 / sheet.columns : 1;
    const dv = sheet ? 1 / sheet.rows : 1;
    const base = index * verticesPerParticle;
    for (let vertex = 0; vertex < verticesPerParticle; vertex++) {
      const sourcePosition = vertex * 3;
      rotate(
        source.positions[sourcePosition] * meshX,
        source.positions[sourcePosition + 1] * meshY,
        source.positions[sourcePosition + 2] * meshZ,
        rotationX[slot],
        yaw,
        rotationZ[slot],
        turned,
      );
      const target = (base + vertex) * 3;
      positions[target] = px[slot] + turned.x;
      positions[target + 1] = py[slot] + turned.y;
      positions[target + 2] = pz[slot] + turned.z;

      const sourceNormal = source.normals;
      rotate(
        (sourceNormal?.[sourcePosition] ?? 0) / Math.max(1e-6, Math.abs(meshX)),
        (sourceNormal?.[sourcePosition + 1] ?? 1) / Math.max(1e-6, Math.abs(meshY)),
        (sourceNormal?.[sourcePosition + 2] ?? 0) / Math.max(1e-6, Math.abs(meshZ)),
        rotationX[slot],
        rotationY[slot],
        rotationZ[slot],
        turned,
      );
      const normalLength = Math.hypot(turned.x, turned.y, turned.z) || 1;
      normals[target] = turned.x / normalLength;
      normals[target + 1] = turned.y / normalLength;
      normals[target + 2] = turned.z / normalLength;

      const sourceUv = vertex * 2;
      const targetUv = (base + vertex) * 2;
      uvs[targetUv] = u0 + (source.uvs?.[sourceUv] ?? 0) * du;
      uvs[targetUv + 1] = v0 + (source.uvs?.[sourceUv + 1] ?? 0) * dv;
    }
  }

  function collapse(from: number): void {
    // Every unused quad becomes four coincident vertices at the origin, which
    // rasterizes to nothing. Cheaper than shrinking the index buffer, and it
    // keeps the array lengths fixed so a version bump stays a rewrite.
    positions.fill(0, from * verticesPerParticle * 3);
  }

  return {
    mesh,
    get alive() {
      return alive;
    },
    pause() {
      emitting = false;
    },
    resume() {
      emitting = true;
    },
    reset() {
      age.fill(NaN);
      alive = 0;
      pending = 0;
      emissionTime = 0;
      burstStarted = false;
      collapse(0);
      mesh.version = (mesh.version ?? 0) + 1;
    },
    update(dtSeconds, view) {
      if (dtSeconds > 0) {
        for (let i = 0; i < capacity; i++) {
          if (Number.isNaN(age[i])) continue;
          age[i] += dtSeconds;
          if (age[i] >= life[i]) {
            age[i] = NaN;
            alive--;
            continue;
          }
          vy[i] -= gravity * dtSeconds;
          px[i] += vx[i] * dtSeconds;
          py[i] += vy[i] * dtSeconds;
          pz[i] += vz[i] * dtSeconds;
          rotationX[i] += angularX[i] * dtSeconds;
          rotationY[i] += angularY[i] * dtSeconds;
          rotationZ[i] += angularZ[i] * dtSeconds;
        }
        if (emitting) {
          const start = emissionTime;
          const end = emissionTime + dtSeconds;
          const activeRateSeconds =
            !looping && duration > 0
              ? Math.max(0, Math.min(end, duration) - Math.min(start, duration))
              : dtSeconds;
          pending += opts.rate * activeRateSeconds;
          // Whole particles only, with the fraction carried — otherwise a rate
          // below one per frame emits nothing at all.
          while (pending >= 1) {
            pending -= 1;
            spawn();
          }
          fireBursts(start, end, !burstStarted);
          burstStarted = true;
          emissionTime = end;
        }
      }
      let written = 0;
      for (let i = 0; i < capacity; i++) {
        if (Number.isNaN(age[i])) continue;
        if (source) writeMesh(i, written, view);
        else writeQuad(i, written, view);
        written++;
      }
      collapse(written);
      mesh.version = (mesh.version ?? 0) + 1;
    },
  };
}
