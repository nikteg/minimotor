// A pixel harness for `Material.glaze`, in the shape `gpu-blit` established:
// one deterministic frame, a URL that names every variable in it, and a flag
// on `window` that says the frame is on the canvas. It is not a demo and there
// is nothing to interact with — `e2e/glaze.spec.ts` is the only caller.
//
// **Why a real browser at all**, when this repo settles WebGPU-vs-WebGL2
// agreement by comparing the two shader sources as TEXT. Because that
// comparison cannot see a term that is symmetrically wrong in both, and the
// whole claim of a faked reflection is a claim about a DIRECTION: the coat
// brightens on the side of the deck that mirrors the key light towards the
// eye, and it swaps sides when the camera goes round. Flip the sign inside
// `reflect()` in both backends and every source-text assertion still passes,
// every screenshot still shows a shiny floor, and the glint is on the wrong
// side of the hole for the life of the project. That is the same fault as a
// billboard drawn a half turn round: invisible to a test that reads extents,
// and only ever caught by measuring the direction.
//
// The scene is built so that ONE property is under test and the rest is
// controlled:
//
//   - The deck is a flat square, so its own shading is constant across it and
//     identical at every yaw. Anything that changes with yaw inside the
//     sampled patch is therefore the coat.
//   - `ripple` and `sparkle` are off, so the coat is smooth and a mean over a
//     patch is a stable number rather than a sample of noise.
//   - The key light is FIXED in world space while the camera orbits, which is
//     what puts the reflected lobe on a knowable side.
//   - The post sits off to one side and is NOT glazed. It is the harness's own
//     control: it moves across the frame with the yaw, so a spec can tell "the
//     camera turned and the coat did not follow" from "the camera never
//     turned".
import {
  addNode,
  box,
  createCamera,
  createRenderer3D,
  createScene,
  node,
  plane,
  updateWorldMatrices,
} from "minimotor/3d";
import type { Backend3D } from "minimotor/3d";

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  // `params.get` gives null for a parameter that is not there, and `Number(null)`
  // is 0 rather than NaN — so a `Number.isFinite` guard alone reads every
  // ABSENT parameter as zero instead of taking the fallback. It went unnoticed
  // while the spec passed all three of them on every URL, and appeared the
  // moment a fourth was added that it does not pass: the canvas came back 16
  // pixels square, every readback landed outside it, and three of the four
  // tests still passed because black equals black.
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const wanted = params.get("backend");
const backend: Backend3D | "auto" = wanted === "webgl2" || wanted === "webgpu" ? wanted : "webgl2";

// Degrees on the wire because a spec reads better in them, radians inside.
const yaw = (num("yaw", 0) * Math.PI) / 180;
const strength = num("strength", 1);

const canvas = document.createElement("canvas");
canvas.id = "glaze";
document.body.append(canvas);

// No MSAA: the deck fills the frame, so there is no silhouette worth softening,
// and one fewer thing between the shader and the number the spec reads.
const renderer = await createRenderer3D({ backend, canvas, antialias: false });
// 256 for the spec, which wants a small reproducible frame. `?size=` is for
// `bench()` below, which wants the opposite — enough pixels that the fragment
// stage is what the clock is measuring.
const size = Math.max(16, Math.round(num("size", 256)));
renderer.resize(size, size, 1);

const scene = createScene({
  // Opaque, so a screenshot of the PAGE has nothing of the page in it.
  background: [0.02, 0.03, 0.05, 1],
  // The key light's direction is the direction it TRAVELS, so this one comes
  // out of the +Z sky and heads down and towards −Z. Held still while the
  // camera goes round it: that is the whole experiment.
  lights: [{ direction: { x: 0, y: -0.6, z: -0.8 }, intensity: 0.9 }],
  ambient: [0.16, 0.18, 0.22],
});

// Wide enough to fill the frame at every yaw the spec uses, so no edge of it
// and no background is ever inside the sampled patch.
addNode(
  scene,
  node({
    name: "deck",
    mesh: plane(40, 40),
    material: {
      color: [0.1, 0.12, 0.16, 1],
      glaze: {
        strength,
        tint: [0.82, 0.9, 1],
        fresnel: 4,
        // Off, both of them: this frame has to be reproducible to the bit, and
        // a mean over a patch of noise is not the measurement it looks like.
        ripple: 0,
        sparkle: 0,
      },
    },
  }),
);

// The harness's own control — see the header. Placed at 0.85 of the frame's
// half-width at the target distance, so it is well inside the picture at yaw 0,
// mirrored to the other side at yaw 180, and never inside the patch the spec
// measures the deck over.
addNode(
  scene,
  node({
    name: "post",
    mesh: box(0.7, 1.4, 0.7),
    position: { x: 2.8, y: 0.7, z: 0 },
    material: { color: [0.85, 0.35, 0.2, 1] },
  }),
);

const camera = createCamera({
  target: { x: 0, y: 0, z: 0 },
  distance: 8,
  // Low enough that the coat is worth looking at, high enough that the deck
  // reaches the top of the frame at every yaw.
  pitch: 0.75,
  yaw,
  near: 0.1,
  far: 200,
});

updateWorldMatrices(scene);
renderer.render(scene, camera);

// The frame is read back through a 2D canvas rather than screenshotted, so the
// spec works in numbers — a mean over a named patch, and a digest of the whole
// frame — instead of in PNG bytes it would have to decode to say anything about
// WHERE the light went.
const readback = document.createElement("canvas");
readback.width = renderer.renderWidth;
readback.height = renderer.renderHeight;
const rb = readback.getContext("2d", { willReadFrequently: true })!;
rb.drawImage(renderer.canvas, 0, 0);

window.__glaze = {
  ready: true,
  backend: renderer.backend,
  /** Mean linear-ish luminance over a rect, 0..255. Rec. 601 weights; the
   *  absolute scale does not matter because every use of this is a comparison
   *  between two frames read the same way. */
  patch(x: number, y: number, w: number, h: number): number {
    const { data } = rb.getImageData(x, y, w, h);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    }
    return sum / (data.length / 4);
  },
  /** Milliseconds per frame, averaged over `frames` renders of this scene at
   *  the current `?size=`, with the deck's coat forced to `strength`.
   *
   *  **Not a frame rate.** A frame rate on this machine reads 8.3 ms whatever
   *  is in the scene, because that is the display's vsync period and the GPU
   *  finishes long before it — which makes "the coat is free" and "the coat
   *  costs 8 ms" the same measurement. This renders back to back with nothing
   *  waiting on a refresh, and reads one pixel back at the end of the run so
   *  the queue has to have drained before the clock is read. What it answers is
   *  the only question worth asking of a per-pixel term: how much does turning
   *  it on add per pixel drawn. */
  bench(frames: number, strength: number): number {
    const material = scene.nodes[0]!.material!;
    material.glaze = { ...material.glaze!, strength };
    renderer.render(scene, camera);
    rb.drawImage(renderer.canvas, 0, 0);
    rb.getImageData(0, 0, 1, 1);
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) renderer.render(scene, camera);
    rb.drawImage(renderer.canvas, 0, 0);
    rb.getImageData(0, 0, 1, 1);
    return (performance.now() - start) / frames;
  },
  /** A cheap order-dependent digest of every pixel — enough to say "the same
   *  frame" or "a different frame", which is all any caller here asks. */
  digest(): string {
    const { data } = rb.getImageData(0, 0, readback.width, readback.height);
    let a = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 1) {
      a = Math.imul(a ^ data[i]!, 0x01000193) >>> 0;
    }
    return a.toString(16).padStart(8, "0");
  },
};

declare global {
  interface Window {
    __glaze?: {
      ready: boolean;
      backend: Backend3D;
      patch(x: number, y: number, w: number, h: number): number;
      bench(frames: number, strength: number): number;
      digest(): string;
    };
  }
}
