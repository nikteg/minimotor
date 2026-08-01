# Plan: a GPU path and OffscreenCanvas for minimotor

Status: proposal. Nothing here is implemented.

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
  image(
    img: TextureSource,
    dst: Rect,
    src?: Rect,
    tint?: string,
    alpha?: number,
  ): void;
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

**Acceptance**: `samples/particles` and `samples/sprites` render identically
under both backends (pixel-diff in a Playwright test), and `samples/bench-sprites`
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

**4a. Offscreen for the bakes (easy, ship it early — it does not need any of
the above).** Nine sites call `document.createElement("canvas")` purely to rasterise
something: `src/sprites/raster.ts` (×5), `src/tiles/tileset.ts`,
`src/tiles/paint.ts`, `src/particles/system.ts`, `src/font/slice.ts`. Every one
of them is a pure "make a bitmap" operation with no DOM involvement. Switching
them to `new OffscreenCanvas(w, h)` behind one helper:

```ts
// src/engine/offscreen.ts
export function scratchCanvas(
  w: number,
  h: number,
): OffscreenCanvas | HTMLCanvasElement;
```

...keeps them out of the document entirely, which avoids layout/style cost on
creation and — more importantly — makes those functions callable from a worker
and from Node with a polyfill. `Sprites.atlas` becoming worker-safe is what
makes 4b possible at all. Low risk, immediate benefit, no API change.

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
| 4a — OffscreenCanvas for bakes | —          | yes             | low                        |
| 4b — scene on a worker         | 1, 2, 4a   | yes             | high, threading model      |

4a can go first; it is independent of everything and improves the current
Canvas2D engine on its own.

## Does this enable 3D games?

No — and the gap is bigger than it looks, so it is worth being explicit before
anyone plans around it.

What stage 2 builds is an **orthographic quad batcher**: one shader, a
`x, y, u, v, rgba` vertex, a 2×3 transform applied on the CPU, and `z` used
purely as a sort key with no depth buffer. Every design decision in it assumes
flat, axis-aligned, painter's-algorithm 2D. None of the following exists or is
implied by it:

| Needed for 3D               | In this plan                          |
| --------------------------- | ------------------------------------- |
| Perspective + view matrices | no — one ortho projection uniform     |
| Depth buffer + depth test   | no — `z` is a CPU sort key            |
| Mesh vertex/index buffers   | no — quads from a static index buffer |
| Normals, lighting, shading  | no                                    |
| Material / shader authoring | explicitly out of scope (see above)   |
| Frustum culling             | no — a 2D rect cull                   |
| Model loading (glTF)        | no                                    |

What the plan _does_ leave behind is a seam. `RenderTarget` (stage 1) is where
a `WebGL3DTarget` would plug in, and stage 2 establishes context creation,
texture upload and the resize/DPR plumbing that any GL backend needs. That is
real, but it is the small part. A 3D path is a larger project than this entire
document, and it should be proposed on its own terms rather than smuggled in
as "phase 5".

### Should we introduce `Vec3`?

Not yet, and not as part of this. `Vec2` (`src/math/vec2.ts`) earns its place
by being _structural_ — anything with `x`/`y` is one, so sprites, bodies, the
pointer and tile spawn points all satisfy it without importing anything, and
eleven modules use it. A `Vec3` today would have no such consumer:

- Sprite `z` is a scalar sort key, not a coordinate. Widening it to a vector
  would make every sprite carry a field the renderer throws away.
- The physics is `planck` — a 2D solver. There is no third axis to integrate.
- The one place a third component is arguably meaningful is audio, and the
  mixer already models it as what it actually is: a scalar `setPan`
  (`src/audio/mixer.ts:132`) over a `StereoPannerNode`. Positional audio would
  want a `Vec3`, but that is a feature request, not a consequence of this plan.

The rule the codebase already follows is to add the type when the consumer
arrives. Adding it before means guessing the shape (row/column? `z` up or `y`
up? handedness?) with nothing to check the guess against.

## How would 3D content appear inside the UI?

The layered composition answers this better than a single-canvas design would,
and in two different ways depending on what is being asked for.

**A 3D world with a 2D HUD** is already the shape of the diagram above. The
scene canvas renders the world with whatever backend it has; the UI is a
transparent 2D canvas on top. Nothing about `src/ui` changes. This case is free.

**A 3D view inside a panel** — a character preview, an item inspector, a
rotatable model in a shop screen — needs one observation: the overlay canvas is
**transparent where the UI has not painted**. So a panel does not need to blit
anything or punch a hole. It draws its frame and title on the overlay, leaves
the interior unpainted, and the scene layer renders the 3D viewport into that
same screen rect underneath. The browser composites. There is no readback and
no `drawImage(glCanvas, …)`, which is the cost the plan already rules out.

The constraint that comes with it is **z-order is fixed**: the scene layer is
always under all UI. A 3D preview can sit inside a panel, but it can never
appear _above_ a UI element — so a modal opening over the preview covers it,
which is usually what you want, and a tooltip drawn over it works, which is
also what you want. What does not work is a 3D object that floats above the
HUD. If that is ever needed it is a third canvas, not a change to these two.

For a preview that does not animate — inventory icons, a turnaround sheet —
neither of the above applies: render it once into an `OffscreenCanvas` (stage
4a's `scratchCanvas`) and let the UI blit the result as an ordinary image. That
costs nothing per frame and works on the Canvas2D backend too.

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
