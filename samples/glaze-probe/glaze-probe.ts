/** A cube probe of six differently coloured walls, and a glazed floor under it.
 *
 * **What this harness is for.** A cube probe is one convention split across two
 * places — `cubeProbeViews` writes the six faces, `glazeEnvUv` reads them — and a
 * mismatch in either half looks exactly like a bug in the other. Nothing about it
 * is visible in a screenshot of a scene: a reflection with two faces swapped is
 * still a plausible-looking reflection. So the scene is built with a DIFFERENT
 * FLAT COLOUR on each of the six sides, which turns both halves into a question
 * with one right answer per direction.
 *
 * The colours, and why these six: each is unmistakable in one channel pair, so a
 * cell can be named from its bytes without modelling a light.
 *
 *     +X red      -X yellow     +Y cyan
 *     -Y green    +Z blue       -Z magenta
 *
 * **None of them is grey**, and that is the point of the list rather than an
 * aesthetic: the faked gradient the probe REPLACES is the tint times a scalar, so
 * with a white tint it is grey. A white wall anywhere in this room would make "the
 * probe was ignored" and "the probe was read" the same reading.
 *
 * Two things are then measured, and they fail independently:
 *
 *  - **The atlas** — `cells` reports the colour at the middle of each of the six
 *    rectangles `cubeProbeViews` filled. That is the capture side alone, with no
 *    shader involved, so a wrong face order or a flipped face shows up here.
 *  - **The reflection** — `floor` reports the glazed plane, lit by nothing, with
 *    a white tint and no ripple or sparkle, so what lands on it is the probe and
 *    the Fresnel and nothing else. A camera low over the floor looking along -Z
 *    reflects the wall BEHIND it, which is the one direction that tells a correct
 *    lookup from a mirrored one.
 */

import {
  addNode,
  box,
  createCamera,
  createRenderer3D,
  createScene,
  cubeProbeViews,
  node,
  updateWorldMatrices,
} from "minimotor/3d";
import type { Backend3D } from "minimotor/3d";

const params = new URLSearchParams(location.search);
const wanted = params.get("backend");
const backend: Backend3D | "auto" = wanted === "webgl2" || wanted === "webgpu" ? wanted : "webgl2";

const canvas = document.createElement("canvas");
canvas.id = "glaze-probe";
document.body.append(canvas);

const renderer = await createRenderer3D({ backend, canvas, antialias: false });
const CANVAS_SIZE = 128;
renderer.resize(CANVAS_SIZE, CANVAS_SIZE, 1);

/** One face per side of the atlas. 48 keeps the whole probe at 144x96. */
const FACE = 48;

const scene = createScene({
  // Black, so any colour in the probe came from a wall rather than from the sky.
  background: [0, 0, 0, 1],
  // No lights at all: `unlit` walls need none, and the glaze's light lobe is
  // gated on the light count, so this removes the one term that would add a
  // colour of its own to the reflection.
  lights: [],
  ambient: [1, 1, 1],
});

/** A wall of one flat colour, `SPAN` across, `OUT` from the middle.
 *
 * Wider than the room is deep on purpose: a 90-degree face at distance `OUT` sees
 * exactly `2 * OUT` across, so a wall only that wide puts the NEIGHBOURING walls'
 * edges right at the face's border and bleeds them into a reading near it. At 44
 * across, the middle of every face is one flat colour with room to spare —
 * MEASURED: the steep reflection read [92, 157, 157] before this, cyan with the
 * red wall's top edge in it. */
const wall = (
  name: string,
  at: { x: number; y: number; z: number },
  size: { x: number; y: number; z: number },
  color: [number, number, number, number],
) =>
  addNode(
    scene,
    node({
      name,
      mesh: box(size.x, size.y, size.z),
      position: at,
      material: { color, unlit: true },
    }),
  );

const SPAN = 44;
const OUT = 10;
const THIN = 0.5;
wall("px", { x: OUT, y: 0, z: 0 }, { x: THIN, y: SPAN, z: SPAN }, [1, 0, 0, 1]);
wall("nx", { x: -OUT, y: 0, z: 0 }, { x: THIN, y: SPAN, z: SPAN }, [1, 1, 0, 1]);
wall("py", { x: 0, y: OUT, z: 0 }, { x: SPAN, y: THIN, z: SPAN }, [0, 1, 1, 1]);
wall("ny", { x: 0, y: -OUT, z: 0 }, { x: SPAN, y: THIN, z: SPAN }, [0, 1, 0, 1]);
wall("pz", { x: 0, y: 0, z: OUT }, { x: SPAN, y: SPAN, z: THIN }, [0, 0, 1, 1]);
wall("nz", { x: 0, y: 0, z: -OUT }, { x: SPAN, y: SPAN, z: THIN }, [1, 0, 1, 1]);

updateWorldMatrices(scene);

// **The probe, filled once.** Six renders from the middle of the room, `clear` on
// the first face only — a clear covers the whole destination rather than the
// rectangle, so clearing on each would leave nothing but the last face.
const probe = renderer.createTarget(FACE * 3, FACE * 2);
const views = cubeProbeViews(probe, { x: 0, y: 0, z: 0 }, { near: 0.05, far: 100 });
views.forEach(({ camera, viewport }, face) => {
  renderer.render(scene, camera, { target: probe, viewport, clear: face === 0 });
});
const atlas = await probe.readPixels();

const pixelAt = (data: Uint8Array, width: number, x: number, y: number): number[] => {
  const at = (y * width + x) * 4;
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!];
};

/** The middle of one atlas cell, in the order `cubeProbeViews` fills them. */
const cellAt = (index: number): number[] =>
  pixelAt(
    atlas,
    FACE * 3,
    (index % 3) * FACE + (FACE >> 1),
    Math.floor(index / 3) * FACE + (FACE >> 1),
  );

// **The floor, glazed with the probe.** A separate scene so the walls do not
// stand between the camera and it, and so nothing but the plane is in frame.
const floorScene = createScene({
  background: [0, 0, 0, 1],
  lights: [],
  ambient: [1, 1, 1],
});
addNode(
  floorScene,
  node({
    name: "floor",
    mesh: box(60, 0.2, 60),
    position: { x: 0, y: -1, z: 0 },
    material: {
      // Black, so the reflection is the whole of what shows: the coat is ADDED
      // to the shaded surface, and an albedo of nothing leaves only the coat.
      color: [0, 0, 0, 1],
      glaze: {
        strength: 1,
        // A white tint multiplies the probe by one, so a colour read off this
        // floor is a colour that came out of the atlas.
        tint: [1, 1, 1],
        // Flat: a ripple would tilt the normal and bend the reflected ray, which
        // is exactly the arithmetic under test.
        ripple: 0,
        sparkle: 0,
        // Low, so the coat is visible at the middle of the frame rather than only
        // at the silhouette — this is a measurement, not a look.
        fresnel: 1,
        environment: probe,
      },
    },
  }),
);
updateWorldMatrices(floorScene);

// Low over the floor looking along -Z. The reflected ray carries ON in the
// direction of view and turns UPWARD — `reflect(-toEye, up)` — so it leaves
// towards -Z and the magenta wall, and a lookup that mirrored Z would answer
// blue. Which way round that is was MEASURED here rather than reasoned about; the
// first version of this comment had it backwards.
const floorCamera = createCamera({
  target: { x: 0, y: -1, z: -6 },
  distance: 6,
  yaw: 0,
  pitch: 0.28,
  fov: Math.PI / 3,
  near: 0.05,
  far: 200,
});
renderer.render(floorScene, floorCamera);

/** The floor seen from one camera, as the colour at the middle of the floor. */
function floorFrom(camera: Parameters<typeof renderer.render>[1], at: number): number[] {
  renderer.render(floorScene, camera);
  const shot = document.createElement("canvas");
  shot.width = renderer.renderWidth;
  shot.height = renderer.renderHeight;
  const context = shot.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0);
  const data = context.getImageData(0, 0, shot.width, shot.height).data;
  const index = (Math.floor(shot.height * at) * shot.width + (shot.width >> 1)) * 4;
  return [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!];
}

// **Three directions, three different faces.** One reading cannot tell a correct
// lookup from one stuck on a single face, and the two axes are separate mistakes:
// a swapped pair of rows shows up in the vertical, a mirrored axis in the
// horizontal. Each of these reflects a wall of its own colour.
//
// Nearly straight down: the reflected ray goes nearly straight up, at the CYAN
// ceiling. This is the reading that was wrong before the row flip.
const steepReading = floorFrom(
  createCamera({
    target: { x: 0, y: -1, z: 0 },
    distance: 8,
    yaw: 0,
    pitch: 1.45,
    fov: Math.PI / 3,
    near: 0.05,
    far: 200,
  }),
  0.5,
);
// Along -X, low: the reflected ray carries on towards -X, at the YELLOW wall, and
// the twin below looks the other way for the RED one. Both signs of one axis,
// because a mirrored axis passes any test that only looks one way down it —
// MEASURED the hard way: the first version of this camera had the yaw's sign
// wrong, looked at +X, and read red while the comment claimed yellow.
const sidewaysReading = floorFrom(
  createCamera({
    target: { x: -6, y: -1, z: 0 },
    distance: 6,
    yaw: Math.PI / 2,
    pitch: 0.28,
    fov: Math.PI / 3,
    near: 0.05,
    far: 200,
  }),
  0.72,
);

const sidewaysBackReading = floorFrom(
  createCamera({
    target: { x: 6, y: -1, z: 0 },
    distance: 6,
    yaw: -Math.PI / 2,
    pitch: 0.28,
    fov: Math.PI / 3,
    near: 0.05,
    far: 200,
  }),
  0.72,
);

// **The same floor with NO probe**, which is the control every colour in this room
// was chosen to make possible: the term a probe replaces is the tint times a
// scalar, so with a white tint it is grey, and a white or grey wall anywhere would
// make "the probe was read" and "the probe was ignored" the same reading.
const floorNode = floorScene.nodes.find((candidate) => candidate?.name === "floor")!;
floorNode.material!.glaze = { ...floorNode.material!.glaze!, environment: undefined };
const gradientReading = floorFrom(floorCamera, 0.72);
floorNode.material!.glaze = { ...floorNode.material!.glaze!, environment: probe };

// **The -Z camera again, because the three readings above each drew over the
// canvas.** `column`, `low` and `far` are read off the frame below, and without
// this they would report the LAST camera's answer under the first one's name —
// MEASURED: the column came back red, which is the +X camera's reflection.
renderer.render(floorScene, floorCamera);

const readback = document.createElement("canvas");
readback.width = renderer.renderWidth;
readback.height = renderer.renderHeight;
const rb = readback.getContext("2d", { willReadFrequently: true })!;
rb.drawImage(canvas, 0, 0);
const frame = rb.getImageData(0, 0, readback.width, readback.height).data;
const framePixel = (x: number, y: number): number[] => {
  const at = (y * readback.width + x) * 4;
  return [frame[at]!, frame[at + 1]!, frame[at + 2]!, frame[at + 3]!];
};

window.__glazeProbe = {
  ready: true,
  backend: renderer.backend,
  atlas: { width: probe.width, height: probe.height, bytes: atlas.length },
  cells: [0, 1, 2, 3, 4, 5].map((index) => cellAt(index)),
  gradient: gradientReading,
  floor: {
    // A column down the middle of the frame, near to far. The reflected ray
    // starts nearly vertical under the camera and lies down as the surface
    // recedes, so a correct lookup walks from the ceiling to the far wall — and
    // a lookup stuck on one face shows the same colour all the way down.
    column: [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((at) =>
      framePixel(CANVAS_SIZE >> 1, Math.floor(CANVAS_SIZE * at)),
    ),
    // Two thirds down the frame, which is floor rather than the black beyond it.
    low: framePixel(CANVAS_SIZE >> 1, Math.floor(CANVAS_SIZE * 0.72)),
    steep: steepReading,
    sideways: sidewaysReading,
    sidewaysBack: sidewaysBackReading,
    // Just below the horizon, where the grazing angle is highest.
    far: framePixel(CANVAS_SIZE >> 1, Math.floor(CANVAS_SIZE * 0.52)),
  },
};

declare global {
  interface Window {
    __glazeProbe?: {
      ready: boolean;
      backend: string;
      atlas: { width: number; height: number; bytes: number };
      cells: number[][];
      gradient: number[];
      floor: {
        column: number[][];
        steep: number[];
        sideways: number[];
        sidewaysBack: number[];
        low: number[];
        far: number[];
      };
    };
  }
}
