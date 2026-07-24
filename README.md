# minimotor

Minimal game engine for small 2D canvas games: a fixed-step game loop, drawing,
input, collision, audio, and multiplayer building blocks — all reached through
plain `PascalCase.*` namespaces, with no framework, no build magic, and (in the
core bundle) no dependencies.

```ts
// Colored square that moves with arrow keys — a complete game.
import { Draw, Keys, Loop, Mathf, Stage } from "minimotor";

const view = Stage.init("game", { background: "#222" });

let x = view.w / 2 - 25;
let y = view.h / 2 - 25;

Loop.run({
  update() {
    if (Keys.down("ArrowLeft")) x -= 3;
    if (Keys.down("ArrowRight")) x += 3;
    if (Keys.down("ArrowUp")) y -= 3;
    if (Keys.down("ArrowDown")) y += 3;
    x = Mathf.clamp(x, 0, view.w - 50);
    y = Mathf.clamp(y, 0, view.h - 50);
  },
  draw() {
    Draw.rect(x, y, 50, 50, "#4ecdc4");
  },
});
```

`Stage.init` binds a `<canvas>` (by id or element), owns resizing and clearing,
and returns a **live** viewport — `view.w`/`view.h` update on resize, no
rebinding needed. `Loop.run` drives fixed-step `update()` and per-frame
`draw()`. Everything else is opt-in.

## Design

- **Plain data, plain calls.** State is objects you own; the engine never asks
  you to subclass anything. UI is immediate-mode (drawn and polled every frame),
  the ECS is archetype-free, and levels/transitions/sprites are values you pass
  around.
- **Pay for what you import.** The core bundle is dependency-free. Rigid-body
  physics (the one module with a dependency, `planck`) and the Node server
  half live behind their own entry points.
- **Canvas coordinates everywhere.** Pixels, y down — including the physics
  adapter, which converts to Box2D meters at the boundary.

## Entry points

| Import                | What you get                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `minimotor`           | The whole browser engine (everything below).                                                                                       |
| `minimotor/physics2d` | `Physics2D` — rigid-body physics (stacking, joints, sleeping) as an adapter over planck/Box2D.                                     |
| `minimotor/server`    | Node-side multiplayer primitives: rooms, fixed-rate tick, WebRTC signaling, presence, matchmaking. Kept out of the browser bundle. |

## What's in the box

**Engine runtime** — `Stage` (canvas + viewport + letterboxing/fullscreen),
`Loop` (fixed-step update, interpolated draw, plugins), `Draw` (rects, text,
sprites, tiles, gradients), `Keys` / `Pointer` / `Mouse` (polled input),
`Camera` (follow, shake, lenses).

**Input** — `Input.map` binds keys/gamepad buttons to named actions with edge
state; `OnscreenInput` renders an opt-in touch gamepad that shares the same
code path as a hardware pad.

**Game structure** — `Scenes` (scene stack with `Transitions` for fade/wipe),
`ECS` (tiny entity-component-system), `Fsm` (finite state machines), `Clock` /
`Timers` (pause-aware timing, coyote time, input buffering), `Signals`
(event bus), `Assets` (manifest loading with progress).

**Rendering & feel** — `Sprites` (offscreen pre-rendering, tinting, atlas
baking), `Anim` (sheet/state animation + value tweens), `Particles`, `Tiles`
(ASCII-grid levels with tileset skins and auto-tiling), `UI` (immediate-mode
buttons, panels, lists, tables, dialogs, drag-and-drop).

**Collision & math** — `Collision` (pure, allocation-free: `moveAndSlide`
platformer resolution, swept AABB, overlap tests), `Vec2`, `Mathf` (lerp,
damp, clamp, easing, randomness).

**Audio** — `Audio.sfx` (crash-safe sound effects), `Audio.music`, buses and
mixing, plus `Audio.tone` / `Audio.engine` synthesis. All WebAudio, no assets
required.

**Multiplayer** — `Net.join(url, { room })` opens a symmetric room over
WebSocket or WebRTC; `Net.sync` declaratively replicates state, with snapshot
interpolation and roster tracking. Pair with `minimotor/server` for the Node
side.

**Grab bag** — `Goodies` (pure recipes: steering, flood fill, line of sight,
weighted random), `Gizmos` (stateful gadgets: combos, patrols, trails, arcade
car handling), `Game` (score tracking, letterboxing, clock formatting),
`Storage` (crash-safe localStorage), `Perf` (FPS HUD and net meter).

## Samples

Every module has a runnable sample under [`samples/`](samples/) — from
[`minimal`](samples/minimal/) up to complete games (`breakout`, `snake`,
`solitaire`, `pixel-adventure`, networked `road-rivals`). Run them locally:

```sh
pnpm samples        # vite dev server with an index of all samples
```

## API reference

A single-page API reference is generated from the built type declarations and
JSDoc:

```sh
pnpm build && pnpm docs:api   # writes samples/api/index.html
```

## Development

```sh
pnpm build          # compile to build/ (tsc)
pnpm dev            # tsc --watch
pnpm test           # vitest unit tests
pnpm test:e2e       # playwright end-to-end tests
pnpm verify         # typecheck (src + samples) + lint + format check
```

## License

MIT
