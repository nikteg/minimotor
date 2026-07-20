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
├─ L2  Primitives  Mathf · Collision · Camera · Sprites · Text · Physics
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
- ✅ `Storage`, `Net`, `Perf`, `Fullscreen`, `Input`
- 🟡 backlog: gamepad polling, haptics (`navigator.vibrate`), audio channels /
  sampled buffers, orientation lock, service-worker/PWA helper

## L2 — Primitives 🟡

Pure, data-agnostic helpers. No engine state.

- ✅ `Mathf` — lerp, clamp, remap, pulse, wave (add: randInt/randFloat/randItem,
  distance, angleBetween, easing set)
- ✅ `Collision` — rectsOverlap, circleHit, crossedDown (add: circleRect,
  pointInRect, swept AABB)
- ✅ `Camera` — `createCamera` (lerp follow + clamp), `scrollColumns` parallax
  (add: shake)
- ✅ `Sprites` — `getSprite` (square) + `getLayer` (arbitrary offscreen cache)
- ✅ `Text`, `Physics` (kinematic helpers/constants)

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

## L4 — Content ⬜

The gap between "toy" and "full-fledged": loaded art and level data.

```ts
await Minimotor.Assets.load({ hero: "hero.png", tiles: "tiles.png", jump: "jump.wav" });
const run = Minimotor.Anim.sheet(Minimotor.Assets.get("hero"), { fw: 32, fh: 32, fps: 12 });
run.draw(ctx, x, y); // advances by loop dt

const map = Minimotor.Tiles.grid(levelData, { tw: 16, atlas: Minimotor.Assets.get("tiles") });
map.draw(ctx, camera);
map.solidAt(x, y);
```

- ⬜ `Assets` — preload images/audio/JSON with progress; cached map
- ⬜ `Anim` — sprite-sheet frames + timeline, dt-advanced
- ⬜ `Tiles` — grid tilemap: draw + solidity query, culled to camera
- ⬜ `Particles` — emitter presets (the ambient/firework patterns), ECS-friendly
- ⬜ `Transitions` — scene fades/wipes · `UI` — overlay/HUD/floating-text helpers
  (kept out of the core; opinionated, like the samples' `overlays.js`)

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
- **A full rigid-body physics engine** (joints/solver) — keep light kinematic
  helpers; integrate an external lib only behind an opt-in adapter if ever needed.
- **A retained scene graph** with mandatory transform nodes — fights immediate mode.
- **A serialization/save format** in v1 — the ECS API is designed to allow it later.

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
5. **Assets + Anim** — a new image-based sample (first game that loads art).
6. **Tiles** — a tilemap sample.
7. **Flagship** — migrate hoppspelet fully onto Scenes + ECS.

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
