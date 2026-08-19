// A pixel harness for `Renderer3D.createTarget`, in the shape `gpu-blit` and
// `glaze` established: one deterministic sequence of frames, and a plain object
// on `window` holding the numbers read out of them. There is nothing to look at
// and nothing to interact with — `e2e/render-target.spec.ts` is the only caller.
//
// **Why a real browser**, when the repo settles most backend questions by
// comparing the two shader sources as TEXT. Because a render target is not a
// shader: it is a framebuffer binding, and every way it can be wrong is a way
// that no source comparison and no screenshot of the page can see.
//
//   - Bound but never cleared, or cleared into the wrong attachment: the target
//     comes back holding whatever the driver left there. A screenshot of the
//     PAGE is unaffected, because the page still shows the canvas.
//   - Never unbound at the end of the pass — the classic one. Every LATER frame
//     in the app goes into the target instead of the screen, and the canvas
//     freezes on the last frame it received. A test that renders once and looks
//     at the result passes; the app it ships in shows a still image.
//   - No depth attachment, or one that is not bound with the colour: the pass
//     still draws, and the result is a scene composited in node order.
//   - The projection built from the CANVAS's aspect instead of the TARGET's:
//     everything is there, in the right colours, stretched. Invisible unless
//     something in the frame has a shape a test can measure.
//
// So the sequence below is arranged to make each of those four a number:
//
//   1. Draw to the canvas, and digest it.
//   2. Draw the same scene into a target of a DIFFERENT and non-square size.
//      Read the target back; digest the canvas again — it must not have moved.
//   3. Change the scene and draw to the canvas again, and read the context's
//      OWN framebuffer binding. The binding is the measurement, and reading the
//      canvas instead was a mistake worth recording: `render` rebinds the
//      default framebuffer on ENTRY as well as releasing the target on exit, so
//      a pass that never unbinds still puts a correct next frame on the screen.
//      Deleting the unbind and watching the canvas proves nothing — checked, it
//      passed — because nothing INSIDE the renderer can see the leak. What can
//      is everything else sharing the context: the app's own GL calls, a
//      library stacked on the same canvas, a later `readPixels`. So the harness
//      asks the context.
//
// The scene has two boxes, and their arrangement is the rest of the experiment.
// The green one is nearer and smaller; the blue one is bigger, further away,
// and added to the scene AFTER it — so in node order it is drawn second and
// paints over the middle of the frame. Green in the middle of the readback is
// therefore a depth buffer doing its job in the target, not a draw order that
// happened to agree. And the green box is a CUBE seen square on, so its
// silhouette is a square in the world: a square in pixels means the projection
// took the target's own aspect, and a 2:1 oblong means it took the canvas's.
import {
  addNode,
  box,
  createCamera,
  createRenderer3D,
  createScene,
  node,
  updateWorldMatrices,
} from "minimotor/3d";
import type { Backend3D } from "minimotor/3d";

const params = new URLSearchParams(location.search);
const wanted = params.get("backend");
const backend: Backend3D | "auto" = wanted === "webgl2" || wanted === "webgpu" ? wanted : "webgl2";

const canvas = document.createElement("canvas");
canvas.id = "render-target";
document.body.append(canvas);

// No MSAA on the canvas: every reading here is a colour at a coordinate, and a
// resolved edge is one more thing between the pass and the number.
const renderer = await createRenderer3D({ backend, canvas, antialias: false });
// Square canvas, deliberately: the target below is 2:1, so a projection built
// from the wrong surface is a stretch this harness can measure rather than a
// coincidence it cannot.
const CANVAS_SIZE = 128;
renderer.resize(CANVAS_SIZE, CANVAS_SIZE, 1);

const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 64;

const scene = createScene({
  // Opaque and distinctive: this exact colour appearing in the target's corner
  // is what says the target was CLEARED, rather than handed back untouched
  // memory that happened to be dark.
  background: [0.1, 0.05, 0.2, 1],
  lights: [],
  ambient: [1, 1, 1],
});

const near = node({
  name: "near",
  mesh: box(2, 2, 2),
  position: { x: 0, y: 0, z: 0 },
  // Unlit, so a colour read out of the frame is the colour that went in and no
  // test here has to model a light.
  material: { color: [0, 1, 0, 1], unlit: true },
});
addNode(scene, near);

// The row-order marker, and the reason it is not just another box: everything
// else in this scene is symmetric about the horizon, and GL hands `readPixels`
// back BOTTOM row first while `RenderTarget3D` promises top row first. A frame
// that is symmetric cannot tell a correct flip from a missing one, from two of
// them. This box sits well ABOVE the others and nothing else is that colour, so
// which half of the readback it lands in is the whole measurement.
addNode(
  scene,
  node({
    name: "marker",
    mesh: box(0.6, 0.6, 0.6),
    position: { x: 0, y: 2.2, z: 0 },
    material: { color: [1, 0, 0, 1], unlit: true },
  }),
);

// Added second, so it is drawn second — see the header. Bigger and further
// away, so it surrounds the green box rather than hiding behind it.
addNode(
  scene,
  node({
    name: "far",
    mesh: box(4, 4, 4),
    position: { x: 0, y: 0, z: -4 },
    material: { color: [0, 0, 1, 1], unlit: true },
  }),
);

// Square on to the boxes: the green cube's silhouette is then its front face,
// which is a square in the world and must be a square in pixels.
const camera = createCamera({
  target: { x: 0, y: 0, z: 0 },
  distance: 8,
  pitch: 0,
  yaw: 0,
  near: 0.1,
  far: 200,
});

updateWorldMatrices(scene);

/** The canvas, read through a 2D context — the same route `glaze` takes, and
 *  for the same reason: the spec then works in numbers rather than in PNG bytes
 *  it would have to decode before it could say anything. */
const readback = document.createElement("canvas");
readback.width = renderer.renderWidth;
readback.height = renderer.renderHeight;
const rb = readback.getContext("2d", { willReadFrequently: true })!;

function digestOf(data: Uint8ClampedArray | Uint8Array): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) a = Math.imul(a ^ data[i]!, 0x01000193) >>> 0;
  return a.toString(16).padStart(8, "0");
}

function canvasFrame(): { digest: string; center: number[] } {
  rb.drawImage(renderer.canvas, 0, 0);
  const whole = rb.getImageData(0, 0, readback.width, readback.height);
  const middle = rb.getImageData(readback.width >> 1, readback.height >> 1, 1, 1).data;
  return { digest: digestOf(whole.data), center: [middle[0]!, middle[1]!, middle[2]!] };
}

/** Where a colour sits in an RGBA8 readback: the bounding box of every pixel
 *  the predicate accepts, in pixels, or null if it accepted none.
 *
 *  A bounding box rather than a pixel count, because the claim under test is
 *  about SHAPE — a stretched square covers a different rect but can cover a
 *  similar number of pixels. */
function extent(
  pixels: Uint8Array,
  width: number,
  height: number,
  hit: (r: number, g: number, b: number) => boolean,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (!hit(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function pixelAt(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const at = (y * width + x) * 4;
  return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!, pixels[at + 3]!];
}

// 1. The canvas frame, before a target exists at all.
renderer.render(scene, camera);
const beforeTarget = canvasFrame();

// 2. The same scene, same camera, into a target of another size and shape.
const target = renderer.createTarget(TARGET_WIDTH, TARGET_HEIGHT);
renderer.render(scene, camera, { target });
const pixels = await target.readPixels();
// Read the canvas again with nothing drawn into it in between: a target render
// that touched the screen shows up here as a digest that moved.
const afterTarget = canvasFrame();

// 3. Back to the canvas, with a scene that is visibly different — the unbind.
near.material!.color = [1, 0, 0, 1];
renderer.render(scene, camera);
const afterUnbind = canvasFrame();

/** Whether the context is left on the DEFAULT framebuffer once a target render
 *  is over — see the header for why this, and not the frame after it, is the
 *  measurement of an unbind.
 *
 *  `getContext` on a canvas that already has a context hands back that same
 *  context, so this is the renderer's own state and not a second one. Null on
 *  WebGPU, which has no such global binding to leak: a pass there is described
 *  by the descriptor it is begun with. */
function defaultFramebufferBound(): boolean | null {
  if (renderer.backend !== "webgl2") return null;
  const gl = renderer.canvas.getContext("webgl2");
  if (!gl) return null;
  renderer.render(scene, camera, { target });
  return gl.getParameter(gl.FRAMEBUFFER_BINDING) === null;
}
const unboundAfterTargetRender = defaultFramebufferBound();

const bright = (v: number) => v > 128;
const dim = (v: number) => v < 80;

window.__renderTarget = {
  ready: true,
  backend: renderer.backend,
  canvasSize: CANVAS_SIZE,
  target: {
    width: target.width,
    height: target.height,
    bytes: pixels.length,
    digest: digestOf(pixels),
    // The middle of the frame, which is the near box — and blue there would be
    // the far box painted over it with no depth test.
    center: pixelAt(pixels, TARGET_WIDTH, TARGET_WIDTH >> 1, TARGET_HEIGHT >> 1),
    // A corner, which no box reaches: the background, and so the clear.
    corner: pixelAt(pixels, TARGET_WIDTH, 0, 0),
    // The near cube's silhouette. Square in the world; square in pixels only if
    // the projection was built from this target's 2:1 aspect.
    green: extent(pixels, TARGET_WIDTH, TARGET_HEIGHT, (r, g, b) => bright(g) && dim(r) && dim(b)),
    blue: extent(pixels, TARGET_WIDTH, TARGET_HEIGHT, (r, g, b) => bright(b) && dim(r) && dim(g)),
    // The marker, which is above the other two in the WORLD — so it must be
    // nearer row zero in a readback whose first row is the top one.
    marker: extent(pixels, TARGET_WIDTH, TARGET_HEIGHT, (r, g, b) => bright(r) && dim(g) && dim(b)),
  },
  canvas: {
    beforeTarget,
    afterTarget,
    afterUnbind,
  },
  unboundAfterTargetRender,
};

declare global {
  interface Window {
    __renderTarget?: {
      ready: boolean;
      backend: Backend3D;
      canvasSize: number;
      target: {
        width: number;
        height: number;
        bytes: number;
        digest: string;
        center: number[];
        corner: number[];
        green: { x: number; y: number; w: number; h: number } | null;
        blue: { x: number; y: number; w: number; h: number } | null;
        marker: { x: number; y: number; w: number; h: number } | null;
      };
      canvas: {
        beforeTarget: { digest: string; center: number[] };
        afterTarget: { digest: string; center: number[] };
        afterUnbind: { digest: string; center: number[] };
      };
      unboundAfterTargetRender: boolean | null;
    };
  }
}
