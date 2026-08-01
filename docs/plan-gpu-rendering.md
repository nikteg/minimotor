# Plan: a GPU path and OffscreenCanvas for minimotor

Status: proposal. Nothing here is implemented.

## Why

minimotor is Canvas2D only — no `WebGL`, `WebGL2`, `WebGPU` or `OffscreenCanvas`
appears anywhere in `src`. Every sprite ends in a `drawImage`, every tile in a
`drawImage`, every particle in a `drawImage` of a pre-baked dot
(`src/particles/system.ts:225`). Pixi, Phaser and Kaplay all batch on the GPU.

That was a defensible scope decision when the engine was small. It is now the
first wall a game built on the rest of it hits: the engine ships snapshot
interpolation, rigid-body physics, WFC level generation and a 9.5k-line UI, and
then caps you at whatever Canvas2D can push. On a mid-range laptop that is
roughly 2–5k `drawImage` calls per frame at 60fps; a bullet-hell or a large
autotiled map passes that with room to spare.

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

**Acceptance**: `samples/particles` and `samples/sprites` render identically
under both backends (pixel-diff in a Playwright test), and a synthetic
50,000-sprite benchmark runs at 60fps on the GL path where the 2D path is at
single-digit fps.

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
export function scratchCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement;
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

## The measurement to take before starting any of it

None of the above is worth doing on a hunch. Write the benchmark first: a
sample that spawns N sprites and reports the frame time, run on the current
Canvas2D path, and find the actual N where minimotor drops below 60fps on the
target hardware. If that number is comfortably above what the engine's games
need, stages 2–3 are premature and 4a is the only part worth shipping.
