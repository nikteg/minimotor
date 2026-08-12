/** A billboard particle emitter that draws as one ordinary mesh.
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
   *  Omitted, they are all born at the origin. */
  box?: { x: number; y: number; z: number };
  /** Which way particles set off, in local space, normalized on the way in.
   *  Default is +Z. Other engines' box emitters do not agree on the sign —
   *  Cocos', for one, sets off down −Z — so an emitter ported from authored
   *  data should pass this rather than rely on the default. */
  direction?: { x: number; y: number; z: number };
  /** Quad size before any stretch. */
  size: { x: number; y: number };
  /** Multiplied into the material's own colour, per vertex. */
  color?: readonly [number, number, number, number];
  /** Units per second squared, downward. */
  gravity?: number;
  mode?: BillboardMode;
  /** For `"stretched"`: how many times `size.y` is stretched along the
   *  velocity. The trail's length is `size.y * lengthScale` and its thickness
   *  is `size.x`. */
  lengthScale?: number;
  sheet?: SpriteSheet;
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
  const size = opts.size;
  const mode: BillboardMode = opts.mode ?? "billboard";
  const lengthScale = opts.lengthScale ?? 1;
  const gravity = opts.gravity ?? 0;
  const color = opts.color ?? [1, 1, 1, 1];
  const sheet = opts.sheet;
  const cycles = sheet?.cycles ?? 1;
  const frames = sheet ? Math.max(1, sheet.columns * sheet.rows) : 1;
  // One more than the steady state, because the particle emitted on the frame
  // the oldest one dies is briefly the (n+1)th.
  const capacity = Math.max(1, opts.capacity ?? Math.ceil(opts.rate * highest(lifetime)) + 1);

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

  const positions = new Float32Array(capacity * 4 * 3);
  const uvs = new Float32Array(capacity * 4 * 2);
  const colors = new Float32Array(capacity * 4 * 4);
  const normals = new Float32Array(capacity * 4 * 3);
  const indices = new Uint16Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    const v = i * 4;
    const o = i * 6;
    indices[o] = v;
    indices[o + 1] = v + 1;
    indices[o + 2] = v + 2;
    indices[o + 3] = v;
    indices[o + 4] = v + 2;
    indices[o + 5] = v + 3;
    // Colours never vary per corner, so they are written once per particle at
    // birth rather than every frame.
    for (let corner = 0; corner < 4; corner++) {
      const c = (v + corner) * 4;
      colors[c] = color[0];
      colors[c + 1] = color[1];
      colors[c + 2] = color[2];
      colors[c + 3] = color[3];
    }
  }

  const mesh: MeshData = { positions, normals, uvs, colors, indices, version: 0 };

  let pending = 0;
  let emitting = true;
  let alive = 0;

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
    px[slot] = opts.box ? (random() - 0.5) * opts.box.x : 0;
    py[slot] = opts.box ? (random() - 0.5) * opts.box.y : 0;
    pz[slot] = opts.box ? (random() - 0.5) * opts.box.z : 0;
    const launch = pick(speed, random);
    vx[slot] = direction.x * launch;
    vy[slot] = direction.y * launch;
    vz[slot] = direction.z * launch;
    age[slot] = 0;
    life[slot] = Math.max(1e-4, pick(lifetime, random));
    alive++;
  }

  const worldUp = { x: 0, y: 1, z: 0 };
  const worldRight = { x: 1, y: 0, z: 0 };
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

    let halfWidth = size.x / 2;
    let halfHeight = size.y / 2;
    // How far along `right` the quad's centre is pushed. Zero for every mode
    // but `stretched`, which anchors its head on the particle instead of
    // straddling it — see below.
    let shift = 0;

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
      right.x = -toView.z;
      right.y = 0;
      right.z = toView.x;
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
      // u increases with the velocity, so a frame drawn left to right points
      // the way the particle is going: whatever the art does along its length
      // — taper, arrowhead, a flipbook of a line scrolling — reads forwards.
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
      halfWidth = (size.y * lengthScale) / 2;
      halfHeight = size.x / 2;
      // A streak shows where a particle has BEEN, so its head sits ON the
      // particle and the tail runs back down the velocity. Centring it instead
      // draws half the trail in front of the thing making it.
      shift = -halfWidth;
    } else {
      // Square-on. Cross with world up first, so the quad's own up stays as
      // near vertical as the view allows rather than rolling with the camera.
      right.x = -toView.z;
      right.y = 0;
      right.z = toView.x;
      if (Math.hypot(right.x, right.z) < 1e-6) {
        right.x = 1;
        right.z = 0;
      }
      Vec3.normalize(right, right);
      Vec3.cross(toView, right, up);
      Vec3.normalize(up, up);
    }

    let frame = 0;
    if (sheet) {
      const t = age[slot] / life[slot];
      const progress = sheet.frameOverTime ? sheet.frameOverTime(t) : t * cycles * frames;
      frame = Math.min(frames - 1, Math.max(0, Math.floor(progress) % frames));
    }
    const column = sheet ? frame % sheet.columns : 0;
    const row = sheet ? Math.floor(frame / sheet.columns) : 0;
    const u0 = sheet ? column / sheet.columns : 0;
    const u1 = sheet ? (column + 1) / sheet.columns : 1;
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

  function collapse(from: number): void {
    // Every unused quad becomes four coincident vertices at the origin, which
    // rasterizes to nothing. Cheaper than shrinking the index buffer, and it
    // keeps the array lengths fixed so a version bump stays a rewrite.
    positions.fill(0, from * 4 * 3);
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
        }
        if (emitting) {
          pending += opts.rate * dtSeconds;
          // Whole particles only, with the fraction carried — otherwise a rate
          // below one per frame emits nothing at all.
          while (pending >= 1) {
            pending -= 1;
            spawn();
          }
        }
      }
      let written = 0;
      for (let i = 0; i < capacity; i++) {
        if (Number.isNaN(age[i])) continue;
        writeQuad(i, written, view);
        written++;
      }
      collapse(written);
      mesh.version = (mesh.version ?? 0) + 1;
    },
  };
}
