# minimotor

A minimal 2D canvas framework for small games and playful apps: a fixed-step
loop, drawing, input, collision, audio, and multiplayer building blocks. Every
game owns its runtime state explicitly, with no framework or build magic.

```ts
// Colored square that moves with arrow keys — a complete game.
import { App, Mathf } from "minimotor";

const game = App.create("game", { background: "#222" });
const { Draw, Keys, Loop, viewport: view } = game;

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

`App.create` binds a `<canvas>` (by id or element), owns resizing and clearing,
and returns one isolated game. Its `viewport` is **live**:
`view.w`/`view.h` update on resize without rebinding. Everything else is
imported and created only when the game uses it.

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

| Import                     | What you get                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `minimotor`                | `App` plus lightweight, stateless helpers such as `Collision`, `Mathf`, `Tiles`, and `ECS`.                  |
| `minimotor/animation`      | `createAnimation(game)` — sheets, states, effects, and motions on the game clock.                            |
| `minimotor/aseprite`       | Standalone Aseprite JSON atlas parsing and typed clip metadata.                                              |
| `minimotor/assets`         | `createAssets(game)` or standalone `createAssetStore()` — typed manifests, cache, progress, and composition. |
| `minimotor/audio`          | `createAudio(game)` — an isolated mixer owned by the game lifecycle.                                         |
| `minimotor/camera`         | `createCamera(game)` or standalone `createLens(options)`.                                                    |
| `minimotor/input`          | `createInput(game)` — action maps, contexts, and gamepad polling.                                            |
| `minimotor/ldtk`           | Standalone LDtk project, tile, entity, and world adapters.                                                   |
| `minimotor/onscreen-input` | `createOnscreenInput(game, Input)` — virtual pads registered with the same input service.                    |
| `minimotor/ui`             | `createUI(game, Input?)` — immediate-mode UI isolated to one canvas, with optional all-pad navigation.       |
| `minimotor/net`            | `createNet(game)` — multiplayer sessions and game-owned sync utilities.                                      |
| `minimotor/physics2d`      | `createPhysics2D(game)` — rigid-body physics over planck/Box2D.                                              |
| `minimotor/performance`    | `createPerformanceMonitoring(game)` plus standalone measurement utilities.                                   |
| `minimotor/scenes`         | `createScenes(game)` — typed scene stacks bound to the game clocks and viewport.                             |
| `minimotor/particles`      | `createParticles(game)` — clock-bound particle-system factory.                                               |
| `minimotor/portals`        | `createPortals(game)` — automatic level travel owned by the game loop.                                       |
| `minimotor/storage`        | `createStorage(game, options)` and `createBrowserStorage(game)`.                                             |
| `minimotor/timers`         | `createTimers(game)` — pause-aware windows, buffers, cooldowns, and jump gates.                              |
| `minimotor/server`         | Node-side rooms, fixed-rate ticks, WebRTC signaling, presence, and matchmaking.                              |
| `minimotor/cli`            | Node-only `mm` developer tools.                                                                              |

Stateful modules follow one rule:

```ts
import { App } from "minimotor";
import { createAudio } from "minimotor/audio";
import { createInput } from "minimotor/input";

const game = App.create("game");
const Audio = createAudio(game);
const Input = createInput(game);
```

Every lifecycle-owned factory requires the same game returned by `createApp`
or `App.create`. Dependencies
between optional modules stay explicit, for example
`createOnscreenInput(game, Input)`. Ownerless lower-level constructors have
different names, such as `createAssetStore()` and `createLens()`.

## What's in the box

**Engine runtime** — a game returned by `App.create` owns `Loop` (fixed-step
update), `Draw` (rects, text, sprites, tiles, gradients), `Keys`, `Pointer`,
`Mouse`, and `Clock`. `createCamera(game)` adds follow, shake, and lenses.

**Input** — `Input.map` binds keys/gamepad buttons to named actions with edge
state; `OnscreenInput` renders an opt-in touch gamepad that shares the same
code path as a hardware pad. `pad.buttonBounds("a")` locates a virtual button
semantically for canvas automation.

**Game structure** — `Scenes` (scene stack with `Transitions` for fade/wipe),
`Portals` (area/level travel through scene transitions, with multiplayer-safe
teleport snapshots),
`ECS` (tiny entity-component-system), `Fsm` (finite state machines), `Clock` /
`Timers` (pause-aware timing, coyote time, input buffering), `Signals`
(event bus), `Assets` (manifest loading with progress).

**Rendering & feel** — `Sprites` (offscreen pre-rendering, tinting, atlas
baking), `Anim` (animation and value tweens), `Aseprite` (sprite-sheet JSON),
`Particles`, `Tiles` (ASCII/Tiled levels and auto-tiling), `LDtk` (editor-authored
worlds), `UI` (immediate-mode
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

### Aseprite sprites and animations

Export a non-rotated PNG atlas plus JSON from Aseprite, then load both as one
sprite resource:

```ts
import { createAnimation } from "minimotor/animation";
import * as Aseprite from "minimotor/aseprite";
import { createAssets } from "minimotor/assets";

const Anim = createAnimation(game);
const Assets = createAssets(game);
const direct = Aseprite.sheet(image, json);

const { hero } = await Assets.load({
  hero: {
    src: new URL("./hero.png", import.meta.url).href,
    aseprite: new URL("./hero.json", import.meta.url).href,
  },
});

const animation = Anim.play(hero, "idle");
animation.set("run");
Draw.sprite(animation, player);

const death = Anim.once(hero, "death");
const icon = hero.sprite("inventory-icon");
Draw.sprite(icon, iconRect);
```

Both Aseprite JSON array and hash formats work. Tag directions (`forward`,
`reverse`, `pingpong`, and `pingpong_reverse`) and individual frame durations
are preserved. Exported frames also work as static sprites; trim placement,
layers, slices, pivots, and nine-slice centers are exposed. Passing parsed JSON
instead of its URL preserves literal tag names in TypeScript.
`hero.withImage(tinted)` reuses the metadata with an outline or palette-swapped
image. Gameplay behavior stays explicit: `play` loops, `once` does not, and
Platformer games can group one or more ordinary cursors and synchronize them
from local bodies or network snapshots:

```ts
const hero = Platformer.animations({ sprite: art.hero.play("idle") });
hero.sync(player);
```

Enable layers/tags/slices in Aseprite's sprite-sheet export to include them.
Layer entries describe the composited atlas; export split layers when they must
be rendered independently.

### LDtk conventions

Load a conventional project once. The world caches every semantic level,
painted layer, entity, and validated portal:

```ts
const world = LDtk.world(project, { image: terrain });

Collision.moveAndSlide(player, world.level(player.area));
Draw.sprites(world.sprites(player.area, assets));
Draw.tiles(world.tiles(player.area));
Portals.create({ body: player, scenes, world, scene: "game" });
```

Minimotor uses names instead of private glyph aliases. Tag an LDtk entity
definition with `mm:solid`, `mm:one-way`, `mm:ladder`,
`mm:slope:up-right`/`mm:slope:up-left`, and optionally `mm:span:2x1`.
Use `mm:marker` for named spawn points. The entity identifier becomes the
level/skin key:

```ts
const level = LDtk.grid(project, { level: "Forest", layer: "World" });
const skin = LDtk.skin(project, {
  Solid: ground,
  Ladder: ladder,
  ShallowUp: slope,
});
const start = level.spawnOne("Player");
```

`LDtk.entityTypes(project)` preserves the identifier union from literal or
generated project types. `LDtk.skin` uses that information when available and
also checks runtime-loaded JSON for missing semantic entries.

Tag an entity definition `mm:sprite` and give it an `Asset` field to keep
static scenery completely in LDtk. `world.sprites(area, assets)` resolves that
field against the loaded asset manifest and returns a cached draw list. Static
art does not need to become simulated ECS entities.

Entities that do need simulation cross into ECS through typed prefab
callbacks:

```ts
const Position = ECS.component<{ x: number; y: number }>("Position");
const Enemy = ECS.component<FieldsOf<"Enemy">>("Enemy");

world.spawn(
  ecs,
  {
    Enemy: (entity) => [Position.with({ x: entity.x, y: entity.y }), Enemy.with(entity.fields)],
  },
  area,
);
```

Unmapped LDtk entities remain level data. This keeps collision, portals,
markers, static visuals, and ECS simulation on one authored source without
making every rectangle an ECS entity.

Custom level fields are generated too, so presentation metadata stays beside
the level instead of in a parallel game-side map:

```ts
UI.text(world.fields(player.area).DisplayName);
```

An authored LDtk Tile/AutoLayer already contains source cells, positions,
draw order, opacity, and flips, so it needs no skin:

```ts
const art = LDtk.tiles(project, { level: "Forest", layer: "Art", image: terrain });
Draw.tiles(art);
```

Custom fields and trigger rectangles stay available through
`LDtk.entities`. For automatic travel, tag a portal entity definition
`mm:portal`, add a `To` EntityRef targeting another portal, and optionally set
`Transition` (`Fade`, `WipeLeft`, `WipeRight`, `WipeUp`, `WipeDown`, or
`None`) plus `TransitionMs`. `LDtk.world` resolves the destination level,
arrival position, transition, and paired-door safety automatically.

LDtk may use PNG or Aseprite artwork for editor previews, but its runtime JSON
exports tile rectangles rather than animation clips and timing. Load the
Aseprite PNG+JSON through `Assets.load`; use LDtk for placement plus a typed
`Skin`/asset identifier when a level chooses a character appearance. This
avoids duplicating `idle`/`run`/`jump` metadata in the level file.

Per-entity cursors and one-shot effects can own their lifecycle without manual
maps or splice loops:

```ts
const ghosts = Anim.keyed<string, HeroVisual>();
const visual = ghosts.get(player.id, () => makeHero(player.color));
ghosts.retain(players.map((player) => player.id));

const bursts = Anim.effects(makeBurst, (burst) => burst.animation.done);
bursts.play({ x, y });
for (const burst of bursts) drawBurst(burst);
```

`UI.minimap(level, { at, tile, points, view })` projects semantic level cells,
including real slope triangles, into a HUD rectangle. The widget owns clipping
and world-to-map projection; games retain control over colors and marker data.

The editor displays `To` as a link between entities; its exported IID is an
LDtk-managed GUID, not a game-authored ID. Restricting the field to
`mm:portal` tags and enabling LDtk's symmetrical-reference option makes paired
doors safe to edit from either end. `PortalTransition` is a local enum, so
designers cannot mistype transition names.

Generate the project-specific level and entity types once, then use its typed
world loader:

```sh
mm ldtk types assets/world.ldtk -o src/world.generated.ts
```

```ts
import { createAssets } from "minimotor/assets";
import { levelAssets, loadWorld, type LevelId } from "./world.generated.js";

const Assets = createAssets(game);
const world = loadWorld(await Assets.load(levelAssets));
let area: LevelId = world.first;
```

The output includes literal unions for levels, entities, markers, portals,
LDtk enums and custom fields. It follows external-level files too. Use
`--check` in CI to fail when the generated companion is stale, or `--stdout`
for custom pipelines. API Lab runs this generator through `pnpm ldtk:types`
and imports the result directly.

```text
$ mm --help
Minimotor developer tools

Usage:
  mm <feature> [command] [options]
  mm --help
  mm --version

Features:
  assets       Validate asset files, references, and tile dimensions.
  dev          Start a LAN-ready Vite game and optional relay.
  ldtk         Generate, validate, and watch LDtk projects.
  level        Generate, bot-test, score, or verify platformer greyboxes.
  net          Diagnose latency, jitter, loss, and snapshot rates.
  new          Create minimal game projects from terse templates.
  test         Run headless Playwright game and screenshot tests.

Run mm <feature> --help for feature-specific usage.
```

Common workflows stay short:

```sh
mm new multiplayer my-game
mm dev --relay "pnpm server"
mm ldtk check assets/world.ldtk
mm ldtk watch assets/world.ldtk -o src/world.generated.ts
mm level test
mm level simulate --levels 20 --rounds 4 --bots 12 --attempts 4 --layout varied
mm assets check . --tile-size 16
mm net doctor --latency 40 --jitter 12 --loss 2
mm test
```

`mm level test` starts the standalone human rating interface.
`mm level simulate` runs generated candidates through an exact headless
platformer simulation: a beam-search planner proves completion, then noisy
expert, intermediate, beginner, and completionist personas replay the plan.
Multiple rounds adjust generator difficulty from population success. The
generator varies between open surface routes, enclosed tunnel/chamber routes,
and mixed routes that descend underground and return outside. Use `--layout`
to constrain that grammar, and `--dataset`, `--report`, `--replay`, and `-o`
to retain the complete result.

### The same world without an editor

String maps retain the complete gameplay feature set. Area names are inferred
from the object keys:

```ts
const world = Tiles.world(
  {
    field: "P..A..\n######",
    cave: ".B....\n######",
  },
  {
    size: 16,
    legend: { "#": { solid: true } },
    portals: [
      {
        between: ["field:A", "cave:B"],
        transition: "fade",
        transitionMs: 260,
      },
    ],
  },
);

const player = { ...body, area: world.first }; // "field" | "cave"
Collision.moveAndSlide(player, world.level(player.area));
Draw.tiles(world.level(player.area), skin);
Portals.create({ body: player, scenes, world, scene: "game" });
```

`between` makes a paired door; `from`/`to` makes a one-way portal.
`world.markers("P")` queries a marker across every area. ASCII worlds use
skins because the strings intentionally contain semantics rather than pixels;
LDtk Tile/AutoLayers can carry their finished visuals directly.

## Multiplayer quick start

One call joins the room; `share` puts something on it and hands back everyone
else's copy, interpolated and ready to draw. If no relay answers you get the
same object back for a solo game, so there is no offline branch to write:

```ts
const net = await Net.game<GameEvents>({ room: "arena" });
const players = net.share(player);

player.color = Net.playerColor(net.index); // stable slot → distinct color
const coins = net.items(coinSpawns, { respawnMs: 4000, onEffect: () => sfx.coin.play() });
net.events.on("shoot", (shot, from) => spawnBullet(shot, from));

for (const other of players) Draw.sprite(hero, { ...other, w: 32, h: 32 });
for (const coin of coins) Draw.circle(coin, 8);
```

**The same primitives run peer-to-peer or client/server.** One option picks the
topology; nothing else in your game changes:

```ts
const net = await Net.game({ room: "arena" }); // p2p mesh
const net = await Net.game({ room: "arena", server: "/ws-rooms" }); // dedicated server
```

Both give you a `Room`, and `share`, `events`, `items`, `hostState`, `sync`,
`syncBody` and `networkTime` are written against `Room` alone. The server half
is one call:

```ts
import { WebSocketServer } from "ws";
import { rooms } from "minimotor/server";
rooms(new WebSocketServer({ port: 8080 })); // ids, membership, host election, relay
```

What differs is only what a topology can honestly promise: a mesh routes
through an elected peer and heals when that peer drops, while a server is the
route and authenticates every frame's sender; a WebSocket is always reliable,
so `reliable: false` is a permission it never needs to use.

`share` takes anything, once per thing you replicate. A body-shaped state
(`x`/`y` plus `vel` or `vx`/`vy`) automatically takes the packed binary path
with shortest-arc rotation blending; any other shape travels as JSON. Point it
at another relay, or through TURN, without touching the transports:

```ts
const net = await Net.game({
  url: "wss://relay.example.com/ws-signal",
  ice: [{ url: "turn:turn.example.com:3478", username, password }],
});
```

`net.room` is the room underneath, and every piece `Net.game` assembles stands
on its own when you want a different mix:

```ts
const room = Net.monitorRoom(await Net.join("/ws-signal", { room: "arena", fallback: "local" }));
const players = Net.syncBody(room, player);
const crates = Net.syncBodies(room, () => localCrates, { id: (crate) => crate.id });
const events = Net.events<{ shoot: Shot; damage: Damage }>(room);
const time = Net.networkTime(room);
```

Rooms carry two delivery lanes so both kinds of traffic get what they need.
`room.send` is **reliable and ordered** — for events, commands, pickups and
chat, which are facts you cannot recover by waiting. Snapshots go out
**unreliable and unordered** (`send(msg, { reliable: false })`, or the packed
binary lane `sendBytes`), because a lost sample is already replaced by the next
one and retransmitting it would only delay everything behind it. `syncBody`
packs body snapshots into that binary lane automatically — roughly a third the
size of the equivalent JSON, with no `JSON.parse` on the hot path.

`syncEntities` covers arbitrary dynamic collections; `bindEntities` turns
remote states into render objects or physics proxies. `own`/`owns`/
`hasAuthority` handle authority, `createPrediction` reconciles responsive local
input, and `simulateNetwork` adds latency, jitter, and loss during development.
`syncBody`/`syncBodies` use bounded position-derived extrapolation on stable
links and automatically restore a jitter buffer when arrivals become uneven;
velocity units can be per-step or per-second. `room.meter` plugs directly into
`createPerformanceMonitoring(game, { net: room.meter })`.

With `fallback: "local"`, an unreachable relay becomes a one-player room:
events, requests, authority, sync, and game logic keep the same code path.

Body/entity sync uses an adaptive jitter buffer by default: one send interval
on stable links, expanding when arrivals become uneven. Set `delayMs` to a
number to pin it (`0` disables the render buffer).

Snapshots carry the **sender's** clock, and each receiver maps that onto its own
from the fastest packet it has seen. Buffering by arrival time instead is the
classic source of jittery, rubber-banding remote players: a fixed-step sender
emits snapshots in bursts, so two that left 16 ms apart routinely land 1 ms
apart, and any blend that trusts arrival gaps reads that as 1 ms of motion and
then scales it back up.

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
