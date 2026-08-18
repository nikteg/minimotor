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
import { createEmitter, localViewer, type Emitter } from "@src/render3d/particles.js";

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

  it("fires bursts at zero and repeats them with a looping duration", () => {
    const emitter = createEmitter({
      rate: 0,
      lifetime: 0.75,
      duration: 1,
      loop: true,
      bursts: [{ time: 0, count: 2 }],
      size: { x: 1, y: 1 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(2);
    emitter.update(0.8, VIEW);
    expect(emitter.alive).toBe(0);
    emitter.update(0.2, VIEW);
    expect(emitter.alive).toBe(2);
  });

  it("keeps a once-per-cycle burst alight on a perfectly regular timestep", () => {
    // The shape the Trash Golf tornado is authored in: one particle per cycle,
    // living exactly as long as the cycle, so the emitter is never empty and
    // never doubled. Stepped at an exact 1/60 the accumulated emission time
    // lands a hair BELOW each 1.5 s boundary, which used to lose the burst on
    // both sides of it — the frame that reached the boundary did not consider
    // the new cycle and the next one rejected it as too close to its start.
    // Dark from 1.5 s to 9.0 s, then well again once float drift changed sign.
    const emitter = createEmitter({
      rate: 0,
      lifetime: 1.5,
      duration: 1.5,
      loop: true,
      bursts: [{ time: 0, count: 1 }],
      size: { x: 1, y: 1 },
      random: middle,
    });
    let dark = 0;
    for (let frame = 0; frame < 60 * 30; frame++) {
      emitter.update(1 / 60, VIEW);
      if (emitter.alive === 0) dark++;
    }
    expect(dark).toBe(0);
  });

  it("does not repeat a burst on a non-looping emitter", () => {
    const emitter = createEmitter({
      rate: 0,
      lifetime: 0.25,
      duration: 0.5,
      loop: false,
      bursts: [{ count: 1 }],
      size: { x: 1, y: 1 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(1);
    emitter.update(1, VIEW);
    expect(emitter.alive).toBe(0);
    emitter.update(1, VIEW);
    expect(emitter.alive).toBe(0);
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

  it("keeps a vertical quad upright and only yaws it", () => {
    // The difference from `billboard` only shows from above: a plain billboard
    // lies over towards a camera looking down and stops reading as standing
    // up, which is wrong for smoke or a flame.
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      mode: "vertical",
      size: { x: 2, y: 2 },
      random: middle,
    });
    emitter.update(1 / 60, { x: 0, y: 80, z: 30 });
    const corners = quadOf(emitter.mesh, 0);
    // Two corners a unit up and two a unit down, whatever the pitch — a
    // billboard under the same camera would have spread them over Y and Z.
    expect(corners.map(([, y]) => y).sort()).toEqual([-1, -1, 1, 1]);
    // And the width is horizontal, so the card has no lean at all.
    expect(corners.every(([, , z]) => Math.abs(z) < 1e-6)).toBe(true);
  });

  it("runs a stretched quad's U axis down the trail, tail first", () => {
    // The orientation is not a free choice. A streak texture is drawn the way
    // a streak reads — left to right along the image — so its frames are wide
    // and short. Stretching down V instead squeezes a 128x16 line's length
    // into the quad's thickness and smears its 16 pixels over the whole trail,
    // which is the wind card coming out rotated a quarter turn.
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
    const uvs = [0, 1, 2, 3].map((corner) => [
      emitter.mesh.uvs![corner * 2],
      emitter.mesh.uvs![corner * 2 + 1],
    ]);
    // **u DECREASES with the velocity, and that is a correction.** This asserted
    // the opposite — a frame drawn left to right pointing the way the particle
    // is going — which is the reasonable-sounding reading and is not what the
    // sprites are drawn for. Reported from play against the only consumer with
    // a directional stretched sheet: a course fan and the wind power-up both
    // blew visibly backwards while every heading in their data was correct, and
    // the stretch axis is the one thing those two share.
    //
    // Cocos stretches along the quad's V rather than its U, so its sprites are
    // authored against a different axis AND a different sense from the one this
    // mode was first written to. U is still right for the art — a 2x8 sheet's
    // cells are wide and short, so U is the line's own length — and which end
    // of U leads is what was wrong.
    const atU1 = corners.filter((_, at) => uvs[at][0] === 1).map(([, y]) => y);
    const atU0 = corners.filter((_, at) => uvs[at][0] === 0).map(([, y]) => y);
    expect(Math.min(...atU0)).toBeGreaterThan(Math.max(...atU1));
    // Across the trail is V, and it is `size.x` wide rather than the length.
    const acrossAtU1 = corners.filter((_, at) => uvs[at][0] === 1).map(([x]) => x);
    expect(Math.max(...acrossAtU1) - Math.min(...acrossAtU1)).toBeCloseTo(2, 4);
    // The GEOMETRY is untouched by the flip: the head still sits on the
    // particle and the tail still runs back down the velocity, which the test
    // below pins. Only which end of the image lands on which end moved.
  });

  it("turns a faceCamera mesh to the viewer about world up, and only about it", () => {
    // For an authored MESH there is no billboard to fall back on: the geometry
    // is a real object — a question mark, a heart — and it keeps whatever
    // heading it was born with. `faceCamera` replaces that yaw with the one
    // that puts the model's front on the viewer.
    //
    // A yaw and NOT a look-at, deliberately: these things stand on a ground
    // plane, and tipping one back to square up with a high camera reads as the
    // model falling over rather than as it turning to you.
    const quad: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
      version: 0,
    };
    const make = (faceCamera: boolean) => {
      const emitter = createEmitter({
        rate: 1000,
        lifetime: 10,
        capacity: 1,
        mode: "mesh",
        mesh: quad,
        size: { x: 1, y: 1, z: 1 },
        random: middle,
        faceCamera,
      });
      // A camera off to +X, so facing it is a quarter turn from the authored 0.
      emitter.update(1 / 60, { x: 100, y: 0, z: 0 });
      return emitter.mesh;
    };
    const free = make(false);
    const facing = make(true);
    // The unturned copy keeps the source's own x extent along X; turned to a
    // camera on +X, that extent moves onto Z.
    const spanOf = (mesh: MeshData, axis: number) => {
      const values = [0, 1, 2].map((v) => mesh.positions[v * 3 + axis]!);
      return Math.max(...values) - Math.min(...values);
    };
    expect(spanOf(free, 0)).toBeCloseTo(1, 4);
    expect(spanOf(free, 2)).toBeCloseTo(0, 4);
    expect(spanOf(facing, 2)).toBeCloseTo(1, 4);
    expect(spanOf(facing, 0)).toBeCloseTo(0, 4);
    // Y is untouched either way: the turn is about world up and nothing else.
    expect(spanOf(facing, 1)).toBeCloseTo(spanOf(free, 1), 4);
  });

  it("rolls a BILLBOARD by its authored z, which used to reach meshes only", () => {
    // `rotation` was documented as an authored-mesh Euler and wired only into
    // `writeMesh`, so a billboard drawn from a sheet came out square-on however
    // it was authored. The capture's stroke puff authors 75 degrees and drew at
    // zero: a long sprite laid across the view is not the same picture as one
    // laid along it, which is why it read as the wrong shape AND the wrong size.
    const upright = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      mode: "billboard",
      size: { x: 4, y: 1 },
      random: middle,
    });
    upright.update(1 / 60, { x: 0, y: 0, z: 100 });
    const flat = quadOf(upright.mesh, 0);

    const rolled = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      mode: "billboard",
      size: { x: 4, y: 1 },
      rotation: { z: Math.PI / 2 },
      random: middle,
    });
    rolled.update(1 / 60, { x: 0, y: 0, z: 100 });
    const turned = quadOf(rolled.mesh, 0);

    // Unrolled: 4 wide across X, 1 tall up Y. A quarter turn swaps them.
    const span = (corners: number[][], axis: number) =>
      Math.max(...corners.map((c) => c[axis])) - Math.min(...corners.map((c) => c[axis]));
    expect(span(flat, 0)).toBeCloseTo(4, 4);
    expect(span(flat, 1)).toBeCloseTo(1, 4);
    expect(span(turned, 0)).toBeCloseTo(1, 4);
    expect(span(turned, 1)).toBeCloseTo(4, 4);
  });

  it("anchors a stretched quad's head on the particle", () => {
    // A trail shows where a particle has been. Centring it on the particle
    // draws half the trail ahead of the thing making it, which reads as the
    // particle sitting in the middle of its own spark.
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
    const heights = quadOf(emitter.mesh, 0).map(([, y]) => y);
    // Born at the origin, and a particle is written on the frame it spawns
    // before it has moved — so the head is at y = 0 and the whole 20-unit
    // trail hangs below it rather than straddling it at ±10.
    expect(Math.max(...heights)).toBeCloseTo(0, 6);
    expect(Math.min(...heights)).toBeCloseTo(-20, 4);
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

  it("copies, scales and rotates authored geometry per mesh particle", () => {
    const source = {
      positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    };
    const emitter = createEmitter({
      rate: 0,
      lifetime: 10,
      bursts: [{ count: 1 }],
      mode: "mesh",
      mesh: source,
      size: { x: 2, y: 3, z: 4 },
      rotation: { y: Math.PI / 2 },
      offset: { x: 5, y: 6, z: 7 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(1);
    expect(Array.from(emitter.mesh.positions.slice(0, 9))).toEqual([5, 6, 5, 5, 9, 7, 5, 6, 7]);
    // Capacity includes one spare particle, so its second triangle is present
    // but collapsed until another burst needs it.
    expect([...emitter.mesh.indices]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("turns authored mesh particles over their lifetime", () => {
    const emitter = createEmitter({
      rate: 0,
      lifetime: 10,
      bursts: [{ count: 1 }],
      mode: "mesh",
      mesh: {
        positions: new Float32Array([1, 0, 0]),
        indices: new Uint16Array([0]),
      },
      size: { x: 1, y: 1, z: 1 },
      angularVelocity: { y: Math.PI / 2 },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    emitter.update(1, VIEW);
    expect(emitter.mesh.positions[0]).toBeCloseTo(0, 5);
    expect(emitter.mesh.positions[2]).toBeCloseTo(-1, 5);
  });

  it("requires source geometry for mesh mode", () => {
    expect(() =>
      createEmitter({ rate: 1, lifetime: 1, mode: "mesh", size: { x: 1, y: 1 } }),
    ).toThrow(/non-empty mesh/);
  });
});

describe("the circle emission shape", () => {
  /** A `random` that walks a fixed list and wraps, because "dead centre" says
   *  nothing useful about a disc — it puts every particle at the same angle.
   *
   *  A circle spawn draws exactly twice and in this order: the angle around
   *  the arc, then how far out from the centre. Everything else these emitters
   *  pass is a constant, and `pick` only draws for a range, so the list reads
   *  as one pair per particle. */
  const sequence = (values: readonly number[]): (() => number) => {
    let at = 0;
    return () => values[at++ % values.length];
  };

  /** One burst of `count` zero-size particles, so each quad collapses onto the
   *  particle itself and the mesh reads as a list of spawn points. */
  const disc = (
    count: number,
    circle: NonNullable<Parameters<typeof createEmitter>[0]["circle"]>,
    rest: Partial<Parameters<typeof createEmitter>[0]> = {},
  ): Emitter =>
    createEmitter({
      rate: 0,
      lifetime: 10,
      bursts: [{ count }],
      circle,
      size: { x: 0, y: 0 },
      ...rest,
    });

  const pointsOf = (emitter: Emitter, count: number): number[][] =>
    Array.from({ length: count }, (_, at) => quadOf(emitter.mesh, at)[0]);

  /** Where each particle is going, MEASURED rather than asked for. Velocity is
   *  not on the public surface, and everything that depends on it — how long a
   *  stretched card is drawn, where a spark has got to — only ever sees it as
   *  displacement over time. Gravity is off in these, so one step is enough. */
  const velocitiesOf = (emitter: Emitter, count: number, dt: number): number[][] => {
    const before = pointsOf(emitter, count);
    emitter.update(dt, VIEW);
    return pointsOf(emitter, count).map((after, at) =>
      after.map((value, axis) => (value - before[at][axis]) / dt),
    );
  };

  const distanceOf = ([x, y, z]: number[]): number => Math.hypot(x, y, z);

  /** Readable places, and `+ 0` to fold −0 back into 0: `sin` of three
   *  quarters of a turn lands a hair BELOW zero, and `toEqual` tells the two
   *  apart even though nothing downstream can. */
  const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

  it("births on the rim at radiusThickness 0 and fires each particle along its own radius", () => {
    // The wall hit: `radius 0.1`, `radiusThickness 0`, `startSpeed 15`. The
    // outward fan IS the effect, and one direction for the whole emitter turns
    // this splash into a jet.
    const emitter = disc(
      4,
      { radius: 2, radiusThickness: 0 },
      { speed: 3, random: sequence([0, 0, 0.25, 0, 0.5, 0, 0.75, 0]) },
    );
    emitter.update(1 / 60, VIEW);
    expect(emitter.alive).toBe(4);
    // A quarter of the turn each, from +X towards +Y, all of them on the rim.
    const born = pointsOf(emitter, 4);
    for (const [, , z] of born) expect(z).toBeCloseTo(0, 6);
    expect(born.map(([x]) => round(x))).toEqual([2, 0, -2, 0]);
    expect(born.map(([, y]) => round(y))).toEqual([0, 2, 0, -2]);

    const going = velocitiesOf(emitter, 4, 0.5);
    for (let at = 0; at < 4; at++) {
      // `velocity = normalize(position) * speed`: same way as the radius it was
      // born on, and the speed the emitter was given, not the radius.
      expect(distanceOf(going[at])).toBeCloseTo(3, 5);
      for (let axis = 0; axis < 3; axis++) {
        expect(going[at][axis]).toBeCloseTo((born[at][axis] / 2) * 3, 5);
      }
    }
  });

  it("fills the disc inwards from the rim at radiusThickness 1", () => {
    // Cocos lerps the distance itself between the inner and outer radius
    // (`cc.13039.js:51042`), so the distances are uniform in the RADIUS rather
    // than over the area — a filled disc is denser in the middle, which is
    // what gives a puff a hot core instead of a hollow one.
    const emitter = disc(3, { radius: 2 }, { random: sequence([0, 0, 0, 0.5, 0, 1]) });
    emitter.update(1 / 60, VIEW);
    expect(pointsOf(emitter, 3).map(distanceOf)).toEqual([0, 1, 2]);
  });

  it("leaves a hole in the middle for a radiusThickness between the two", () => {
    const emitter = disc(
      3,
      { radius: 4, radiusThickness: 0.5 },
      { random: sequence([0, 0, 0, 0.5, 0, 1]) },
    );
    emitter.update(1 / 60, VIEW);
    // An annulus from `radius * (1 - radiusThickness)` out to `radius`.
    expect(pointsOf(emitter, 3).map(distanceOf)).toEqual([2, 3, 4]);
  });

  it("keeps every particle inside the arc, measured from +X towards +Y", () => {
    const emitter = disc(
      3,
      { radius: 1, radiusThickness: 0, arc: Math.PI / 2 },
      { random: sequence([0, 0, 0.5, 0, 1, 0]) },
    );
    emitter.update(1 / 60, VIEW);
    const angles = pointsOf(emitter, 3).map(([x, y]) => Math.atan2(y, x));
    expect(angles[0]).toBeCloseTo(0, 6);
    expect(angles[1]).toBeCloseTo(Math.PI / 4, 6);
    expect(angles[2]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("turns the disc AND every launch direction with shapeRotation", () => {
    // The bumper impact's ring is authored in XY and laid flat by a quarter
    // turn about X. Rotating the spawn points without the directions would
    // draw a flat ring whose sparks all climb out of it.
    const emitter = disc(
      2,
      { radius: 2, radiusThickness: 0 },
      {
        shapeRotation: { x: Math.PI / 2, y: 0, z: 0 },
        speed: 4,
        random: sequence([0, 0, 0.25, 0]),
      },
    );
    emitter.update(1 / 60, VIEW);
    const born = pointsOf(emitter, 2);
    // The disc's own +Y has become world +Z, so the ring lies in XZ.
    expect(born[0][0]).toBeCloseTo(2, 6);
    expect(born[0][2]).toBeCloseTo(0, 6);
    expect(born[1][0]).toBeCloseTo(0, 6);
    expect(born[1][2]).toBeCloseTo(2, 6);
    for (const [, y] of born) expect(y).toBeCloseTo(0, 6);

    const going = velocitiesOf(emitter, 2, 0.5);
    for (const [, y] of going) expect(y).toBeCloseTo(0, 5);
    expect(going[0][0]).toBeCloseTo(4, 5);
    expect(going[1][2]).toBeCloseTo(4, 5);
  });

  it("measures the outward direction from the disc's centre, not the node's", () => {
    // `offset` translates the shape; it is not part of the radius. Normalizing
    // the final position instead would send both of these the same way, which
    // for a ring hung off to one side is every particle fleeing the origin.
    const emitter = disc(
      2,
      { radius: 1, radiusThickness: 0 },
      { offset: { x: 10, y: 0, z: 0 }, speed: 2, random: sequence([0, 0, 0.5, 0]) },
    );
    emitter.update(1 / 60, VIEW);
    const born = pointsOf(emitter, 2);
    expect(born[0][0]).toBeCloseTo(11, 6);
    expect(born[1][0]).toBeCloseTo(9, 6);
    const going = velocitiesOf(emitter, 2, 0.5);
    expect(going[0][0]).toBeCloseTo(2, 5);
    expect(going[1][0]).toBeCloseTo(-2, 5);
  });

  it("leaves a particle born dead centre still rather than pointing nowhere", () => {
    // A zero radius has no direction to give, and Cocos' `Vec3.normalize`
    // answers a zero vector with a zero vector. Dividing by the length instead
    // would put NaN in the vertex buffer, which drops the whole batch — not
    // one particle.
    const emitter = disc(2, { radius: 0 }, { speed: 15, random: sequence([0, 0, 0.7, 0.9]) });
    emitter.update(1 / 60, VIEW);
    expect([...emitter.mesh.positions].every((value) => Number.isFinite(value))).toBe(true);
    const going = velocitiesOf(emitter, 2, 0.5);
    for (const velocity of going) {
      for (const axis of velocity) expect(axis).toBe(0);
    }
  });

  it("gives a stretched card its length from the particle's own velocity", () => {
    // The reason this shape is not decoration. A stretched billboard draws
    // along the velocity with its head on the particle, so on a ring every
    // card points out of the ring — the bumper impact's spokes. With one
    // shared direction they would all lie the same way and read as a comb.
    const emitter = disc(
      2,
      { radius: 1, radiusThickness: 0 },
      {
        mode: "stretched" as const,
        lengthScale: 4,
        speed: 5,
        size: { x: 0.2, y: 1 },
        random: sequence([0, 0, 0.5, 0]),
      },
    );
    emitter.update(1 / 60, VIEW);
    const first = quadOf(emitter.mesh, 0).map(([x]) => x);
    const second = quadOf(emitter.mesh, 1).map(([x]) => x);
    // Born at x = 1 heading +X: the head stays on the particle and the four
    // units of trail hang back the way it came.
    expect(Math.max(...first)).toBeCloseTo(1, 5);
    expect(Math.min(...first)).toBeCloseTo(-3, 5);
    // And the one on the far side of the ring is the mirror of it.
    expect(Math.min(...second)).toBeCloseTo(-1, 5);
    expect(Math.max(...second)).toBeCloseTo(3, 5);
  });

  it("emits the circle rather than the box when a caller passes both", () => {
    // `_shapeType` is one value, so an emitter is one shape. Combining them
    // would be inventing a shape Cocos does not have.
    const emitter = disc(
      1,
      { radius: 1, radiusThickness: 0 },
      {
        box: { x: 100, y: 100, z: 100 },
        direction: { x: 0, y: 0, z: -1 },
        speed: 7,
        random: sequence([0, 0]),
      },
    );
    emitter.update(1 / 60, VIEW);
    // Exactly on the rim, so the box drew nothing and moved nothing.
    expect(pointsOf(emitter, 1)[0].map(round)).toEqual([1, 0, 0]);
    const [going] = velocitiesOf(emitter, 1, 0.5);
    expect(going[0]).toBeCloseTo(7, 5);
    expect(going[2]).toBeCloseTo(0, 5);
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

/** Which way up a billboard sprite lands, measured on SCREEN.
 *
 * Every other geometry test here reads extents — the width, the height, which
 * axis is flat — and an extent is blind to a half turn. That is the gap this
 * closes, and the gap is not hypothetical: the quad's basis used to point
 * camera-LEFT, which turned every billboard sprite a half circle about the
 * view axis. Reported from a consumer as "the hearts are upside down"; nobody
 * saw it on the sparks, the snow or the ring bursts, because a half turn of a
 * radially symmetric sheet is the same sheet.
 *
 * So this projects the corners onto a screen basis built INDEPENDENTLY of the
 * emitter — an ordinary look-at from the camera position — and asks where the
 * texture's top-left texel came out. It is checked from four camera positions
 * including one off-axis, because a single camera on an axis can be right for
 * the wrong reason.
 */
describe("which way up a sprite lands", () => {
  /** Screen right and up for a camera at `eye` looking at the origin, y-up.
   *  Deliberately hand-rolled rather than taken from the emitter. */
  function screenBasis(eye: [number, number, number]) {
    const length = Math.hypot(...eye) || 1;
    // Forward is towards the origin, so it is the negated eye.
    const forward: [number, number, number] = [
      -eye[0] / length,
      -eye[1] / length,
      -eye[2] / length,
    ];
    // `cross(worldUp, -forward)`, the x axis an ordinary look-at builds.
    const right: [number, number, number] = [-forward[2], 0, forward[0]];
    const rightLength = Math.hypot(right[0], right[2]) || 1;
    right[0] /= rightLength;
    right[2] /= rightLength;
    const up: [number, number, number] = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    return { right, up };
  }

  /** Each corner as `{ u, v, screenX, screenY }` for a camera at `eye`. */
  function cornersOnScreen(eye: [number, number, number], turn = false) {
    const emitter = createEmitter({
      rate: 1000,
      lifetime: 10,
      capacity: 1,
      size: { x: 2, y: 2 },
      sheet: { columns: 4, rows: 4 },
      random: middle,
    });
    emitter.update(1 / 60, { x: eye[0], y: eye[1], z: eye[2] });
    const { right, up } = screenBasis(eye);
    const mesh = emitter.mesh;
    const out: { u: number; v: number; screenX: number; screenY: number }[] = [];
    for (let corner = 0; corner < 4; corner++) {
      const p = corner * 3;
      const t = corner * 2;
      const point = [mesh.positions[p], mesh.positions[p + 1], mesh.positions[p + 2]];
      const screenX = point[0] * right[0] + point[1] * right[1] + point[2] * right[2];
      const screenY = point[0] * up[0] + point[1] * up[1] + point[2] * up[2];
      // The frozen control: a half turn about the view axis is exactly the old
      // basis, and it must fail every assertion below.
      out.push({
        u: mesh.uvs[t],
        v: mesh.uvs[t + 1],
        screenX: turn ? -screenX : screenX,
        screenY: turn ? -screenY : screenY,
      });
    }
    return out;
  }

  const EYES: [number, number, number][] = [
    [0, 0, 30],
    [30, 0, 0],
    [0, 0, -30],
    [12, 9, 20],
  ];

  it("puts the texture's top-left texel at the top left of the screen", () => {
    for (const eye of EYES) {
      for (const corner of cornersOnScreen(eye)) {
        // A 4x4 sheet on a fresh particle is cell (0, 0), so u and v are each
        // either 0 (left/top of the cell) or 0.25 (right/bottom of it).
        expect(corner.u === 0 || corner.u === 0.25).toBe(true);
        expect(corner.v === 0 || corner.v === 0.25).toBe(true);
        // Low u is screen-left; low v is the top of the texture, so it must be
        // screen-UP. Both signs, from every camera.
        expect(Math.sign(corner.screenX)).toBe(corner.u === 0 ? -1 : 1);
        expect(Math.sign(corner.screenY)).toBe(corner.v === 0 ? 1 : -1);
      }
    }
  });

  it("fails the same check on a quad turned half a circle", () => {
    // The control. Without this the test above would pass just as happily
    // against a basis nobody had checked, which is how the half turn shipped.
    let wrong = 0;
    for (const eye of EYES) {
      for (const corner of cornersOnScreen(eye, true)) {
        if (Math.sign(corner.screenX) !== (corner.u === 0 ? -1 : 1)) wrong++;
        if (Math.sign(corner.screenY) !== (corner.v === 0 ? 1 : -1)) wrong++;
      }
    }
    // Four cameras, four corners, both axes.
    expect(wrong).toBe(EYES.length * 4 * 2);
  });

  it("draws a vertical quad upright and the right way round", () => {
    // `vertical` shares the horizontal axis with `billboard` but takes world up
    // rather than deriving one, so the same mirrored axis did not turn it over
    // — it drew every sprite back to front instead. Both halves are pinned:
    // low v is world-UP, and low u is screen-LEFT.
    for (const eye of EYES) {
      const emitter = createEmitter({
        rate: 1000,
        lifetime: 10,
        capacity: 1,
        mode: "vertical",
        size: { x: 2, y: 2 },
        sheet: { columns: 4, rows: 4 },
        random: middle,
      });
      emitter.update(1 / 60, { x: eye[0], y: eye[1], z: eye[2] });
      const { right } = screenBasis(eye);
      const mesh = emitter.mesh;
      for (let corner = 0; corner < 4; corner++) {
        const p = corner * 3;
        const y = mesh.positions[p + 1];
        const screenX =
          mesh.positions[p] * right[0] +
          mesh.positions[p + 1] * right[1] +
          mesh.positions[p + 2] * right[2];
        const u = mesh.uvs[corner * 2];
        const v = mesh.uvs[corner * 2 + 1];
        expect(Math.sign(y)).toBe(v === 0 ? 1 : -1);
        expect(Math.sign(screenX)).toBe(u === 0 ? -1 : 1);
      }
    }
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

describe("sizeOverTime", () => {
  /** The width of the first particle's quad, which is the pair of x extents
   *  the billboard writer lays down. */
  function width(emitter: { mesh: { positions: Float32Array | number[] } }): number {
    const p = emitter.mesh.positions;
    let low = Infinity;
    let high = -Infinity;
    for (let vertex = 0; vertex < 4; vertex++) {
      low = Math.min(low, p[vertex * 3]!);
      high = Math.max(high, p[vertex * 3]!);
    }
    return high - low;
  }

  function popping(curve: (t: number) => number) {
    return createEmitter({
      rate: 0,
      lifetime: 1,
      capacity: 1,
      speed: 0,
      size: { x: 2, y: 2 },
      bursts: [{ time: 0, count: 1 }],
      duration: 10,
      loop: false,
      sizeOverTime: (t, out) => {
        out.x = curve(t);
        out.y = curve(t);
        out.z = curve(t);
      },
      random: middle,
    });
  }

  it("scales the authored size rather than replacing it", () => {
    // Half of an authored 2 is 1, so the curve is a MULTIPLIER — which is how
    // every authoring tool stores it, and the reason `size` still means the
    // particle's full size.
    const emitter = popping(() => 0.5);
    emitter.update(1 / 60, VIEW);
    expect(width(emitter)).toBeCloseTo(1, 5);
  });

  it("is sampled again every frame, not once at birth", () => {
    // The whole difference between this and `size`: a pop-in that was sampled
    // at birth would draw its first frame's size for the particle's whole life.
    const emitter = popping((t) => t);
    emitter.update(0.1, VIEW);
    const early = width(emitter);
    for (let step = 0; step < 5; step++) emitter.update(0.1, VIEW);
    expect(width(emitter)).toBeGreaterThan(early * 3);
  });

  it("leaves the size alone when nothing is passed", () => {
    const emitter = createEmitter({
      rate: 0,
      lifetime: 1,
      capacity: 1,
      speed: 0,
      size: { x: 2, y: 2 },
      bursts: [{ time: 0, count: 1 }],
      duration: 10,
      loop: false,
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect(width(emitter)).toBeCloseTo(2, 5);
  });

  it("scales each axis on its own", () => {
    // Separate axes are authored — a burst that stretches as it rises — so one
    // curve per axis rather than one scalar for all three.
    const emitter = createEmitter({
      rate: 0,
      lifetime: 1,
      capacity: 1,
      speed: 0,
      size: { x: 2, y: 2 },
      bursts: [{ time: 0, count: 1 }],
      duration: 10,
      loop: false,
      sizeOverTime: (_t, out) => {
        out.x = 0.5;
        out.y = 2;
        out.z = 1;
      },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    const p = emitter.mesh.positions;
    let lowY = Infinity;
    let highY = -Infinity;
    for (let vertex = 0; vertex < 4; vertex++) {
      lowY = Math.min(lowY, p[vertex * 3 + 1]!);
      highY = Math.max(highY, p[vertex * 3 + 1]!);
    }
    expect(width(emitter)).toBeCloseTo(1, 5);
    expect(highY - lowY).toBeCloseTo(4, 5);
  });
});

describe("colorOverTime", () => {
  /** The first particle's vertex colour. Uniform across the four corners, so
   *  one corner is the whole answer — and the test that says so is below. */
  function rgba(emitter: { mesh: { colors?: Float32Array } }, corner = 0): number[] {
    const c = emitter.mesh.colors!;
    return [c[corner * 4], c[corner * 4 + 1], c[corner * 4 + 2], c[corner * 4 + 3]];
  }

  function fading(curve?: (t: number) => number) {
    return createEmitter({
      rate: 0,
      lifetime: 1,
      capacity: 1,
      speed: 0,
      size: { x: 2, y: 2 },
      bursts: [{ time: 0, count: 1 }],
      duration: 10,
      loop: false,
      color: [1, 0.5, 0.25, 1],
      ...(curve
        ? {
            colorOverTime: (t: number, out: { r: number; g: number; b: number; a: number }) => {
              out.r = curve(t);
              out.g = curve(t);
              out.b = curve(t);
              out.a = curve(t);
            },
          }
        : {}),
      random: middle,
    });
  }

  it("scales the authored colour rather than replacing it", () => {
    // Half of an authored (1, 0.5, 0.25, 1) is (0.5, 0.25, 0.125, 0.5), so the
    // curve is a MULTIPLIER over `color` — the shape every authoring tool stores
    // a colour-over-lifetime in, and `sizeOverTime`'s bargain exactly.
    const emitter = fading(() => 0.5);
    emitter.update(1 / 60, VIEW);
    expect(rgba(emitter)).toEqual([0.5, 0.25, 0.125, 0.5]);
  });

  it("is sampled again every frame, not once at birth", () => {
    // The whole difference between this and `color`: an alpha fade sampled at
    // birth would hold its first frame's opacity for the particle's whole life,
    // which is the ring of hard beads this was written for.
    const emitter = fading((t) => 1 - t);
    emitter.update(0.1, VIEW);
    // The burst fires on the first update, after the ageing pass, so that frame
    // is age 0 and each later one adds 0.1 of the 1 s life.
    const early = rgba(emitter)[3]!;
    for (let step = 0; step < 7; step++) emitter.update(0.1, VIEW);
    const late = rgba(emitter)[3]!;
    expect(early).toBeCloseTo(1, 5);
    expect(late).toBeCloseTo(0.3, 5);
  });

  it("leaves the colour alone when nothing is passed", () => {
    const emitter = fading();
    emitter.update(1 / 60, VIEW);
    expect(rgba(emitter)).toEqual([1, 0.5, 0.25, 1]);
    for (let step = 0; step < 10; step++) emitter.update(1 / 60, VIEW);
    expect(rgba(emitter)).toEqual([1, 0.5, 0.25, 1]);
  });

  it("scales each channel on its own, on every corner of the quad", () => {
    // Alpha is the channel a fade usually lives in, and an authored gradient can
    // cool a spark's colour as well — so one curve per channel rather than one
    // opacity. All four corners carry it: a colour that varied per corner would
    // draw a gradient across the sprite.
    const emitter = createEmitter({
      rate: 0,
      lifetime: 1,
      capacity: 1,
      speed: 0,
      size: { x: 2, y: 2 },
      bursts: [{ time: 0, count: 1 }],
      duration: 10,
      loop: false,
      colorOverTime: (_t, out) => {
        out.r = 1;
        out.g = 0.5;
        out.b = 0.25;
        out.a = 0.125;
      },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    for (let corner = 0; corner < 4; corner++) {
      expect(rgba(emitter, corner)).toEqual([1, 0.5, 0.25, 0.125]);
    }
  });

  it("follows the particle into its place in the batch as others die", () => {
    // Colours are written at the COMPACTED index, the same one the geometry goes
    // to, and the write loop skips dead slots. A curve indexed by slot instead
    // would hand a live particle a dead one's colour the moment the batch
    // shuffled — which is a flicker, not an offset.
    const emitter = createEmitter({
      rate: 0,
      lifetime: [0.05, 1],
      capacity: 4,
      speed: 0,
      size: { x: 1, y: 1 },
      bursts: [{ time: 0, count: 2 }],
      duration: 10,
      loop: false,
      // Full alpha for the first tenth of a life, then nothing. Whoever is left
      // alive is young enough to be bright, so a stale colour shows as a zero.
      colorOverTime: (t, out) => {
        out.r = 1;
        out.g = 1;
        out.b = 1;
        out.a = t < 0.1 ? 1 : 0;
      },
      random: () => 0.999,
    });
    emitter.update(0.02, VIEW);
    expect(emitter.alive).toBe(2);
    expect(rgba(emitter)[3]).toBe(1);
    expect(rgba(emitter, 4)[3]).toBe(1);
  });

  it("multiplies an authored mesh's own vertex colours", () => {
    // A mesh particle's colours are its geometry's, times `color`, times this.
    // Both writers therefore need it, which is why it is applied in the write
    // loop rather than inside either one.
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      colors: new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1]),
      indices: new Uint16Array([0, 1, 2]),
    };
    const emitter = createEmitter({
      rate: 0,
      lifetime: 1,
      capacity: 1,
      speed: 0,
      size: { x: 1, y: 1 },
      bursts: [{ time: 0, count: 1 }],
      duration: 10,
      loop: false,
      mode: "mesh",
      mesh,
      color: [1, 1, 1, 1],
      colorOverTime: (_t, out) => {
        out.r = 1;
        out.g = 1;
        out.b = 1;
        out.a = 0.5;
      },
      random: middle,
    });
    emitter.update(1 / 60, VIEW);
    expect(rgba(emitter, 0)).toEqual([1, 1, 1, 0.5]);
    expect(rgba(emitter, 1)).toEqual([0.5, 0.5, 0.5, 0.25]);
  });
});
