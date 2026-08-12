# minimotor — architecture

minimotor is a TypeScript 2D game engine with an opt-in 3D layer: a fixed-step
loop, immediate-mode drawing and UI, and plain-data helpers — never a framework
you subclass.

This is the living architecture doc. It describes what the engine **is now**.
Historical plans live in `docs/archive/`.

## Isolated apps, PascalCase services

`createApp(canvas, options?)` builds one isolated runtime. There is no process-wide
`Minimotor.*` singleton, no `Stage.init`, no `App.init`. Two canvases on one page
are two apps.

The app hands out PascalCase services bound to that canvas:

| Service   | Role                                                                        |
| --------- | --------------------------------------------------------------------------- |
| `Draw`    | Immediate-mode 2D: rects, sprites, tiles, text, gradients                   |
| `Loop`    | Fixed-step accumulator, `run({ update, draw })`, pause/resume               |
| `Keys`    | Polled keyboard (`down` / `pressed` / `released`)                           |
| `Pointer` | Polled pointer (`touches` for simultaneous ids; `Mouse` is the same object) |
| `Clock`   | `world` / `ui` timelines plus `after` / `every` / `create`                  |

`viewport` is live: `w` / `h` update on resize without rebinding. Everything
else is imported and created only when the app uses it.

```ts
import { createApp } from "minimotor";
import { createUI } from "minimotor/ui";

const app = createApp("game", { background: "#222" });
const { Draw, Loop, Keys, Pointer, Clock } = app;
const UI = createUI(app);
```

## Opt-in subpaths

A capability appears in exactly one place. The core `minimotor` entry is
`createApp` plus the stateless helpers you use _alongside_ the canvas
(`Collision`, `Tiles`, `Font`, `Goodies`, `Gizmos`, `Fsm`, `Transitions`,
`Mathf`, `Vec2` / `Vec3` / `Quat` / `Mat4`).

Lifecycle-owned factories take the app and live on their own subpath:
`minimotor/ui`, `minimotor/ecs`, `minimotor/audio`, `minimotor/scenes`,
`minimotor/timers`, `minimotor/input`, `minimotor/3d`, `minimotor/physics3d`,
and the rest of the table in README. Pure modules you would import from a
server or the `mm` CLI (`procgen`, `ldtk`, `rng`, …) are subpaths too.

## Layers

Each layer builds only on the layers below it. Everything above platform is
opt-in: conveniences over the same primitives, not a mandatory framework.
Immediate-mode drawing is preserved at every layer — there is no retained 2D
scene graph to keep in sync.

```
┌─ opt-in 3D     minimotor/3d · minimotor/physics3d
├─ content       assets · anim · tiles · particles · ui · audio
├─ structure     ecs · scenes · timers · fsm · transitions · clock
├─ primitives    math · collision · goodies · gizmos · font
└─ platform      createApp · loop · draw · keys · pointer
```

**Platform** — the host and I/O. One app owns the canvas, the fixed-step loop,
immediate-mode `Draw`, and polled `Keys` / `Pointer`. Fullscreen helpers ride
along with `createApp`.

**Primitives** — pure, data-agnostic helpers. `Mathf`, `Vec2` / `Vec3` / `Quat` /
`Mat4`, `Collision` (swept `moveAndSlide`, slopes, ladders), `Tiles` as queryable
level data, `Font` atlas text, and the Goodies / Gizmos catalog.

**Structure** — optional ways to organize a game. `createEcs()` is an
archetype-free sparse-set world. `createScenes(app)` is a typed scene stack.
`createTimers(app)` derives pause-aware windows, buffers, cooldowns, and jump
gates from `Clock`. `Fsm` and `Transitions` are plain data. `createSignals()` is
a small typed bus, not a required pillar — scenes and ECS cover most fan-out.

**Content** — loading and presenting. `createAssets`, `createAnimation`,
`createParticles`, `createUI`, `createAudio`, `createCamera`, `createPortals`,
sprites, LDtk, Aseprite. UI is immediate-mode: widgets are drawn and polled
every frame.

**Opt-in 3D** — a layer on the same 2D app, sharing the GPU, not a second
engine. `minimotor/3d` is meshes, a flat JSON-safe scene, cameras, WebGL2 /
WebGPU renderers, glTF, and animation. `minimotor/physics3d` is Rapier behind
its own entry: you pass `@dimforge/rapier3d-compat` (or the deterministic
sibling) into `createPhysics3D`. The 2D renderer does not know 3D exists; they
meet in three
places that point opposite ways:

- `UI.viewport3d` — a 3D view **inside** the UI (blitted into a widget rect).
- `createUiSurface` — the UI **inside** the 3D scene (offscreen 2D → textured quad).
- `attachSceneLayer` — a full-screen GL canvas **under** the app's 2D HUD.

## Goodies and Gizmos

The lego catalog: small, tested pieces of game knowledge that otherwise get
rewritten — usually slightly wrong — in every project.

- **`Goodies` — pure recipes.** Call one, get a value. `Goodies.leadTarget`,
  `Goodies.floodFill`, `Goodies.astar`, `Goodies.lineOfSight`,
  `Goodies.distanceField`, `Goodies.weightedPick`, `Goodies.wrap`.
- **`Gizmos` — stateful gadgets.** Create once, then tick or mutate.
  `Gizmos.combo`, `Gizmos.patrol`, `Gizmos.car(body)`, `Gizmos.shuffleBag`.

Both surfaces stay flat: no nested namespaces. A recipe does not have to
justify itself against a particular sample. Admission is: recognizable, easy
to get subtly wrong, free of art direction and tuning policy, tested with an
injected `rng` / clock (never `Math.random()` or `performance.now()` inside
the recipe).

## Non-goals

These still hold:

- **No archetype ECS.** `createEcs()` is sparse-set, single-threaded, and
  optional. The priority is small code and good DX, not Bevy-weight throughput.
- **No custom rigid-body solver.** Kinematic helpers live in `Collision`.
  Real rigid-body physics is opt-in: planck/Box2D as `minimotor/physics2d`,
  Rapier as `minimotor/physics3d` (injected, not imported). The core bundle
  stays dependency-free.
- **No retained 2D scene graph.** Drawing is immediate-mode. 3D has a flat
  node array because GPU scenes need transforms; that is not a 2D display list.
- **No custom shader API for games.** 3D picks a backend and materials; games
  do not author engine shaders.

## GPU 2D

`createApp(canvas, { renderer: "webgl" | "auto" })` stacks a WebGL2 scene
canvas under the overlay. `Draw.sprites` / `Draw.tiles` / `Draw.particles` batch
there; UI, text, and `Draw.rect` stay on Canvas2D. Default is `"canvas"`.
OffscreenCanvas (plan stages 4a/4b) is still a proposal — see
`docs/plan-gpu-rendering.md`.
