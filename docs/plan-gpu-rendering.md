# Plan: a GPU path and OffscreenCanvas for minimotor

Status: stages 1–3 and 4a are implemented (`createApp({ renderer: "webgl" | "auto" })`,
dual-canvas WebGL2 sprite batcher, tiles/particles via a recording 2D context,
`scratchCanvas` for bakes). Stage 4b (scene on a worker) is still a proposal.

The shipped shape is a `SceneRenderer` for `Draw.sprites` / `Draw.tiles` /
`Draw.particles` only — not a full `RenderTarget` for every primitive. Overlay
Canvas2D still owns UI, text, and `Draw.rect`. See `src/engine/render/`.

## Why

minimotor is Canvas2D only — no `WebGL`, `WebGL2`, `WebGPU` or `OffscreenCanvas`
appears anywhere in `src`. Every sprite ends in a `drawImage`, every tile in a
`drawImage`, every particle in a `drawImage` of a pre-baked dot
(`src/particles/system.ts:225`). Pixi, Phaser and Kaplay all batch on the GPU.

That was a defensible scope decision when the engine was small, and the
question is whether it still is: the engine ships snapshot interpolation,
rigid-body physics, WFC level generation and a 9.5k-line UI, and then caps you
at whatever Canvas2D can push.

**That cap has since been measured — see the last section, and read it before
the rest of this document.** The headline: ~15,500 unrotated sprites at 60fps
even under software rasterisation, but only ~4,500 once they rotate. The first
number is high enough that the throughput argument for stages 2–3 is weaker
than this section originally assumed; the second is the one that actually
justifies a batcher.

Two separate wins are on the table and they are **not** the same project:

- **WebGL** raises the sprite/tile/particle ceiling by an order of magnitude.
- **OffscreenCanvas** moves work off the main thread, which is a _latency_ win
  (input responsiveness, no jank from GC or a slow `update`) — it does not make
  drawing faster.

Do them in that order. WebGL is the bigger win and OffscreenCanvas is much
easier once the renderer is already an abstraction rather than a raw `ctx`.

## What makes this tractable

Three facts from the current code, all of which have to stay true:

1. **`createDraw(host)` already takes its context through a getter**
   (`src/engine/draw.ts`). The whole `Draw` API is bound methods over a
   `DrawTarget` that reads `host.ctx` lazily. Swapping what backs it is a
   contained change.
2. **The renderer never imports a capability.** `TilesLike`, `ParticleLike`,
   `FontLike` and `SpriteLike` are _structural_ seams — `Draw.tiles` knows
   nothing about `src/tiles`. Those seams are exactly where a second backend
   plugs in.
3. **`Draw.sprites(list, opts)` is already a batch call** that sorts by `z` and
   culls to a rect before drawing. It is a per-sprite loop today, but the
   _signature_ is already the batched one. This is the single highest-value
   call to move to the GPU and it needs no API change.

And one fact that makes it hard:

4. **`src/ui` performs 316 raw `ctx.*` operations** and reaches the context
   through one function, `uiCtx()` (`src/ui/core/context.ts`). Everything else
   in the engine combined is another ~380, spread over 17 modules. The UI is
   the long pole and it is the part least worth porting — it draws a few hundred
   rects and strings per frame, which Canvas2D handles fine.

## The shape: two backends, one composited frame

Do **not** try to port everything. Run both, layered:

```
┌─────────────────────────────┐
│  overlay canvas (Canvas2D)  │  UI, text, gizmos, debug HUD
├─────────────────────────────┤
│  scene canvas (WebGL2)      │  tiles, sprites, particles
└─────────────────────────────┘
```

Two stacked `<canvas>` elements, same size, the 2D one transparent on top. This
is what Pixi + a DOM UI does, and what a lot of shipped WebGL games do. It buys:

- The UI never has to be ported. `uiCtx()` returns the overlay's context and
  9,469 lines stay as they are.
- No GPU↔CPU round trip. Compositing two canvases is the browser's job and is
  free; `drawImage(glCanvas, 0, 0)` into a 2D canvas each frame is **not** free
  and must be avoided.
- A game can opt in per-app: `createApp({ renderer: "webgl" })`. On a machine
  with no WebGL2 the scene layer falls back to Canvas2D and everything still
  runs — a hard requirement, not a nicety.

The cost: two canvases means two DPR/letterbox/resize paths to keep in sync, and
the scene layer can no longer be _interleaved_ with UI drawing. Anything that
today draws UI, then world, then UI again has to be split. Worth checking the
samples for that pattern before committing.

## Stage 1 — Make the render target an interface

No GPU code yet. Purely a refactor, fully testable, independently shippable.

Introduce a `RenderTarget` that `createDraw` takes instead of
`{ readonly ctx: CanvasRenderingContext2D }`:

```ts
export interface RenderTarget {
  /** Batched sprite blit — the call that actually matters for throughput. */
  sprites(list: Iterable<DrawSprite>, opts?: DrawSpritesOptions): void;
  quad(x: number, y: number, w: number, h: number, fill: Fill): void;
  image(img: TextureSource, dst: Rect, src?: Rect, tint?: string, alpha?: number): void;
  /** Escape hatch: the 2D context, or null on a GPU target. Everything that
   *  needs this is a candidate for staying on the overlay layer. */
  readonly ctx2d: CanvasRenderingContext2D | null;
  beginFrame(): void;
  endFrame(): void;
}
```

Then implement `Canvas2DTarget` over the existing code — every current `Draw.*`
body moves behind it essentially unchanged, and `ctx2d` returns the real
context so nothing breaks. `pnpm test` must pass with zero behaviour change;
that is the acceptance criterion for the whole stage.

The output of this stage is a **list**: every call site that reached for
`ctx2d`. That list is the real scope of stage 2, measured rather than guessed.

Files: `src/engine/draw.ts`, a new `src/engine/render/target.ts` and
`src/engine/render/canvas2d.ts`, `src/engine/app.ts` (wiring).

## Stage 2 — A WebGL2 sprite batcher

The smallest thing that is worth having. One shader, one vertex buffer, one
texture atlas binding point.

- **Vertex format**: `x, y, u, v, rgba` — 5 floats + 1 packed uint per vertex,
  interleaved, 6 indices per quad via a static index buffer (no `TRIANGLE_FAN`,
  no per-quad index upload).
- **Batching rule**: flush when the texture changes, the blend mode changes, or
  the buffer fills. Sort `Draw.sprites` by `(z, texture)` instead of today's
  `z` alone — same visual result when z is respected, far fewer flushes.
- **Transform**: done on the CPU into the vertex buffer, not via a per-quad
  uniform. Four corners through a 2×3 matrix is a handful of multiplies and it
  keeps everything in one draw call. The camera/letterbox transform becomes one
  projection uniform set per frame.
- **Textures**: `Sprites.atlas` already bakes an offscreen canvas
  (`src/sprites/raster.ts`); that canvas uploads directly with `texImage2D`.
  Cache the `WebGLTexture` on the canvas object, keyed by a dirty counter, so a
  re-baked atlas re-uploads and a static one never does.
- **Tint**: today `Sprites.tint` bakes a recoloured copy of the atlas per colour
  (`src/sprites/raster.ts:141`). On the GPU tint is the per-vertex colour and
  the whole caching layer becomes unnecessary — keep the Canvas2D path as-is,
  and let the GL path ignore the cache. This is a real memory win on top of the
  throughput one.
- **Pixel-art correctness is non-negotiable.** `NEAREST` filtering, no mipmaps,
  and the same half-pixel snapping `blitPixelAligned` (`src/engine/pixel-raster.ts`)
  does today. Get this wrong and every sample in the repo looks worse than
  before. Write the test first: render a known 8×8 sprite at 4× and compare
  against the Canvas2D output pixel for pixel.

**Acceptance**: `samples/gpu-blit` renders identically under both backends
(pixel-diff in `e2e/gpu-blit.spec.ts`), and `samples/bench-sprites`
reports a 60fps wall on the GL path well above the measured 2D baseline — with
the **rotated** mode as the headline, since that is where the 2D path is weakest
(~4,500) and where a batcher's advantage is structural rather than incremental.
The GL path should show little or no gap between its blit and rotated walls at
all; if it does, the CPU-side transform is wrong.

Files: new `src/engine/render/webgl/{target,batcher,shaders,texture}.ts`.

## Stage 3 — Tiles and particles onto the batcher

Both are already batch-shaped and both are pure wins.

- **Tiles**: `paintCells` (`src/tiles/paint.ts`) walks visible cells and blits
  each. On the GPU that becomes one buffer fill per visible chunk. The existing
  bake-to-offscreen-canvas cache (`src/tiles/paint.ts:182`) can stay as a
  _fallback_; on the GL path a static layer becomes a single persistent vertex
  buffer rebuilt only on `invalidate()`, which is strictly better than
  re-blitting a baked canvas.
- **Particles**: drop the pre-baked per-colour dot canvas entirely
  (`src/particles/system.ts:109-121`). A particle is a quad with a vertex
  colour; the whole bake cache is dead code on the GL path.
- **Dual-grid autotiling** already emits four quarter-tile blits per cell —
  four quads instead of one, which costs nothing in a batcher and is where that
  design pays off.

## Stage 4 — OffscreenCanvas

Only worth doing after stages 1–3, because the renderer is by then an interface
with no `document` dependency in its hot path.

Two independent uses, and they should be kept separate:

**4a. Offscreen for the bakes — shipped.** `scratchCanvas` / `scratchContext`
in `src/engine/offscreen.ts` prefer `OffscreenCanvas` and fall back to a
detached HTML canvas when that constructor is missing or cannot rasterise
(jsdom, older browsers). Call sites: `src/sprites/raster.ts`,
`src/tiles/tileset.ts`, `src/tiles/paint.ts`, `src/particles/system.ts`,
`src/font/slice.ts`.

**4b. Rendering on a worker (the real one).** `canvas.transferControlToOffscreen()`
hands the canvas to a worker; the worker owns the render loop and the main
thread does input and networking only.

This is the largest and riskiest item in this document, because it changes the
engine's threading model:

- `Keys`/`Pointer` are polled from main-thread DOM events
  (`src/engine/app.ts`) and would have to be shipped to the worker each frame
  as a transferable snapshot. The engine's fixed-step design helps here: the
  step is the time unit, so a one-frame-old input snapshot is a well-defined
  thing rather than a race.
- `Audio` must stay on the main thread — `AudioContext` is not available in a
  worker. The per-app music channel from the audio fix is main-thread-only;
  scheduling calls would cross the boundary.
- The UI's native text-input overlay (`src/ui/widgets/native-editor.ts`) is a
  real DOM element and cannot move.
- `Capture` (`src/capture/index.ts`) reads `canvas.toDataURL` /
  `canvas.toBlob`; on a transferred canvas those become
  `convertToBlob()` on the worker side.

Given that, the honest scope for 4b is: **the scene layer only.** The worker
owns the WebGL scene canvas; the main thread keeps the 2D overlay canvas with
the UI on it. That is a clean split along the boundary stage 1 already
established, it keeps every DOM-bound capability where it is, and it delivers
the actual benefit (a slow frame in the game world never blocks input or UI).

**Acceptance**: `samples/api-lab` runs with the scene on a worker, and an
artificial 50ms stall injected into the world update leaves the UI still
responsive to clicks.

## What this plan deliberately does not do

- **No WebGPU.** Safari support landed too recently to be the primary path, and
  a WebGL2 batcher is 90% of the win for a 2D engine. If it goes in later it
  goes in as a third `RenderTarget`, which is exactly what stage 1 buys.
- **No porting `src/ui` to the GPU.** 316 `ctx` operations for a few hundred
  rects a frame. The overlay layer is the right answer and costs nothing.
- **No shader/material API for games.** Custom shaders are a much larger design
  question (how does a game ship one? how does it degrade with no WebGL?) and
  should not ride along with the throughput work.

## Order and independence

| Stage                          | Depends on | Shippable alone | Risk                       |
| ------------------------------ | ---------- | --------------- | -------------------------- |
| 1 — `RenderTarget` interface   | —          | yes             | low, pure refactor         |
| 2 — WebGL2 sprite batcher      | 1          | yes             | medium, pixel-art fidelity |
| 3 — tiles + particles          | 2          | yes             | low                        |
| 4a — OffscreenCanvas for bakes | —          | yes (done)      | low                        |
| 4b — scene on a worker         | 1, 2, 4a   | yes             | high, threading model      |

4a can go first; it is independent of everything and improves the current
Canvas2D engine on its own.

## 3D — built, and how it relates to the stages above

The three questions this section originally answered ("does this enable 3D?",
"should we add `Vec3`?", "how would 3D appear in the UI?") have been answered
by building it. `src/render3d`, exported as `minimotor/3d`, is in the tree.
What follows is what it is and — more usefully — what it deliberately is not.

The honest framing: **3D did not come out of stages 1–3, and it did not need
them.** The batcher stages are about pushing more 2D sprites through Canvas2D's
ceiling. 3D is a separate renderer with its own pipeline that happens to share
the GPU. Both can proceed independently; neither blocks the other.

### What exists

| Module                                | What it is                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `math/vec3`, `math/quat`, `math/mat4` | Right-handed, +Y up, camera down −Z. Column-major matrices. `out` last and optional, as `Vec2` has always done.                        |
| `render3d/mesh`                       | Geometry as plain typed arrays; box / sphere / plane / cylinder / cone / torus; smooth normals; merge.                                 |
| `render3d/scene`                      | A **flat** node array with TRS transforms, parents by index. JSON-safe, so hot-reload state saving and snapshots work on it unchanged. |
| `render3d/camera`                     | An orbit camera. Does not own a clip-depth convention.                                                                                 |
| `render3d/animation`                  | glTF-shaped keyframe tracks, slerped rotations, binary-searched sampling.                                                              |
| `render3d/webgl2`, `render3d/webgpu`  | Two backends behind one `Renderer3D`. Blinn-Phong, up to four directional lights, depth buffer, sorted transparency.                   |
| `ui/widgets/viewport3d`               | A 3D view as a UI widget.                                                                                                              |
| `render3d/ui-surface`                 | The UI as a texture on a quad in the scene.                                                                                            |
| `render3d/layer`                      | The scene canvas stacked UNDER the app's, for a full-screen world with a 2D HUD — Stage 0's two-canvas sketch, built.                  |

### Why two backends rather than "WebGPU when ready"

Because one implementation cannot tell you which of its choices were decisions
and which were assumptions. The clearest example is in this document's own
history: `Mat4.perspective` takes a `zeroToOne` flag because WebGL2 maps the
near plane to −1 and WebGPU to 0. With a single backend that would have been a
hard-coded constant, discovered years later as "WebGPU renders nothing".
`createRenderer3D` prefers WebGPU and falls back to WebGL2 silently; callers
that care read `renderer.backend`.

### The three ways 3D and the UI meet

This is the part worth understanding before building anything on it, because
they look similar and solve opposite problems. Each is the wrong answer to the
other two's question.

**`UI.viewport3d` — 3D inside the UI.** The renderer draws into its own canvas
at the widget's device-pixel size and the widget blits it in with one
`drawImage`. Because the result is just pixels in the UI's 2D context, it
clips, scrolls, and z-orders like any other widget — `samples/render3d` puts
six live previews inside a scrolling list. The cost is one blit of a small
canvas per frame. The limit is that a 3D object can never appear in front of a
UI element.

**`createUiSurface` — the UI inside the 3D scene.** The UI renders into an
offscreen 2D canvas, which is a texture, which goes on a quad. No widget was
ported to the GPU and no text shaping was reimplemented — the UI does not know
it is on a plane. A panel can hang on a wall in world space, angle away from
the viewer, and have a 3D object pass in **front** of it. The limit is the
mirror image of the other: it cannot be clipped by a scrolling list.

**`attachSceneLayer` — the two stacked canvases from Stage 0.** The GL canvas
goes directly behind the app's own, which stays transparent because the app was
created with no `background`. The browser composites: no blit, no upload, and
the HUD renders at native DPR rather than through a perspective divide. This is
the right shape for a full-screen 3D game with screen-space UI, and it is what
`samples/fps` uses for its HUD — with a `createUiSurface` wall terminal beside
it, because a panel you walk up to and press is a different job from a HUD. The
limit, again the mirror: the scene is always UNDER every UI element, which for a
HUD is exactly what you want and for an in-world panel is useless.

One trap worth writing down, because it presents as a font bug rather than a
composition one: "the engine leaves the play area alone" cuts both ways. With no
`background` it does not clear the 2D canvas either, so a HUD has to erase
itself each frame or every frame's text stacks on the last one's.

The non-obvious part of `createUiSurface` is input. Hit-testing a UI on a quad is a
ray cast — unproject through the camera, intersect the plane, convert to uv —
which the UI's existing scale-plus-offset transform cannot express. So the
kernel gained one small seam, `pushPointerOverride`, that replaces the pointer's
POSITION only: the press and release edges and the wheel stay the real
device's, because it is the same physical pointer, and only where it lands has
to be re-derived.

### What is still not there

Worth being as explicit about this as the original version of this section was:

- **No shadows.** Directional lights with no shadow map. A ground-plane blob or
  a baked texture is the current answer.
- **No skinning.** Animation drives node transforms, so a hierarchy of rigid
  parts animates; a deforming character does not.
- **No model loading.** No glTF importer. Geometry is built in code.
- **No material/shader API.** One Blinn-Phong shader with uniform switches.
  Still out of scope for the same reason as before: how a game ships a custom
  shader, and how that degrades across two backends, is a design question of
  its own.
- **No frustum culling** beyond per-node visibility, and no instancing. Both
  matter at scene sizes well past what the samples reach.
- **`Vec3` has consumers now** — the scene graph, the camera, the meshes — so
  the earlier answer ("wait for one") resolved itself by the consumer arriving.
  `Vec3` is still deliberately NOT interchangeable with `Vec2`: structural
  typing would let one slip into the 2D renderer and have its `z` silently
  dropped.

## The measurement to take before starting any of it

None of the above is worth doing on a hunch. **Done — the harness is
`samples/bench-sprites`.** It spawns N sprites, measures the median cost of the
`Draw.sprites` call and the median frame interval, and binary-searches for the
largest N that holds 60fps. `window.__bench` drives it headlessly.

It reports two numbers deliberately. `frameMs` is what a player feels but it
saturates at the display's refresh interval, so it cannot distinguish 1,000
sprites from 10,000; `drawMs` is the renderer's own cost, rises monotonically,
and is the number to compare between backends.

Headless Chromium at 1280×720 (software rasterisation — **a lower bound**, a
machine with GPU-accelerated Canvas2D will be some multiple faster):

| Path                  | 60fps wall | draw at the wall |
| --------------------- | ---------- | ---------------- |
| unrotated (`blit`)    | ~15,500    | 15.3 ms          |
| rotated (`transform`) | ~4,500     | 12.7 ms          |

Cost is linear in N on the blit path — 0.5 ms at 1k, 8.6 ms at 10k, 39.1 ms at
40k, so about 1 µs per sprite.

Two things to read off this:

1. **15k unrotated sprites is a lot.** For most games the engine is aimed at,
   stages 2–3 are indeed premature, exactly as this section suspected. The
   number that would change that verdict is a real game hitting it.
2. **Rotation costs 3.4×**, and that is the most interesting figure here. The
   gap is the `save`/`translate`/`rotate`/`restore` around each blit
   (`src/engine/draw.ts`), and a batcher erases it — four corners through a 2×3
   matrix is the same handful of multiplies whether or not there is a rotation
   in it. So the honest pitch for stage 2 is not "10× more sprites", it is
   "rotation and scale stop costing anything", which matters for exactly the
   bullet-hell/particle case that motivated the plan.

Caveat on the harness: the cull comparison is currently meaningless, because
every sprite is spawned on screen and so nothing is culled. Measuring the cull
path needs a world larger than the viewport.
