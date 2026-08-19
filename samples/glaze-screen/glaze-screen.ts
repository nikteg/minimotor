/** A glazed surface reflecting what is standing in front of it, out of last
 *  frame's screen.
 *
 * **What this harness is for.** `Glaze.screen` is two conventions meeting: which
 * way a reflected ray runs across the SCREEN, and which way up the snapshot
 * `Renderer3D.captureFrame` hands back is stored. Both are invisible in a
 * screenshot of a scene — a reflection whose x is mirrored is still a plausible
 * reflection, and one whose v is flipped taps somewhere else entirely and just
 * looks like a surface with a duller reflection. So each convention gets a scene
 * built to make its OWN wrong answer land on a different colour:
 *
 *  - **The floor**, for the vertical. Two short pillars stand on it and a wide
 *    BLUE panel fills the top of the frame above them. A floor fragment taps
 *    UPWARD into a pillar; the same tap with v flipped starts in the mirrored
 *    half of the frame and lands in the blue instead.
 *  - **The wall**, for the lateral. A vertical glazed plane, with a magenta panel
 *    standing in front of its left half and a green one in front of its right.
 *    A mirror keeps a lateral direction and flips only the one it faces along, so
 *    the ray off the left half of the wall runs LEFT: the left half must answer
 *    magenta, and a mirrored x answers green.
 *
 * The first version of this file had only the floor, and MEASURED nothing: with
 * two tall pillars and no sky, flipping v landed the tap on the same pillar it
 * was already on and mirroring x moved it a couple of pixels along a ray that is
 * nearly vertical on screen. Three tests passed under both mutations. The
 * geometry is the measurement here, not the assertions.
 *
 * **Every floor reading is a PAIR**, taken at the same pixel from the same
 * camera: once with the snapshot bound and once without. The control is what says
 * a pixel is floor rather than pillar — a pillar is its own colour in both frames
 * — so nothing here has to predict where a silhouette ends on screen.
 */

import {
  addNode,
  box,
  createCamera,
  createRenderer3D,
  createScene,
  node,
  updateWorldMatrices,
} from "minimotor/3d";
import type { Camera3D, Backend3D, Material, RenderTarget3D, Scene3D } from "minimotor/3d";

const params = new URLSearchParams(location.search);
const wanted = params.get("backend");
const backend: Backend3D | "auto" = wanted === "webgl2" || wanted === "webgpu" ? wanted : "webgl2";

const canvas = document.createElement("canvas");
canvas.id = "glaze-screen";
document.body.append(canvas);

// `antialias: false` because the snapshot is a 1:1 resolve of the drawing buffer
// — see captureFrame — and a single-sampled buffer is the simplest thing for a
// measurement to reason about.
const renderer = await createRenderer3D({ backend, canvas, antialias: false });
const SIZE = 128;
renderer.resize(SIZE, SIZE, 1);

const MAGENTA: [number, number, number, number] = [1, 0, 1, 1];
const GREEN: [number, number, number, number] = [0, 1, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];

/** The coat under test: flat, untinted, and nothing in it but the reflection.
 *
 * `ripple` and `sparkle` at zero because a ripple tilts the normal and bends the
 * reflected ray, which is the arithmetic being measured. A black albedo because
 * the coat is ADDED to the shaded surface, so a surface of nothing leaves only
 * the coat.
 *
 * **The Fresnel exponent is high on purpose.** At a grazing angle every
 * reflection is strong whatever its strength setting says, so a flat coat is the
 * one place `screenStrength` cannot be measured — MEASURED: at an exponent of 1
 * this camera reads 224 of 255 at a strength of 0.12. A sharp exponent puts these
 * fragments well away from grazing, where the setting is what decides. It costs
 * the other readings nothing: they are all taken at full strength, where the
 * weight is 1 at every angle. */
const coat = (): Material => ({
  color: [0, 0, 0, 1],
  glaze: {
    strength: 1,
    tint: [1, 1, 1],
    ripple: 0,
    sparkle: 0,
    fresnel: 6,
    screenStrength: 1,
    screenReach: 0.14,
  },
});

/** A room with no lights: the coat's light lobe is gated on the light count, so
 *  this removes the one term that would add a colour of its own. Black behind
 *  everything, so a colour on a glazed surface came off a panel. */
const room = (): Scene3D =>
  createScene({ background: [0, 0, 0, 1], lights: [], ambient: [1, 1, 1] });

const flat = (
  scene: Scene3D,
  name: string,
  mesh: ReturnType<typeof box>,
  at: { x: number; y: number; z: number },
  color: [number, number, number, number],
) => addNode(scene, node({ name, mesh, position: at, material: { color, unlit: true } }));

const readback = document.createElement("canvas");
readback.width = SIZE;
readback.height = SIZE;
const context = readback.getContext("2d", { willReadFrequently: true })!;

/** Renders, then copies the canvas off so the next render cannot overwrite it. */
function shoot(scene: Scene3D, camera: Camera3D): Uint8ClampedArray {
  renderer.render(scene, camera);
  context.clearRect(0, 0, SIZE, SIZE);
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, SIZE, SIZE).data;
}

const pixel = (data: Uint8ClampedArray, x: number, y: number): number[] => {
  const at = (Math.floor(SIZE * y) * SIZE + Math.floor(SIZE * x)) * 4;
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!];
};

// ---------------------------------------------------------------- the floor

const floorScene = room();
const floorMaterial = coat();
addNode(
  floorScene,
  node({
    name: "floor",
    mesh: box(80, 0.2, 80),
    position: { x: 0, y: -0.1, z: 0 },
    material: floorMaterial,
  }),
);
// SHORT pillars, so what stands on the floor occupies a narrow band of the frame
// and the blue above it is somewhere a wrong tap can land.
flat(floorScene, "magenta", box(2.4, 1.1, 1.4), { x: -2.2, y: 0.55, z: -6 }, MAGENTA);
flat(floorScene, "green", box(2.4, 1.1, 1.4), { x: 2.2, y: 0.55, z: -6 }, GREEN);
// The sky: wide and high, filling the frame above the pillars. Blue rather than
// black because a wrong tap has to land on a COLOUR — black is what an empty
// frame already reads, and "the tap went nowhere" and "the tap went wrong" would
// be the same answer.
flat(floorScene, "sky", box(60, 24, 0.2), { x: 0, y: 13.5, z: -14 }, BLUE);
updateWorldMatrices(floorScene);

// Low over the floor looking along -Z, with the pillars just above the middle of
// the frame and the floor between them and the camera filling the bottom — which
// is where a reflection of something standing on it has to appear.
const floorCamera = createCamera({
  target: { x: 0, y: -1.1, z: -3.4 },
  distance: 7,
  yaw: 0,
  pitch: 0.26,
  fov: Math.PI / 3,
  near: 0.05,
  far: 200,
});

/** Columns across and rows down the floor, and a reach that lands on a pillar.
 *
 * MEASURED off this scene rather than worked out from the field of view. Down a
 * column through the left pillar the frame reads blue to 0.21, PILLAR from 0.24 to
 * 0.34, and floor from 0.36 down. So a floor row at 0.44 with a reach of 0.14 taps
 * into the pillar at 0.30.
 *
 * **Why the pillars are high in the frame and not across the middle.** Every wrong
 * answer this measures has to land somewhere else, and a vertical flip of the tap
 * is a MIRROR about the middle of the frame: with the band across the centre, the
 * flipped tap lands back on the same pillar and the mutation changes no reading.
 * That version of this file existed and passed. High in the frame, the flipped tap
 * from 0.44 goes to 0.70 instead — plain floor.
 *
 * The two middle columns fall between the pillars, where an upward tap finds only
 * more floor. They are here because a grid that samples only where the answer is
 * known is a weaker measurement than one that does not. */
const COLUMNS = [0.22, 0.28, 0.36, 0.48, 0.52, 0.64, 0.72, 0.78];
const ROWS = [0.4, 0.44, 0.47];

interface Cell {
  x: number;
  y: number;
  with: number[];
  without: number[];
}

function floorGrid(snapshot: RenderTarget3D | undefined): number[][] {
  floorMaterial.glaze!.screen = snapshot;
  const data = shoot(floorScene, floorCamera);
  const out: number[][] = [];
  for (const y of ROWS) for (const x of COLUMNS) out.push(pixel(data, x, y));
  return out;
}

// **The first frame is the snapshot's whole content**, and it is taken with no
// snapshot bound: there is nothing to reflect yet, which is the state a game's
// first frame is in too.
renderer.render(floorScene, floorCamera);
const floorSnapshot = renderer.captureFrame() ?? undefined;

const without = floorGrid(undefined);
const withScreen = floorGrid(floorSnapshot);

// **The tap walked off the frame.** Four screen widths cannot land anywhere in
// the picture, so every cell should fall back to the faked gradient and read the
// control. This is the half of the blend that keeps a horizon from going black,
// and it fails independently of the direction.
floorMaterial.glaze!.screenReach = 4;
const farReach = floorGrid(floorSnapshot);
floorMaterial.glaze!.screenReach = 0.14;

// **The same grid at a low strength.** How much of the reflection shows head-on
// is the one number a player is given — see Glaze.screenStrength — and it has to
// be more than a name: a first version of the shader took the LARGER of this
// weight and the faked sky's own 0.25 floor, which left every strength under a
// quarter doing nothing at all.
floorMaterial.glaze!.screenStrength = 0.12;
const dim = floorGrid(floorSnapshot);
floorMaterial.glaze!.screenStrength = 1;

const cells: Cell[] = [];
let index = 0;
for (const y of ROWS) {
  for (const x of COLUMNS) {
    cells.push({ x, y, with: withScreen[index]!, without: without[index]! });
    index++;
  }
}

// ---------------------------------------------------------------- the wall

// A vertical glazed plane facing the camera, for the LATERAL convention. A
// mirror keeps a lateral direction and flips only the one it faces along, so the
// ray off the left half of this wall runs left, at whatever stands in front of
// the wall's left half.
const wallScene = room();
const wallMaterial = coat();
addNode(
  wallScene,
  node({
    name: "wall",
    mesh: box(60, 30, 0.2),
    position: { x: 0, y: 0, z: -10 },
    material: wallMaterial,
  }),
);
flat(wallScene, "magenta", box(2.6, 5, 0.2), { x: -2.6, y: 0, z: -6 }, MAGENTA);
flat(wallScene, "green", box(2.6, 5, 0.2), { x: 2.6, y: 0, z: -6 }, GREEN);
updateWorldMatrices(wallScene);

const wallCamera = createCamera({
  target: { x: 0, y: 0, z: -6 },
  distance: 6,
  yaw: 0,
  pitch: 0,
  fov: Math.PI / 3,
  near: 0.05,
  far: 200,
});

/** Where the WALL shows, which is the gap between the two panels — MEASURED at
 *  0.31 to 0.69 across, since each panel covers a third of the frame from its own
 *  edge inward. A reach of 0.14 from 0.40 lands at 0.26, on the magenta panel,
 *  and mirroring x lands at 0.54, on the wall's own dark face. */
const WALL_POINTS = [
  { x: 0.36, y: 0.42 },
  { x: 0.4, y: 0.5 },
  { x: 0.4, y: 0.58 },
  { x: 0.6, y: 0.42 },
  { x: 0.6, y: 0.5 },
  { x: 0.64, y: 0.58 },
];

function wallReadings(snapshot: RenderTarget3D | undefined): number[][] {
  wallMaterial.glaze!.screen = snapshot;
  const data = shoot(wallScene, wallCamera);
  return WALL_POINTS.map((at) => pixel(data, at.x, at.y));
}

renderer.render(wallScene, wallCamera);
const wallSnapshot = renderer.captureFrame() ?? undefined;
const wallWithout = wallReadings(undefined);
const wallWith = wallReadings(wallSnapshot);

// ---------------------------------------------------------------- the march

// **The reading that says a reflection is a MIRROR and not a smear**, asked for as
// *"shouldn't the mirrored world be flipped vertically?"* A tower with a GREEN foot
// and a MAGENTA top stands on the floor. In a mirror the foot lands next to the
// contact line and the top lands further from it, so a column of floor read from the
// tower's foot toward the camera must go green, then magenta — in that order. A
// single tap cannot produce that: it copies one neighbouring pixel, so it reads one
// colour or the other and never both in order.
const marchScene = room();
const marchMaterial = coat();
marchMaterial.glaze!.screenMarch = 24;
addNode(
  marchScene,
  node({
    name: "floor",
    mesh: box(80, 0.2, 80),
    position: { x: 0, y: -0.1, z: 0 },
    material: marchMaterial,
  }),
);
flat(marchScene, "foot", box(2.6, 2, 1.2), { x: 0, y: 1, z: -7 }, GREEN);
flat(marchScene, "head", box(2.6, 2, 1.2), { x: 0, y: 3, z: -7 }, MAGENTA);
flat(marchScene, "sky", box(60, 24, 0.2), { x: 0, y: 15, z: -16 }, BLUE);
updateWorldMatrices(marchScene);

const marchCamera = createCamera({
  target: { x: 0, y: 0.2, z: -4.5 },
  distance: 8,
  yaw: 0,
  pitch: 0.3,
  fov: Math.PI / 3,
  near: 0.05,
  far: 200,
});

// The mirror the march walks: a target with READABLE DEPTH, and the scene drawn into
// it with the coat's own screen term off — a picture of a deck with no reflection on
// it, which is the only kind a reflection can be taken from.
const mirror = renderer.createTarget(SIZE, SIZE, { sampleDepth: true });
marchMaterial.glaze!.screen = undefined;
renderer.render(marchScene, marchCamera, { target: mirror, clear: true });
marchMaterial.glaze!.screen = mirror;
const marchFrame = shoot(marchScene, marchCamera);
/** A column down the middle of the frame, every second row, as the raw pixels. The
 *  test finds the tower and the floor in it rather than being told where they are —
 *  the layout of this scene is not something to hard-code twice. */
const marchColumn: { y: number; rgb: number[] }[] = [];
for (let step = 0; step < 50; step++) {
  const y = 0.02 + step * 0.0192;
  marchColumn.push({ y: +y.toFixed(4), rgb: pixel(marchFrame, 0.5, y) });
}
// The same column with the march switched off, which is what says a reading came from
// the march rather than from the ice, the probe or the tower itself.
marchMaterial.glaze!.screen = undefined;
const marchOffFrame = shoot(marchScene, marchCamera);
const marchOffColumn = marchColumn.map(({ y }) => pixel(marchOffFrame, 0.5, y));
marchMaterial.glaze!.screen = mirror;

window.__glazeScreen = {
  ready: true,
  backend: renderer.backend,
  snapshot: floorSnapshot ? { width: floorSnapshot.width, height: floorSnapshot.height } : null,
  cells,
  farReach,
  dim,
  march: marchColumn,
  marchOff: marchOffColumn,
  mirror: { width: mirror.width, height: mirror.height, sampleDepth: mirror.sampleDepth },
  wall: WALL_POINTS.map((at, index) => ({
    ...at,
    with: wallWith[index]!,
    without: wallWithout[index]!,
  })),
};

declare global {
  interface Window {
    __glazeScreen?: {
      ready: boolean;
      backend: string;
      snapshot: { width: number; height: number } | null;
      cells: Cell[];
      farReach: number[][];
      dim: number[][];
      march: { y: number; rgb: number[] }[];
      marchOff: number[][];
      mirror: { width: number; height: number; sampleDepth: boolean };
      wall: Cell[];
    };
  }
}
