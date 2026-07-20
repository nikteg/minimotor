# Minimotor — Engine Architecture & Roadmap

Minimotor is growing from a helper library into a **full-fledged 2D game engine**.
This document is the agreed shape of that engine. It is a design doc, not a
commitment to dates — but the layering, the ECS model, and the non-goals are
decisions we build against.

## Vision

A small, dependency-free, TypeScript-first 2D engine that scales from "colored
square that moves with the arrow keys" to a real game with scenes, many
entities, loaded art, animation and tilemaps — **without ever forcing structure
you don't need**. You can always drop to a raw `ctx` and a plain
`Loop.run({ update, draw })`.

### Status legend

- ✅ shipped · 🟡 partial · ⬜ planned

## The layered architecture

```
┌─ L4  Content     Assets · Anim · Tiles · Particles · Transitions · UI
├─ L3  Structure   ECS(World) · Scenes · Clock · Tween · Signals          ← the engine core we're adding
├─ L2  Primitives  Mathf · Goodies · Collision · Camera · Sprites · Text · Physics
└─ L1  Platform    Stage · Loop · Draw · Keys · Pointer · Audio · Storage · Net · Perf · Fullscreen · Input
```

Each layer builds only on the layers below it. Everything above L1 is **opt-in**:
the structure and content layers are conveniences over the same primitives, not a
mandatory framework. Immediate-mode drawing (you draw in `draw()`/render systems)
is preserved at every layer — there is no retained scene graph to keep in sync.

## L1 — Platform ✅

The host and I/O. Reached through PascalCase `Minimotor.*` namespaces backed by
one default engine built by `Stage.init()`.

- ✅ `Stage` — canvas/viewport/DPR, safe-area insets, `onResize`, `pauseOnPortrait`
- ✅ `Loop` — fixed-step accumulator, per-step edge-clearing, `frameScale`
- ✅ `Keys` / `Pointer` — polled input (`down`/`pressed`/`released`)
- ✅ `Draw` — `ctx`, `frameScale`
- ✅ `Audio` — crash-safe SFX + scheduled `Music`
- ✅ `Storage`, `Net`, `Perf`, `Fullscreen`, `Input` (incl. `Input.vibrate`
  haptics, `Input.actions` mapping, `Input.gamepad` polling with edge semantics)
- 🟡 backlog: audio sampled buffers, orientation lock, service-worker/PWA
  helper, `ImageBitmap` asset decode

## L2 — Primitives 🟡

Pure, data-agnostic helpers. No engine state.

- ✅ `Mathf` — lerp, clamp, remap, pulse, wave, easing set, `randRange`,
  `randInt`, `randItem`, `distance`, `angleBetween`
- ✅ `Goodies` — the intentional game-recipe grab bag. It collects essential,
  tested patterns shared by arcade, grid, platformer, shooter, roguelike and
  other genres. Shipped: `wrap`, `wrappedDelta` and `wrappedDistance`.
- ✅ `Collision` — rectsOverlap, circleHit, crossedDown, `sweptAABB` (tunneling)
  (add: circleRect), `pointInRect` (shipped — powers `UI.button` hit-testing)
- ✅ `Camera` — `createCamera` (lerp follow + clamp), `scrollColumns` parallax,
  `shake` (decaying screen-shake, aged on the fixed step)
- ✅ `Sprites` — `getSprite` (square) + `getLayer` (arbitrary offscreen cache)
- ✅ `Text`, `Physics` (kinematic helpers/constants)

### `Goodies` recipe catalog

`Goodies` is deliberately broad. It is where a developer should look for the
small pieces of genre knowledge that otherwise get rewritten in every game.
Recipes may combine lower-level Minimotor primitives, but remain plain functions
or tiny state objects—never a mandatory gameplay framework.

**Shipped — wrapping worlds (Snake, Asteroids, arena games):**

- `wrap(value, max)` / `wrap(value, min, max)`
- `wrappedDelta(from, to, size)`
- `wrappedDistance(ax, ay, bx, by, worldW, worldH)`

**Candidate recipe families:**

- **Grid / roguelike:** cardinal and diagonal neighbors, grid keys, flood fill,
  grid line traversal, random empty-cell selection and shuffle bags.
- **Arcade / shooter:** target leading, angle approach with wraparound, fire-rate
  gates, object recycling across arena edges and score/combo chains.
- **Platformer:** jump intent recipes that compose `Timers.jumpGate`, drop-through
  intent and reusable patrol/turn-at-edge logic. Collision resolution remains in
  `Tiles`; gravity and jump tuning remain game policy.
- **Loot / RPG:** weighted selection, without-replacement bags, bounded stat
  modifiers and cooldown/charge recipes.
- **Strategy / simulation:** fixed-rate accumulators, spatial bucket iteration
  and deterministic seeded selection once a seeded RNG primitive exists.
- **Camera / presentation:** trauma-style shake accumulation, hit-stop gates and
  reusable world-to-HUD indicators, composed from `Camera`, `Timers` and `UI`.

**Admission rules:** a recipe should be recognizable to game developers, useful
across more than one game, significantly easier to get subtly wrong than its API
suggests, and small enough to explain with one example. It does not need to fit a
single genre or wait for repeated local implementations before being added.
Low-level scalar math stays in `Mathf`; geometric tests stay in `Collision`;
rendering stays in `Sprites`; scheduling stays in `Timers`/`Clock`. `Goodies`
composes those pieces into common game behavior.

Every shipped recipe needs deterministic unit tests and at least one sample that
uses it. Recipe families should remain flat and discoverable initially; introduce
nested namespaces only when name collisions or catalog size make them useful.

## L3 — Structure (the engine core) ✅

### 3a. ECS — `Minimotor.ECS` / `World` ✅ (core; systems in 3d/M3)

The object model is a **minimal-ceremony ECS**: sparse-set storage, plain-data
components, immediate-mode render systems, deterministic fixed-step. It is _not_
an archetype/Bevy-weight ECS — the priority is small code and good DX for
small-to-medium 2D games.

**Components** are plain-data schemas with a typed handle:

```ts
const Position = Minimotor.ECS.component<{ x: number; y: number }>("Position");
const Velocity = Minimotor.ECS.component<{ x: number; y: number }>("Velocity");
const Sprite = Minimotor.ECS.component<{ img: HTMLCanvasElement }>("Sprite");
```

**Entities** are ids; components are attached/queried through the world:

```ts
const world = Minimotor.ECS.world(); // or Minimotor.World (default)

const e = world.spawn(Position.with({ x: 0, y: 0 }), Velocity.with({ x: 1, y: 0 }));
world.add(e, Sprite, { img: coinCanvas });
world.get(e, Position).x += 1;
world.has(e, Velocity);
world.remove(e, Sprite);
world.despawn(e); // deferred to end of step
```

**Queries** iterate all entities holding a component set (smallest set drives
iteration; others checked via sparse-set membership). Order is stable by entity id:

```ts
for (const [e, pos, vel] of world.query(Position, Velocity)) {
  pos.x += vel.x;
  pos.y += vel.y;
}
```

**Systems** are named functions run each phase, in registration order. Update
systems run in the fixed-step `update`; render systems run in `draw` with the ctx —
keeping drawing immediate-mode:

```ts
world.system("movement", (w) => {
  for (const [, p, v] of w.query(Position, Velocity)) {
    p.x += v.x;
    p.y += v.y;
  }
});
world.renderSystem("sprites", (w, ctx) => {
  for (const [, p, s] of w.query(Position, Sprite)) ctx.drawImage(s.img, p.x, p.y);
});
```

You are never _required_ to write systems — a `Scene.update` may query inline. Systems
are just the ordered, named form. ✅ Shipped: `world.system`/`renderSystem` (ordered,
replace-by-name) and `world.update()`/`draw(ctx)`.

**Determinism & safety.** `world.update()` ticks update systems once per fixed
step. Structural changes (`spawn`/`despawn`/`add`/`remove`) issued during
iteration are recorded in a command buffer and applied at end-of-step, so
iteration never mutates mid-flight and replays stay deterministic.

**Storage.** v1: sparse set per component (dense array + id→index map). The public
API hides this so we can move hot components to typed-array SoA later without
breaking games.

**Built-in sprite rendering** ✅. The engine ships one standard component,
`ECS.Sprite` — `{ x, y, img, w?, h?, ax?, ay?, rot?, scale?, alpha?, z?, visible? }`
— and `world.drawSprites(ctx)`, which z-sorts and blits every sprite (anchor /
rotation / scale / alpha honored). The common case (entity = position + texture)
needs **no draw code**; drop to a manual `ctx` query only for custom visuals.
Proof: the particles sample's hand-written blit loop is gone (`world.drawSprites`),
and its `Life` component folded into `Sprite.alpha`.

### 3b. Scenes — `Minimotor.Scenes` ✅

A scene stack replaces the hand-rolled `game.state = "menu"|"playing"|"gameover"`

- branching that every current game duplicates.

```ts
Minimotor.Scenes.define("play", {
  world: playWorld, // optional: a Scene may own a World
  enter() {},
  update() {},
  draw() {},
  exit() {},
});
Minimotor.Scenes.go("menu"); // swap: exit old → enter new
Minimotor.Scenes.push("pause"); // overlay: 'play' still draws underneath
Minimotor.Scenes.pop();
```

Once any scene is defined, `Loop.run()` dispatches to the active stack (top scene
updates; the stack draws bottom-to-top). If a scene declares a `world`, the scene
default-wires `world.update()` / `world.draw(ctx)`. Fully backward compatible: the
plain `Loop.run({ update, draw })` form still works with no scenes.

### 3c. Clock, Tween, Signals — `Minimotor.Clock` / `Tween` / `Signals` ✅

Deterministic time and decoupling. Clock/Tween tick on the fixed update step (via
`Loop.onStep`) and pause with the loop; Signals is a synchronous bus.

```ts
Minimotor.Clock.after(600, unlockRestart);
Minimotor.Clock.every(1000, spawnWave);
Minimotor.Tween.to(text, { y: text.y - 30, alpha: 0 }, 450, Mathf.easeOut);
Minimotor.Signals.on("score", (n) => (hud.score = n));
Minimotor.Signals.emit("score", 10);
```

## L4 — Content 🟡

The gap between "toy" and "full-fledged": loaded art and level data.

```ts
await Minimotor.Assets.load({ hero: "hero.png", tiles: "tiles.png", jump: "jump.wav" });
const run = Minimotor.Anim.sheet(Minimotor.Assets.get("hero"), { fw: 32, fh: 32, fps: 12 });
run.draw(ctx, x, y); // advances by loop dt

const map = Minimotor.Tiles.grid(levelData, { tw: 16, atlas: Minimotor.Assets.get("tiles") });
map.draw(ctx, camera);
map.solidAt(x, y);
```

- ✅ `Assets` — `load(manifest, onProgress?)` preloads images + JSON (kind by
  extension), cached by name; `image`/`json`/`get`/`has`/`clear`. (Audio
  preloading deferred — the WebAudio path lives in `Audio`.)
- ✅ `Anim` — `Anim.sheet(img, { fw, fh, fps, frames?, cols?, loop? })`: grid
  slicing + dt-advanced timeline (`update`/`rect`/`frame`/`done`/`reset`/`draw`).
  `Anim.states({ idle, run, jump }, "idle")` combines clips behind a named
  state player without restarting the current clip every update. Feeds the ECS
  `Sprite` source-rect (`sx/sy/sw/sh`), so animated entities render through
  `world.drawSprites`. Proof: the `sprites` sample (procedural sheet) and Pixel
  Adventure (idle/run/jump/fall/hit state transitions).
- ✅ `Tiles` — `Tiles.grid(data, { tw, atlas?, colors?, solid? })`: plain
  `number[][]` levels, atlas (firstgid=1) or color-table rendering culled to a
  view rect, `at`/`set`/`tileAt`/`solidAt`/`solidInRect` queries. Proof: the
  `tiles` sample (scrolling platformer, tile-snap collision, gamepad).
- ✅ `Particles` — `Particles.burst(x, y, opts)` CPU emitter (velocity, gravity,
  size/life/color ranges, fade), aged on the fixed step. Pooled flat array, not
  ECS — high churn, no queries. Used for hoppspelet's death burst + coin sparkle.
- ✅ `Transitions` — cover → swap → reveal scene transitions: `fade`/`wipe`
  builders (a `Transition` is plain data — duration + a render(t) — so custom
  ones are one object literal), pure fixed-step runner, and `Scenes.go(name,
spec?)` integration (swap fires behind full coverage). Proof: the `scenes`
  sample fades into play and wipes down into game over.
- ✅ `UI` — immediate-mode interface helpers: `float`/`drawFloats` (rising,
  fading score/damage text, aged on the fixed step), `button` (drawn +
  hit-tested by one call, `disabled` state, `buttonState` exported for custom
  looks), `bar` (clamped meter), `panel` (framed/titled box), `toggle`
  (checkbox), `tabs` (strip), `row` (selectable list row) and `scrollbar`
  (wheel + thumb drag + track paging, backed by `Pointer.wheel`/
  `framePressed`), `slider`, `spinner`, `popover` (outside-click closes),
  `modal` (dimmed backdrop that really blocks background input) and hover
  `tooltip`s with a stability delay. All colors/fonts flow from a `Theme`
  (`setTheme` restyles the whole kit); interactive widgets request the hand
  cursor via the engine's per-frame `setCursor`. `text` draws themed labels
  (size/bold/color roles/align, clamped) so a screen never touches
  `ctx.font`/`fillText`; `clip` masks a scroll region without hand-rolled
  save/clip/restore. **Closure containers** (egui-style): `row`/`col`/`group`
  take a children callback, push an ambient layout cursor, and widgets inside
  auto-flow and auto-size — nesting is the layout tree, and a nested widget's
  click bubbles straight out of the callback's return. `listItem` is the
  selectable list row (renamed from `row`). Layout, two tools: `flex` —
  split a box into named regions (nested row/col containers, fixed sizes +
  flex-grow shares, gap/pad, flat rect map out; recompute per frame and
  resize comes free) — and `stack`, a one-axis cursor that widgets place
  themselves into via `at`, auto-sizing to their labels (flex sizes may be
  measure fns for content-fit). All labels clamp to their boxes so no
  theme/font can overflow. The `Theme` covers metrics too — `borderWidth`,
  corner `radius`, `buttonPadX`, plus `primary`/`danger` fills — and buttons
  take a `variant` (`default`/`primary`/`danger`/`ghost`). `confirm()` is a
  whole dialog (title/lines/buttons, content-sized, last button primary by
  default) in one call. **Implicit ctx** — widgets draw to the default
  game's `Draw.ctx`, no plumbing (`UI.begin(ctx)` overrides per frame for
  isolated games; every widget also keeps a `(ctx, opts)` form). Overlays
  (modal AND open popover) capture input: widgets drawn before them go dead,
  so clicks can't fall through. No retained widget tree — everything draws in
  your draw phase. Game-specific overlays (copy/layout)
  stay in the samples' `overlays.js`, where they belong.

## Opt-in entry points ✅

Modules behind their own `exports` subpath, outside the core import graph —
the only place third-party dependencies are allowed. Games that don't import
them pay nothing; the plain `minimotor` entry stays dependency-free.

- ✅ `Physics2D` (`minimotor/physics2d`) — rigid-body physics adapter over
  planck (Box2D): bodies, walls, revolute joints with motors, contacts,
  deferred destroy — addressed in pixels, ticked on the fixed step.

## Sample primitive policy

Every sample should use the highest-level shipped primitive that makes its code
clearer, and together the gallery must exercise the complete public surface:

- All playable samples use `UI` for HUD text/panels/meters and overlays.
- Dynamic unordered entity sets use `ECS`; deliberately ordered structures such
  as a snake body and single-object minimal demos remain plain data.
- Repeated or expensive raster art uses `Sprites.getSprite`/`getLayer`; direct
  canvas drawing remains appropriate for unique vector art and teaching raw
  `draw(ctx)`.
- Samples use `Camera`, `Tiles`, `Anim`, `Particles`, `Scenes`, `Timers`, `Fsm`,
  `Assets` and the genre recipes in `Goodies` where gameplay demonstrates them.
- A migration must delete local infrastructure. Merely wrapping data in ECS or
  calling an engine helper without reducing code is not considered adoption.

Current proof migrations include `Goodies.wrap` in Snake, toroidal helpers in
Pocket Asteroids, wrapped ECS sprites in the Sprites sample, `Sprites.getLayer`
for Pixel Adventure's cached world art, and `UI.panel`/`UI.text` for the legacy
Platformer HUD.

## Design principles (what keeps it _minimotor_)

1. **Opt-in layers** — raw `ctx` and plain `Loop.run` always work; nothing above
   L1 is mandatory.
2. **Plain-data everywhere** — components and tween targets are plain objects.
   No inheritance requirement; the ECS owns _storage_, never your _types_.
3. **Immediate-mode drawing, retained-mode state** — render systems draw with
   `ctx`; no node tree to sync.
4. **Global-uniform** — `ECS`/`Scenes`/`Clock`/`Assets` are `Minimotor.*`
   namespaces over the one default engine, exactly like `Stage`/`Loop`. A default
   `Minimotor.World` exists for the simple case; scenes can own their own worlds.
5. **Deterministic fixed-step** — systems, timers, tweens and physics tick in
   `update`; structural changes are deferred via command buffer.
6. **No bundler required** — must build with plain `tsc`; tree-shakeable so a game
   pays only for what it imports.

## Non-goals

- **Archetype/graph ECS, multithreaded systems, worker parallelism** — v1 stays
  sparse-set and single-threaded; revisit only if a real game needs the throughput.
- **Writing our own rigid-body solver** — the core keeps light kinematic
  helpers only. Real rigid-body physics ships as the opt-in `Physics2D`
  adapter over planck (Box2D) behind its own `minimotor/physics2d` entry, so
  the core bundle stays dependency-free (see milestone 11).
- **A retained scene graph** with mandatory transform nodes — fights immediate mode.
- **WebGL/WebGPU rendering** in v1 — the whole draw surface is Canvas2D
  (`Draw.ctx`, sprites, tiles, particles). If a real game ever outgrows 2D
  canvas throughput, a GL sprite batcher could slot in behind `world.drawSprites`
  without changing the plain-data API — but not before profiling demands it.
- **A serialization/save format** in v1 — the ECS API is designed to allow it later.

## Pixel Adventure engine-extraction plan

Pixel Adventure is the proving ground for the next engine additions. Extraction
must remove duplicated, error-prone infrastructure without moving game rules or
art direction into Minimotor. Each phase lands independently with unit tests and
a sample migration; no phase is accepted merely because an API exists.

### Extraction rules

1. **Generalize only demonstrated pain.** A helper must solve the same class of
   problem in Pixel Adventure and at least one other sample (normally `tiles`,
   `platformer` or `assetquest`).
2. **Keep policy explicit.** Full-solid collision is the default. One-way
   platforms, slopes and special tiles are opt-in policies, never inferred from
   level shape.
3. **Keep data plain.** Helpers consume/return rectangles, deltas and flags;
   they do not require ECS entities, inheritance or a retained scene graph.
4. **Preserve escape hatches.** Raw tile queries, canvas transforms and browser
   audio remain available when a game needs custom behavior.
5. **Profile before expanding rendering APIs.** Existing primitives are reused
   before adding another cache or renderer abstraction.

### Phase 1 — kinematic tile movement (highest priority) ✅

**Shipped** as `map.moveAABB(rect, dx, dy, opts?)` on the `TileMap` (a method,
not a free function — it already has the grid/solidity). Contract below is met
in full, with unit tests (floor/ceiling/walls, corner, large-delta sweep,
spawn-overlap, out-of-map, solid filter, one-way, applied-delta) and the
`tiles` sample migrated off its hand-rolled move-one-axis/test/snap code.
Pixel Adventure migration follows in its own pass.

**Problem:** samples repeatedly implement move-one-axis/test/snap logic. Small
mistakes cause underside sticking, corner jitter, tunneling or accidental
one-way behavior.

**API:** a pure `map.moveAABB(rect, dx, dy, options?)` primitive returning the
resolved rectangle plus contact flags:

```ts
const hit = Tiles.moveAABB(map, playerRect, vx * dt, vy * dt);
playerRect = hit.rect;
if (hit.bottom) vy = 0;
if (hit.top) vy = Math.max(0, vy);
```

The exact name may change during implementation, but the contract is fixed:

- X and Y resolve independently to exact tile boundaries.
- Every solid tile blocks from every direction by default.
- The result reports `left`, `right`, `top` and `bottom` contacts.
- Large deltas sweep through crossed cells instead of tunneling.
- Optional collision filtering receives tile id/cell/direction.
- One-way behavior, if added, requires an explicit option or tile predicate and
  uses previous-position crossing tests.
- The helper does not own velocity, gravity, input or character state.

**Tests:** floor landing, ceiling hit, both side walls, diagonal corner slide,
large-delta sweep, exact edge contact, spawn-overlap recovery, ragged rows,
out-of-map behavior, filtered/non-solid tiles, and explicit one-way platforms.

**Proof migrations:** Pixel Adventure first; then the `tiles` sample. Delete the
sample-local cell iteration/resolution code after parity is verified.

### Phase 2 — virtual viewport and camera presentation

**Problem:** fixed-resolution samples duplicate letterbox calculation, save /
translate / scale / restore sequences, camera zoom math, pixel rounding and
screen-to-world pointer conversion. It is easy for terrain, entities, effects
and input to end up in different coordinate spaces.

**Proposed API:** evolve `Game.letterbox` into a small virtual-view object rather
than a hidden renderer:

```ts
const view = Game.virtualView({ w: 480, h: 270, pixelPerfect: true });
const frame = view.begin(ctx, Stage.viewport, camera);
// draw world in world coordinates
frame.end();
const worldPoint = frame.toWorld(Pointer.x, Pointer.y);
```

**Required behavior:** balanced canvas state, fit/fill modes, optional integer
scaling, camera zoom around the visible world region, stable pixel rounding,
`toWorld`/`toScreen`, resize-safe metrics and a separate stable HUD transform.
The API must not clear or choose colors unless requested.

**Tests:** common aspect ratios, ultrawide/tall viewports, fractional DPR,
zoom below/above 1, camera offsets, coordinate round-trips and transform-state
restoration.

**Proof migrations:** Pixel Adventure and Pocket Asteroids. Pocket must retain
its mobile-only letterbox policy.

### Phase 3 — loaded sampled audio

**Problem:** Pixel Adventure bypasses Minimotor and creates browser `Audio`
elements manually. That loses the engine SFX bus and makes overlapping pickups,
preload progress and first-gesture behavior inconsistent.

**Proposed split:** `Assets` fetches/caches audio bytes as part of the manifest;
`Audio` owns decode, playback and voice pooling:

```ts
await Assets.load({ coin: "coin.wav" });
const coin = Audio.sample(Assets.audio("coin"), { voices: 4, volume: 0.4 });
coin.play();
```

**Required behavior:** progress reporting, lazy WebAudio decode when gesture
rules require it, polyphonic playback, bus volume/mute, safe no-audio fallback,
retriggering without resetting another active voice, and cleanup on engine
destroy. Loading bytes must not itself require a user gesture.

**Tests:** asset kind detection, fetch/decode failures, concurrent voices,
voice reuse, bus gain, muted playback, unsupported browser APIs and teardown.

**Proof migrations:** Pixel Adventure pickup/jump/hurt effects, followed by one
synthesized-SFX sample to demonstrate sampled and generated audio coexistence.

### Phase 4 — reuse and assess static render layers

Pixel Adventure's sky and terrain caches should migrate from hand-created
canvases to the already-shipped `Sprites.getLayer`. This is initially a sample
refactor, **not a new engine feature**.

After migration, profile cache creation, memory, DPR changes, resize invalidation
and 120 Hz rendering. Extend `getLayer` only if profiling demonstrates a missing
capability, likely one of:

- explicit invalidation by cache key,
- byte/pixel budget with least-recently-used eviction,
- an unscaled pixel-art mode,
- or an `OffscreenCanvas` backend where supported.

Do not add a second render-target abstraction unless `getLayer` cannot satisfy
both Pixel Adventure and another sample.

### Features that stay in game code

- Fruit pickup choreography, colors, star layout and timing.
- Player acceleration, gravity, jump height, damage and stomp rules.
- Level-specific tile meaning, enemy patrol behavior and win conditions.
- HUD copy/composition and camera-follow tuning.

A generic "pickup effect" or "platformer character" object would bundle policy
and presentation, work for one sample, and fight Minimotor's opt-in primitives.
The engine should provide shake, particles, floats, animation, collision and
timing; the game composes them.

### Delivery order and completion gate

1. Ship and migrate kinematic tile movement.
2. Ship and migrate virtual viewport transforms.
3. Ship sampled-audio loading/playback.
4. Migrate static caches to `Sprites.getLayer`, then profile before extending.

The extraction wave is complete when Pixel Adventure contains no custom generic
collision solver, no manual letterbox/camera transform plumbing, no direct
`new Audio()`, and no manual offscreen-canvas creation—while preserving its
current controls, fully solid platforms, animation states, visual effects and
120 Hz target.

## Character composition — state machines & timing ✅

Games keep asking for "a platformer character": coyote time, jump buffering,
wall jumps, state-driven animation. A bundled character controller is a stated
non-goal (it fuses policy — jump heights, impulse directions, gravity — that
belongs to the game). The engine's job is the small, pure, reusable
**mechanisms** those characters compose.

**Shipped:** `Fsm` (general state machine + `Anim.states` bridge) and `Timers`
(`window`/`buffer`/`cooldown` latches + the composed `jumpGate`). Proven in
two samples: `platformer` gained coyote time + buffering by feeding its jump
edge through `Timers.jumpGate` (impulse + variable-height cut still game code);
`pixel-adventure` drives its player animation through `Fsm.create({...}, { anim })`
(the hand-mirrored `anim.play()` expression is gone) and jumps through the same
gate. Wall jumps remain composed from `moveAABB` contacts (see below), with no
wall-jump util and no `Platform` namespace. Unit tests cover both modules.

### `Fsm` — a general finite state machine (L3, beside Scenes) ⬜

A logic state machine: named states with `enter`/`update`/`exit`, where a
state's `update` returns the next state name (falsy = stay) and `go(name)`
forces a transition (firing exit → enter). Plain data, no inheritance.

```ts
const sm = Minimotor.Fsm.create(
  {
    idle: { update: () => (moving ? "run" : grounded ? null : "fall") },
    run: { update: () => (!grounded ? "fall" : moving ? null : "idle") },
    jump: { enter: () => (vy = -JUMP), update: () => (vy >= 0 ? "fall" : null) },
    fall: { update: () => (grounded ? "idle" : null) },
    hurt: { enter: () => hurtClock.start(), update: () => (hurtClock.done ? "idle" : null) },
  },
  "idle",
);
sm.update(dtMs); // runs the active state; a returned name transitions
sm.state; // active name;  sm.is("jump");  sm.go("hurt")
```

**Maps to `Anim.states`:** they share the named-state shape but are different
layers — `Fsm` is game logic (enter/exit/update), `Anim.states` is a clip
timeline (`play`/`rect`/`done`). They are NOT merged. They pair in one line
(`anim.play(sm.state)`), and `Fsm.create(states, initial, { anim })` will
optionally auto-`play(newState)` on every transition when a clip of that name
exists — the common case where logical state and animation state are 1:1
(Pixel Adventure's idle/run/jump/fall/hit). Scenes stays the app-level stack;
`Fsm` is the per-entity machine.

### `Timers` — polled timing latches (coyote, buffer, cooldown) ⬜

Not platformer-specific — grace windows, buffered inputs and cooldowns recur in
top-down, shmup and action games too. Three tiny pure factories, ticked on the
fixed step, holding only a countdown:

```ts
const coyote = Minimotor.Timers.window(100); // grace after a condition drops
const jumpBuf = Minimotor.Timers.buffer(120); // an input honored slightly early
const dashCd = Minimotor.Timers.cooldown(500); // a reusable-after-delay gate

// each fixed step:
if (grounded) coyote.charge();
coyote.tick(stepMs);
jumpBuf.tick(stepMs);
dashCd.tick(stepMs);
if (Keys.pressed("Space")) jumpBuf.trigger();
if (coyote.active && jumpBuf.consume()) {
  vy = -JUMP;
} // coyote + buffered jump
if (dashCd.ready() && dash) {
  doDash();
  dashCd.use();
}
```

- `window(ms)`: `charge()` refills; `active` true during `ms` after the last
  charge — coyote time, "recently damaged", grace periods.
- `buffer(ms)`: `trigger()` arms; `consume()` returns true once if armed within
  the window, then clears — jump/attack buffering.
- `cooldown(ms)`: `ready()` while elapsed; `use()` restarts the timer.

### Wall jumps stay composed, not a helper ⬜

`moveAABB` already reports `left`/`right` contact — that IS the wall detection.
A wall jump is then `Timers` + a game-chosen impulse:

```ts
if ((hit.left || hit.right) && jumpBuf.consume()) {
  vy = -WALL_JUMP_UP;
  vx = hit.left ? WALL_JUMP_PUSH : -WALL_JUMP_PUSH; // away from the wall
}
```

Bundling the impulse magnitudes/direction into a `Platform.wallJump()` would be
policy for one game. So there is **no wall-jump util and no `Platform`
namespace**: `moveAABB` stays on `Tiles` (tile data lives there; top-down games
use it too), and the platformer story is composition —
`Tiles.moveAABB` + `Fsm` + `Timers` + `Anim.states` + `Camera` + `Particles`.
The **proof** is a Pixel Adventure / platformer sample gaining coyote time,
jump buffering and wall jumps with no new "controller" object.

### Deliberately NOT added

- A `PlatformerController` / character object (policy + presentation bundle).
- Variable jump height, air control, gravity curves — one-line game code
  (`if (!held && vy < 0) vy *= 0.5`), not worth an API.
- Slopes and moving platforms — revisit only if a `moveAABB` extension is
  demonstrably needed by two samples (a future extraction phase, if ever).

## Build milestones

Each milestone lands with **tests** and a **refactor of a real game** (a sample or
hoppspelet) as proof it actually simplifies code — the discipline used so far.

1. ✅ **Scenes** — stack + `Loop` dispatch (`define`/`go`/`push`/`pop`, enter/exit
   lifecycle, stacked draw). Shipped with `scenes.ts` + tests and a `scenes` sample
   (menu → play → pause overlay → game over).
2. ✅ **ECS core** — `world.spawn/add/get/has/remove/despawn/query/count/flush`,
   generational ids, sparse-set storage, typed variadic queries, iteration-safe
   command buffer. Shipped with `ecs.ts` + tests; **particles** sample rebuilt on
   entities as the proof.
3. ✅ **Systems + Scene/World wiring** — `world.system`/`renderSystem` (ordered,
   replace-by-name) + `world.update()`/`draw(ctx)`; a `Scene` may declare a
   `world` that auto-drives when it has no `update`/`draw` hook. Particles sample
   upgraded to systems as the proof. (Full platformer→ECS migration deferred to
   the flagship, milestone 7.)
4. ✅ **Clock + Tween + Signals** — `Clock.after`/`every`, `Tween.to` (fixed-step,
   pause-safe via `Loop.onStep`), `Signals` synchronous bus, `Mathf` easings.
   Shipped with tests; hoppspelet's death restart-lock moved off wall-clock onto
   `Clock.after` as the proof.
   4b. ✅ **L3 battle-test** — migrated the **breakout** sample fully onto Scenes +
   ECS (blocks as entities queried for collision & render; play + pushed
   game-over overlay) before extending. The API carried a whole game with **no
   engine changes** — validating the L3 surface.
   4c. ✅ **Built-in Sprite renderer** — standard `ECS.Sprite` component +
   `world.drawSprites(ctx)` (z-sorted, anchor/rot/scale/alpha, source sub-rect for
   sheets/atlases). Particles sample dropped its hand-written blit loop.
5. ✅ **Assets + Anim** — `Assets` preloader (images + JSON) and `Anim.sheet`
   sprite-sheet playback wired into the Sprite source-rect. New **sprites** sample
   animates a procedurally-built sheet through the ECS. (Pure logic unit-tested
   with mocks; visual proof is browser-only — image decode doesn't run headless.)
6. ✅ **Tiles** — `Tiles.grid` (draw culled to the camera + solidity queries)
   with tests; the **tiles** sample is a scrolling platformer proving the
   collision (`solidInRect` + tile-snap), the culling (drawn-count HUD), and
   doubling as the `Input.gamepad` showcase.
7. ✅ **Flagship** — hoppspelet migrated fully onto Scenes + ECS, in two stages
   with **no engine changes**. (a) Game states (`ready|playing|gameover`) became a
   `Scenes` stack; `game.state` is now a mirror set by each scene's `enter()` so
   the resize/announce logic is untouched. (b) The `obstacles`/`coins`/
   `floatingTexts` arrays became a single ECS world (Obstacle/Coin/FloatingText
   components); the old `.filter()` rebuild passes are now despawn-while-iterating,
   and drawing stays hand-written (custom per-theme visuals) — the documented
   escape hatch from `world.drawSprites`.
8. ✅ **Hardening pass (external review)** — _correctness:_ `stop()→run()` clock
   reset, paused-edge clearing, catch-up step cap (spiral-of-death guard),
   dt-corrected camera damping + small-world centering, `Game.destroy()` and
   `Stage.init` re-init teardown, DPR-keyed sprite cache. _Perf:_ allocation-free
   `drawSprites` fast path (+ view culling), `world.each` callback queries,
   owned-component despawn, pooled + pre-baked-blit particles, ring-buffer perf
   tracker, cached pointer rect. _Features:_ `Loop.alpha` render interpolation
   (with `px`/`py` sprite snapshots), sprite `flipX`/`flipY`, scene `opaque`,
   camera `snapTo`/`wx`/`wy`/`zoom`, JSON `Storage`, `Input.actions` mapping,
   SFX bus + presets (`Sfx.blip/jump/coin`), `Net.trySend`, fixed WebRTC
   offer/answer signaling, and `Net.createInterpolator` — snapshot interpolation
   for rendering remote entities. _Follow-up:_ `Input.gamepad()` (fixed-step
   polling, `Keys`-style edges, deadzone), WebSocket `heartbeatMs` +
   `idleTimeoutMs` (half-open link detection feeding the reconnect path), perf
   HUD net throughput (`Perf.createNetMeter` + `plugin({ net })`, top-right
   anchor) proven in the netpeer sample, and screen shake in breakout.
9. ✅ **Transitions + samples juice pass** — `Transitions` (fade/wipe, pure
   runner, `Scenes.go(name, spec?)`) demoed in the scenes sample; dev-server
   WebSocket endpoints (`/ws-echo`, `/ws-relay`) fixing the netws sample and
   powering the new **netgame** sample (real WebSocket multiplayer: relay
   broadcast, heartbeat + idle timeout, `Net.createInterpolator` for remote
   blobs, net meter HUD); `Sfx` audio across the game samples; perf-HUD ctx
   state-leak fix.
10. ✅ **Perf/UX wave** — perf HUD grew engine stats (`Game.timings`
    update/draw ms + catch-up `×N`, opt-in ECS entity count via `world.size` +
    `plugin({ world })`, Chrome-only heap MB) and per-metric colored sparkline
    strips; `NetMeter` zero-snap. Callbacks now receive their context —
    `update(stepMs)` / `draw(ctx)` (backward compatible). Window-resize support
    across all samples (`Stage.onResize`, `camera.setView`). Tile-seam fix done
    right: an integer-scale compositing buffer in `Tiles` (fractional-DPR
    antialiasing was the real culprit, not camera rounding). Samples: playable
    synth (waveforms, octave shift, backing grooves), netpeer interpolation
    toggle + idle send suppression, juice held-spray.
11. ✅ **Physics2D** — rigid-body adapter over planck (Box2D): `world`/`box`/
    `circle`/`walls`/`pin` (revolute + motor), `onContact`, deferred destroy
    (world-lock safe), px↔m conversion at the boundary, fixed-step `step(ms)`.
    `walls` is a kinematic containment frame: `set()` glides the slabs to a
    new rect, sweeping bodies ahead of them — resize without teleports. ECS
    glue ships as the `Phys` component + `attach(world, phys)` (step + sprite
    transform sync — presentation stays a game system). Own entry point
    `minimotor/physics2d` — the only module with a dependency; the core import
    graph stays dependency-free. Proof: the **physics** sample
    (stacking/sleeping crates, bouncy balls, motorized paddle, impact-gated
    shake/sfx, sweep-resize).
12. ✅ **UI** — immediate-mode `float`/`button`/`bar` (+ `Collision.
pointInRect` for the hit-testing). Proof: the scenes sample's clickable
    menu/game-over buttons and time bar, and breakout's per-block score pops
    living inside the letterbox transform. Extended with `panel`/`toggle`/
    `tabs`/`row`/`scrollbar` and the frame-scoped pointer inputs they need
    (`Pointer.framePressed`, `Pointer.wheel`). Proof: the **serverbrowser**
    sample — a complete no-DOM GUI screen (filter tabs, toggles, sortable
    columns, wheel/drag scrolling list, disabled buttons, mock refresh/join).
    Round two added `slider`/`spinner`/`popover`/`modal`/`tooltip`, themes
    (`setTheme`), optical vertical text centering, hover cursors
    (`Loop.setCursor` + `Loop.onFrame` engine hooks), and a click-to-dim perf
    HUD — all exercised in the same sample (filters popover, join-confirm
    modal, theme switcher).

## Open decisions

- **Entity ids:** recycle with packed generation counters (safe stale-handle
  detection) vs. plain incrementing ids? (Leaning: generations.)
- **Default world:** ship a single `Minimotor.World` default _and_ per-scene worlds,
  or per-scene only? (Leaning: both — default for simple games.)
- **Component definition ergonomics:** typed handle (`component<T>("name")`) as
  sketched, vs. a schema object. (Leaning: typed handle.)
- **Query caching:** iterate-on-demand vs. cached/incremental query sets. (Leaning:
  on-demand v1; add caching if profiling warrants.)

---

_Superseded brainstorm (camera, math, collision, sprite cache, perf, floating text,
best-score storage, FPS overlay) is now shipped in L1/L2 and removed from this doc._
