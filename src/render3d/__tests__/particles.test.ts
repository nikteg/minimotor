/** The billboard emitter.
 *
 * An emitter is a simulation and a mesh writer bolted together, and the two
 * fail differently: the simulation gets counts and lifetimes wrong, the writer
 * gets geometry and UVs wrong. Both are checkable without a GPU, because the
 * whole output is a `MeshData` of plain numbers — which is most of the reason
 * the emitter builds one rather than driving a renderer stage.
 */

import { describe, expect, it } from "vitest";
import { Mat4 } from "@src/math/mat4.js";
import { createEmitter, localViewer } from "@src/render3d/particles.js";

/** A repeatable stand-in for `Math.random`, so a test can say what a particle
 * was born with. Always dead centre: a box spawn lands at the origin and a
 * range picks its midpoint. */
const middle = (): number => 0.5;

const VIEW = { x: 0, y: 0, z: 100 };

function quadOf(mesh: { positions: Float32Array }, index: number): number[][] {
  const out: number[][] = [];
  for (let corner = 0; corner < 4; corner++) {
    const p = (index * 4 + corner) * 3;
    out.push([mesh.positions[p], mesh.positions[p + 1], mesh.positions[p + 2]]);
  }
  return out;
}

describe("emitting", () => {
  it("emits at its rate and settles at the count the lifetime implies", () => {
    const emitter = createEmitter({ rate: 10, lifetime: 2, size: { x: 1, y: 1 }, random: middle });
    // Ten a second living two seconds is twenty alive, once the first has died.
    for (let step = 0; step < 400; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBeGreaterThanOrEqual(19);
    expect(emitter.alive).toBeLessThanOrEqual(21);
  });

  it("emits nothing on a rate below one per frame without losing the fraction", () => {
    // A rate of two per second at 60fps is 0.033 particles a frame. Truncating
    // instead of carrying would emit nothing, ever.
    // 40 frames is two thirds of a second, so 1.33 particles are owed and one
    // is emitted; 40 more takes it to 2.67 and a second appears. Both counts
    // are deliberately off the exact boundary — 30 frames of 1/60 sums to a
    // hair under 0.5 in binary floating point, and the particle owed at
    // exactly 1.0 would or would not arrive depending on the rounding.
    const emitter = createEmitter({ rate: 2, lifetime: 100, size: { x: 1, y: 1 }, random: middle });
    for (let step = 0; step < 40; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(1);
    for (let step = 0; step < 40; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(2);
  });

  it("stops at capacity rather than cutting a live particle short", () => {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 100,
      capacity: 8,
      size: { x: 1, y: 1 },
      random: middle,
    });
    for (let step = 0; step < 60; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(8);
  });

  it("keeps running live particles when paused, and emits again when resumed", () => {
    const emitter = createEmitter({ rate: 10, lifetime: 1, size: { x: 1, y: 1 }, random: middle });
    for (let step = 0; step < 30; step++) emitter.update(1 / 60, VIEW);
    const mid = emitter.alive;
    expect(mid).toBeGreaterThan(0);
    emitter.pause();
    for (let step = 0; step < 90; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(0);
    emitter.resume();
    for (let step = 0; step < 30; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBeGreaterThan(0);
  });

  it("empties on reset", () => {
    const emitter = createEmitter({ rate: 50, lifetime: 5, size: { x: 1, y: 1 }, random: middle });
    for (let step = 0; step < 60; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBeGreaterThan(0);
    emitter.reset();
    expect(emitter.alive).toBe(0);
    expect([...emitter.mesh.positions].every((v) => v === 0)).toBe(true);
  });

  it("carries particles along their velocity and pulls them down under gravity", () => {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      speed: 4,
      direction: { x: 0, y: 0, z: 1 },
      gravity: 10,
      size: { x: 0, y: 0 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    emitter.update(1, VIEW);
    // A zero-size quad puts all four corners on the particle itself.
    const [[, y, z]] = quadOf(emitter.mesh, 0);
    expect(z).toBeCloseTo(4, 1);
    expect(y).toBeLessThan(-4);
  });
});

describe("the mesh it writes", () => {
  it("bumps its version every update, so a backend re-uploads", () => {
    const emitter = createEmitter({ rate: 10, lifetime: 1, size: { x: 1, y: 1 }, random: middle });
    const before = emitter.mesh.version ?? 0;
    emitter.update(1 / 60, VIEW);
    emitter.update(1 / 60, VIEW);
    expect(emitter.mesh.version).toBe(before + 2);
  });

  it("keeps one identity and one fixed length for the life of the emitter", () => {
    // A version bump is only a rewrite if nothing reallocates, and the mesh
    // object itself has to stay the same one the node is holding.
    const emitter = createEmitter({
      rate: 10,
      lifetime: 1,
      capacity: 4,
      size: { x: 1, y: 1 },
      random: middle,
    });
    const mesh = emitter.mesh;
    const positions = mesh.positions;
    for (let step = 0; step < 200; step++) emitter.update(1 / 60, VIEW);
    expect(emitter.mesh).toBe(mesh);
    expect(mesh.positions).toBe(positions);
    expect(positions).toHaveLength(4 * 4 * 3);
    expect(mesh.indices).toHaveLength(4 * 6);
  });

  it("collapses the quads of dead particles to nothing", () => {
    const emitter = createEmitter({
      rate: 60,
      lifetime: 1,
      capacity: 10,
      size: { x: 1, y: 1 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(1);
    // The one live quad is written; the other nine are four coincident
    // vertices at the origin, which rasterizes to nothing.
    const tail = [...emitter.mesh.positions.slice(4 * 3)];
    expect(tail.every((v) => v === 0)).toBe(true);
    expect([...emitter.mesh.positions.slice(0, 12)].some((v) => v !== 0)).toBe(true);
  });

  it("faces a billboard quad at the viewer", () => {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      size: { x: 2, y: 2 },
      random: middle,
    });
    emitter.update(1 / 60, { x: 0, y: 0, z: 100 });
    // Viewer down +Z, so the quad spans X and Y and is flat in Z.
    const corners = quadOf(emitter.mesh, 0);
    expect(corners.every(([, , z]) => Math.abs(z) < 1e-6)).toBe(true);
    expect(corners.map(([x]) => x).sort()).toEqual([-1, -1, 1, 1]);
    expect(corners.map(([, y]) => y).sort()).toEqual([-1, -1, 1, 1]);
  });

  it("lays a horizontal quad flat however the viewer moves", () => {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      mode: "horizontal",
      size: { x: 2, y: 2 },
      random: middle,
    });
    emitter.update(1 / 60, { x: 50, y: 3, z: -20 });
    const corners = quadOf(emitter.mesh, 0);
    expect(corners.every(([, y]) => Math.abs(y) < 1e-6)).toBe(true);
  });

  it("stretches a moving quad along its velocity by lengthScale", () => {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      mode: "stretched",
      lengthScale: 5,
      speed: 1,
      direction: { x: 0, y: 1, z: 0 },
      size: { x: 2, y: 4 },
      random: middle,
    });
    emitter.update(1 / 60, { x: 0, y: 0, z: 100 });
    const corners = quadOf(emitter.mesh, 0);
    const heights = corners.map(([, y]) => y);
    // 4 * 5 long along the velocity, still 2 wide across it.
    expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(20, 4);
    const widths = corners.map(([x]) => x);
    expect(Math.max(...widths) - Math.min(...widths)).toBeCloseTo(2, 4);
  });

  it("falls back to a plain billboard for a particle that is not moving", () => {
    // `stretched` has no axis to stretch along at zero speed, and normalizing
    // a zero vector would put NaN into the vertex buffer — which drops the
    // whole mesh, not just the particle.
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      mode: "stretched",
      lengthScale: 5,
      speed: 0,
      size: { x: 2, y: 2 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect([...emitter.mesh.positions].every((v) => Number.isFinite(v))).toBe(true);
    const corners = quadOf(emitter.mesh, 0);
    expect(Math.max(...corners.map(([, y]) => y))).toBeCloseTo(1, 6);
  });
});

describe("sprite sheets", () => {
  const sheetEmitter = (frameOverTime?: (t: number) => number) =>
    createEmitter({
      rate: 1000,
      lifetime: 1,
      capacity: 1,
      size: { x: 1, y: 1 },
      sheet: { columns: 2, rows: 8, frameOverTime },
      random: middle,
    });

  function frameOf(mesh: { uvs: Float32Array }): [number, number] {
    // The top-left corner's UV names the cell.
    return [mesh.uvs[0], mesh.uvs[1]];
  }

  it("starts at the first cell and walks the sheet as a particle ages", () => {
    const emitter = sheetEmitter();
    emitter.update(1 / 60, VIEW);
    expect(frameOf(emitter.mesh)).toEqual([0, 0]);
    // Halfway through a sixteen-frame sheet is frame 8, which on a 2-wide
    // sheet is column 0 of row 4.
    emitter.update(0.5, VIEW);
    expect(frameOf(emitter.mesh)).toEqual([0, 4 / 8]);
  });

  it("reads the sheet left to right and top to bottom", () => {
    // `v = 0` is the TOP of a texture everywhere in this engine, so frame 1 is
    // the cell to the RIGHT of frame 0, and frame 2 is below frame 0.
    const emitter = sheetEmitter((t) => t * 16);
    emitter.update(1 / 60, VIEW);
    emitter.update(1 / 16, VIEW);
    expect(frameOf(emitter.mesh)).toEqual([0.5, 0]);
    emitter.update(1 / 16, VIEW);
    expect(frameOf(emitter.mesh)).toEqual([0, 1 / 8]);
  });

  it("never runs off the end of the sheet", () => {
    // A curve that overshoots, which an authored one can.
    const emitter = sheetEmitter((t) => t * 1000);
    for (let step = 0; step < 50; step++) {
      emitter.update(1 / 60, VIEW);
      const [u, v] = frameOf(emitter.mesh);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("spans the whole texture when there is no sheet", () => {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      size: { x: 1, y: 1 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect([...emitter.mesh.uvs.slice(0, 8)]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });
});

describe("localViewer", () => {
  it("undoes a node's translation", () => {
    const world = Mat4.fromTranslation(10, 0, 0);
    expect(localViewer(world, { x: 12, y: 3, z: -4 })).toEqual({ x: 2, y: 3, z: -4 });
  });

  it("undoes a node's scale, which is what puts a scaled emitter's quads right", () => {
    // An emitter under a node scaled by 2 simulates in half-size units, so the
    // camera has to arrive in those units too or every quad faces off-axis.
    const world = Mat4.fromScale(2, 2, 2);
    const local = localViewer(world, { x: 8, y: 0, z: 0 });
    expect(local.x).toBeCloseTo(4, 6);
  });

  it("hands the camera back unchanged when the matrix cannot be inverted", () => {
    // A zero scale somewhere up the chain. Wrong, but finite — NaN here would
    // spread into every vertex of the batch.
    const world = Mat4.fromScale(0, 0, 0);
    expect(localViewer(world, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
    expect(localViewer(undefined, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });
});
