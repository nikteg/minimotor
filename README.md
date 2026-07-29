# minimotor

A minimal 2D canvas framework for small games and playful apps: a fixed-step
loop, drawing, input, collision, audio, and multiplayer building blocks — all
reached through plain `PascalCase.*` namespaces, with no framework, no build
magic, and (in the core bundle) no dependencies.

```ts
// Colored square that moves with arrow keys — a complete game.
import { App, Draw, Keys, Loop, Mathf } from "minimotor";

const view = App.init("game", { background: "#222" });

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

`App.init` binds a `<canvas>` (by id or element), owns resizing and clearing,
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

**Engine runtime** — `App` (canvas + viewport + letterboxing/fullscreen),
`Loop` (fixed-step update, interpolated draw, plugins), `Draw` (rects, text,
sprites, tiles, gradients), `Keys` / `Pointer` / `Mouse` (polled input),
`Camera` (follow, shake, lenses).

**Input** — `Input.map` binds keys/gamepad buttons to named actions with edge
state; `OnscreenInput` renders an opt-in touch gamepad that shares the same
code path as a hardware pad. `pad.buttonBounds("a")` locates a virtual button
semantically for canvas automation.

**Game structure** — `Scenes` (scene stack with `Transitions` for fade/wipe),
`ECS` (tiny entity-component-system), `Fsm` (finite state machines), `Clock` /
`Timers` (pause-aware timing, coyote time, input buffering), `Signals`
(event bus), `Assets` (manifest loading with progress).

**Rendering & feel** — `Sprites` (offscreen pre-rendering, tinting, atlas
baking), `Anim` (sheet/state animation + value tweens), `Particles`, `Tiles`
(ASCII-grid levels with tileset skins and auto-tiling), `UI` (immediate-mode
buttons, panels, lists, tables, dialogs, drag-and-drop). `UI.vw`/`UI.vh`
provide constrained viewport-relative sizes; modals clamp their preferred
width inside the viewport automatically.

**Collision & math** — `Collision` (swept `moveAndSlide`, one-way platforms,
walkable slopes, `climbLadder`, `dropThrough`, swept AABB and overlap tests),
`Vec2`, `Mathf` (lerp, damp, clamp, easing, randomness). Tile legends can
declare `{ slope: "up-right" }` and `{ ladder: true }`, so the same ASCII level
drives rendering, broadphase, slopes, and climbing.

**Audio** — `Audio.sfx` (crash-safe sound effects), `Audio.music`, buses and
mixing, plus `Audio.tone` / `Audio.engine` synthesis. All WebAudio, no assets
required.

**Multiplayer** — `Net.join` opens a symmetric WebRTC room; `syncBody`/
`syncBodies` replicate lightweight or Physics2D bodies, while `syncEntities`,
`sharedItems`, typed `events`, binding/ownership, synchronized time, prediction,
diagnostics, and adverse-network simulation cover the usual multiplayer
plumbing. Pair with `minimotor/server` for authoritative rooms, input buffering,
presence, and matchmaking.

**Ready-made legos** — the small pieces of game knowledge that otherwise get
rewritten (usually slightly wrong) in every project, for any kind of game.
`Goodies` holds the **pure recipes** — call one, get a value: steering and target
leading, flood fill, line of sight, distance fields, weighted random and dice,
inventory stacking, world wrapping. `Gizmos` holds the **stateful gadgets** —
create one, then tick it: combos, patrols, trails, ability charges, checkpoint
routes, seeded RNG and shuffle bags, undo stacks, arcade car handling and
skidmarks. Both surfaces are flat: `Goodies.floodFill`, `Gizmos.combo`.

## Multiplayer quick start

```ts
const raw = await Net.join("/ws-signal", { room: "arena", fallback: "local" });
const room = Net.monitorRoom(raw);
const players = Net.syncBody(room, player);
const crates = Net.syncBodies(room, () => localCrates, { id: (crate) => crate.id });
const game = Net.events<{ shoot: Shot; damage: Damage }>(room);
const time = Net.networkTime(room);
const coins = Net.sharedItems(room, coinSpawns, {
  respawnMs: 4000,
  now: () => time.now,
  onEffect: () => sfx.coin.play(),
});

for (const remote of players) Draw.sprite(hero, { ...remote, w: 32, h: 32 });
for (const coin of coins) Draw.circle(coin, 8);
```

`syncEntities` covers arbitrary dynamic collections; `bindEntities` turns
remote states into render objects or physics proxies. `own`/`owns`/
`hasAuthority` handle authority, `createPrediction` reconciles responsive local
input, and `simulateNetwork` adds latency, jitter, and loss during development.
`syncBody`/`syncBodies` use bounded position-derived extrapolation on stable
links and automatically restore a jitter buffer when arrivals become uneven;
velocity units can be per-step or per-second. `room.meter` plugs directly into
`Perf.plugin`.

With `fallback: "local"`, an unreachable relay becomes a one-player room:
events, requests, authority, sync, and game logic keep the same code path.

Body/entity sync uses an adaptive jitter buffer by default: one send interval
on stable links, expanding when arrivals become uneven. Set `delayMs` to a
number to pin it (`0` disables the render buffer).

Use one protocol type for peer events and authoritative WebSocket games:

```ts
// protocol.ts — imported by both builds
type Game = Protocol<{
  events: { damage: { hp: number } };
  requests: { shoot: { angle: number } };
  client: { type: "input"; x: number };
  server: { type: "world"; players: Player[] };
}>;

// client
const events = Net.events<Game>(room);
events.request("shoot", { angle: 1.2 });
const server = Net.connectProtocol<Game>({ url });

// server
const room = serveProtocol<Game>(wss, {
  onMessage: (client, input) => room.broadcast({ type: "world", players }),
});
```

`events`, `requests`, client→server messages, and server→client messages are
checked from that shared file. This is compile-time safety; validate untrusted
network data at runtime when security matters.

**Odds and ends** — `Game` (score tracking, clock formatting), `Storage`
(crash-safe localStorage), `Perf` (FPS HUD and net meter).

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
