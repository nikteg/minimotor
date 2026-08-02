// ---------- The arena ----------
// The level, the targets, and the two bits of geometry the game asks questions
// with: push a circle out of the walls, and shoot a ray at a box. Split out of
// `fps.ts` so the netcode and the shooting can share it without either one
// owning it.

import { Vec3, type Vec3 as Vec3Value } from "minimotor";
import { addNode, box, createScene, node, plane, sphere } from "minimotor/3d";

/** An axis-aligned box: centre plus half-extents. The only collision shape in
 *  the level, which is why the whole file is 30 lines of geometry. */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export const EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.35;

/** Half-extents of a standing player, for shots FROM other players. Taller and
 *  narrower than the movement circle: the thing you collide with is a cylinder
 *  from the floor, the thing you shoot at is a body around the eye. */
export const PLAYER_HALF = { hx: 0.4, hy: 0.9, hz: 0.4 };

export const walls: Box[] = [];

export const scene = createScene({
  ambient: [0.22, 0.24, 0.32],
  lights: [
    { direction: { x: -0.4, y: -1, z: -0.35 }, color: [1, 0.95, 0.85], intensity: 0.95 },
    { direction: { x: 0.7, y: -0.25, z: 0.6 }, color: [0.35, 0.5, 0.95], intensity: 0.5 },
  ],
  background: [0.05, 0.06, 0.09, 1],
});

/** Add a solid box to both the scene and the collision list. */
export function solid(b: Box, color: readonly [number, number, number, number]): number {
  const index = addNode(
    scene,
    node({
      mesh: box(b.hx * 2, b.hy * 2, b.hz * 2),
      position: { x: b.x, y: b.y, z: b.z },
      material: { color, shininess: 20, specular: 0.1 },
    }),
  );
  walls.push(b);
  return index;
}

// The floor is a plane rather than a box, so the player never stands inside a
// collider.
addNode(
  scene,
  node({
    mesh: plane(40, 40, 1),
    material: { color: [0.13, 0.14, 0.19, 1] },
  }),
);

const WALL: readonly [number, number, number, number] = [0.2, 0.22, 0.3, 1];
const CRATE: readonly [number, number, number, number] = [0.45, 0.34, 0.2, 1];

// An arena, walled on four sides.
for (const [x, z, hx, hz] of [
  [0, -14, 14, 0.5],
  [0, 14, 14, 0.5],
  [-14, 0, 0.5, 14],
  [14, 0, 0.5, 14],
] as const) {
  solid({ x, y: 1.6, z, hx, hy: 1.6, hz }, WALL);
}
// Cover to hide behind and shoot around. Nothing sits on x ≈ 0: the player
// spawns at (0, 8) facing the terminal at (0, −13.4), and a crate in that lane
// means the sample opens with you jammed against a box.
for (const [x, z, s] of [
  [-5, -6, 1.1],
  [4, -8, 0.9],
  [7, 3, 1.3],
  [-6, 6, 1],
  [3.2, 1, 0.7],
  [-9, -1, 0.8],
] as const) {
  solid({ x, y: s, z, hx: s, hy: s, hz: s }, CRATE);
}

/** Where players come in. Indexed by the room slot, so two players never spawn
 *  inside each other and everyone's "P2 starts there" agrees without a
 *  message — `net.index` is already the same number on every machine. */
export const SPAWNS: readonly { x: number; z: number; yaw: number }[] = [
  { x: 0, z: 8, yaw: 0 },
  { x: -10, z: -10, yaw: Math.PI * 0.75 },
  { x: 10, z: -10, yaw: -Math.PI * 0.75 },
  { x: -10, z: 10, yaw: Math.PI * 0.25 },
  { x: 10, z: 10, yaw: -Math.PI * 0.25 },
  { x: 0, z: -9, yaw: Math.PI },
  { x: -12, z: 0, yaw: Math.PI / 2 },
  { x: 12, z: 0, yaw: -Math.PI / 2 },
];

export const spawnFor = (index: number) =>
  SPAWNS[((index % SPAWNS.length) + SPAWNS.length) % SPAWNS.length];

// ---- targets ---------------------------------------------------------------

export interface Target {
  node: number;
  box: Box;
  alive: boolean;
  /** Seconds since it was hit; 0 while alive. Drives the sink-and-respawn. */
  dying: number;
  bob: number;
}

/** Height every target floats at. Close to the 1.7 eye height on purpose: the
 *  camera starts level, and a target centred much lower is missed by a
 *  horizontal shot at the top of its bob. */
export const BASE_Y = 1.5;

export const targets: Target[] = [];
for (const [x, z, phase] of [
  [-8, -9, 0],
  [6, -11, 0.9],
  [10, 6, 1.8],
  [-10, 8, 2.7],
  [2, 9, 3.6],
  [-2, -4, 4.5],
  [9, -3, 5.4],
] as const) {
  targets.push({
    node: addNode(
      scene,
      node({
        mesh: sphere(0.55, 20, 14),
        position: { x, y: BASE_Y, z },
        material: { color: [0.92, 0.3, 0.34, 1], shininess: 60, specular: 0.4 },
      }),
    ),
    box: { x, y: BASE_Y, z, hx: 0.55, hy: 0.55, hz: 0.55 },
    alive: true,
    dying: 0,
    bob: phase,
  });
}

export function revive(t: Target): void {
  const n = scene.nodes[t.node];
  t.alive = true;
  t.dying = 0;
  Vec3.set(n.scale, 1, 1, 1);
  n.hidden = false;
}

/** Advance the bob and the sink-and-respawn. Targets are LOCAL in a networked
 *  match — see `netplay.ts` for why the room's shared state is the terminal and
 *  the scoreboard rather than the shooting gallery. */
export function stepTargets(dt: number): void {
  for (const t of targets) {
    const n = scene.nodes[t.node];
    t.bob += dt * 1.6;
    if (t.alive) {
      // The hit box bobs WITH the art. Leaving it at the base height is the
      // classic "I shot it and nothing happened" — invisible, and only at the
      // extremes of the animation.
      n.position.y = BASE_Y + Math.sin(t.bob) * 0.16;
      t.box.y = n.position.y;
      continue;
    }
    t.dying += dt;
    // Sink and shrink, then come back — a sample wants targets that respawn.
    const k = Math.min(1, t.dying / 0.5);
    n.position.y = BASE_Y - k * 1.4;
    Vec3.set(n.scale, 1 - k, 1 - k, 1 - k);
    n.hidden = k >= 1;
    if (t.dying > 3) revive(t);
  }
}

// ---- geometry --------------------------------------------------------------

/** Push the player (a circle, seen from above) out of every wall it overlaps.
 *  Resolving on the axis of LEAST penetration is what makes sliding along a
 *  wall feel right instead of sticking to it. */
export function resolve(p: Vec3Value, radius: number): void {
  for (const w of walls) {
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    const ox = w.hx + radius - Math.abs(dx);
    const oz = w.hz + radius - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) p.x += Math.sign(dx || 1) * ox;
    else p.z += Math.sign(dz || 1) * oz;
  }
}

/** Distance along a ray to an AABB, or Infinity for a miss. The slab method:
 *  clip the ray against each axis's pair of planes and see whether an interval
 *  survives. */
export function rayBox(origin: Vec3Value, dir: Vec3Value, b: Box): number {
  let near = 0;
  let far = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const c = [b.x, b.y, b.z];
  const h = [b.hx, b.hy, b.hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      // Parallel to this slab: a miss unless the origin is already between its
      // planes.
      if (Math.abs(o[i] - c[i]) > h[i]) return Infinity;
      continue;
    }
    const inv = 1 / d[i];
    let t0 = (c[i] - h[i] - o[i]) * inv;
    let t1 = (c[i] + h[i] - o[i]) * inv;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return Infinity;
  }
  return near;
}

/** Distance to the nearest wall along a ray — the range every shot is clipped
 *  to, so nobody shoots through cover. */
export function wallDistance(origin: Vec3Value, dir: Vec3Value): number {
  let best = Infinity;
  for (const w of walls) best = Math.min(best, rayBox(origin, dir, w));
  return best;
}
