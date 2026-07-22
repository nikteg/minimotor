# API_PLAN — the minimotor API redesign

Distilled from the **api-lab** dogfooding exercise (2026-07-21/22): a sample
game built increment-by-increment against the API we _wish_ existed, with
every decision debated and verdicted. Full rationale, sketches, and quotes
live in `samples/api-lab/API-REVIEW.md` (cited as `#n` throughout); the
aspirational usage code is `samples/api-lab/src/main.ts`. 53 items: 51
agreed changes, 2 dropped (#2, #20).

This plan orders the work by dependency. Phases 2+ are largely
parallelizable once Phase 0–1 land.

## Design laws (cross-cutting — enforce in review, document in ROADMAP)

1. **Structural plain data.** `Vec2 {x,y}` / `Rect {x,y,w,h}` as interfaces
   - function namespaces, never classes. Anything with the fields IS the
     type. JSON-safe throughout. (#9)
2. **Typed maps, property access.** Named-thing collections are inferred
   maps: `Input.map`, `Scenes.create`, `Audio.sfx`, `Anim.sheet` states,
   `Fsm.create`. No stringly lookups; literal unions + `(string & {})`
   escape hatches. (#4, #8, #31, #36, #51)
3. **Tuples mean randomness; direction is `{from, to}`.** `[min, max]` is
   reserved for random ranges everywhere. (#28, #36)
4. **Pull, don't push.** Content derives from a clock on read (closed-form
   or lazy-fold, memoized per step); nothing registers; GC is the teardown.
   Stated exceptions: net (real IO, explicit `close()`) and audio (hardware
   clock). (#32, #37, #50)
5. **Platform facades are singletons; game content is instances.**
   Stage/Loop/Draw/UI/Keys/Pointer/default Camera/default buses vs
   input maps, ECS worlds, particle systems, cameras, clocks, rooms. (#28)
6. **Draw owns all rendering; data never draws itself.** The game decides
   where/order (call placement); `Draw.*` is the only namespace that knows
   what a canvas is. (#42)
7. **Simulation is explicit where it's path-dependent** (`phys.step()`,
   `moveAndSlide`), invisible where it's derivable (motions, cursors). (#52)
8. **Per-step time.** `update()` takes nothing; the fixed step is the time
   unit (px/step, px/step²). (#5)
9. **Scenes own modality (time/input/lifecycle); UI owns widgets.** (#31,
   #47)

## Phase 0 — Foundations (additive, nothing breaks)

- `Vec2` interface + function namespace: `add, sub, scale, addScaled, len,
norm, dot, dist, lerp, angle, rotate`, `out`-param variants; `clamp`,
  `clampRect` (positional + Rect overloads), `limit`. (#9, #10)
- `Rect` stays; geometry helpers accept structural overloads.
- `KeyCode` literal union + `(string & {})`; `PadButton` +
  `` `pad:${PadButton}` `` template type. Apply to `Keys.*`,
  `preventKeys`. (#4)
- Docs: laws above.

## Phase 1 — Engine core (`engine/`)

- `Stage.init` returns a **live viewport** (stable object, mutated on
  resize); `onResize` remains for reactions. (#1)
- `StageOptions.background` → engine clears each frame; single source of
  truth. (#3)
- `update()` — drop the `stepMs` param. **Breaking.** (#5)
- `draw(ctx)` keeps ctx as escape hatch (idiomatic code won't use it). (#2)
- `createGame(options)` replaces the fluent builder. (sweep)
- Fullscreen folds into Stage (`Stage.init({ fullscreen })` /
  `Stage.fullscreen()`). (sweep)

## Phase 2 — Draw layer + camera (the big rework; #16 is the keystone)

- `Draw.rect/circle/line/text` primitives, positional + structural
  overloads; ambient coordinate space, **screen by default**. (#7, #16, #17)
- `Camera.render(fn)` = world block (default camera);
  `Camera.render(cam, { into }, fn)` = lens → screen-rect (minimap, split
  screen; `into` clips); `Camera.layer(factor, fn)` = parallax (replaces
  `scrollColumns`). (#16, #18, #19)
- Default camera always exists (identity); `Camera.follow(target, { world,
deadzone, damping })`; `Camera.x/y/zoom/rect`; `Camera.shake(mag, ms)`
  (absorbs `camera/shake.ts`); `Camera.toWorld/toScreen`. (#15, #17, #29)
- `Draw.sprite(animCursor, rect, { flipX, scaleY, ... })`;
  `Draw.tiles(level, skin)`; `Draw.particles(sys)`. (#26, #41, #42)
- `UI.text` = themed HUD widget with `anchor` positioning (safe-area
  aware); `Text.drawText/drawCentered` retire from the public tier. (#6,
  #17, #33)
- ECS `drawSprites` re-layers on top of `Draw.sprite`.

## Phase 3 — Time

- `Clock.game` (holdable, scalable) + `Clock.ui` (never stops); clocks own
  time constructors (`clock.animate`, `clock.after`); `Anim.*` sugar =
  game time, `UI.animate` = ui time; `Clock.create()` for custom clocks.
  (#34)
- Motions/cursors/particle sims convert to **pull** (closed-form /
  lazy-fold). (#32)
- **One tween system**: `Anim.animate/sequence/parallel` is the surface;
  `Tween` retires/aliases; `Clock` = scheduling only. (#27)
- Slow-mo/hit-stop documented as clock manipulation.

## Phase 4 — Input

- `Input.map({...})`: typed actions, property access, flat binding lists
  with `pad:` prefixes, `axis(neg, pos)`, `vector(l, r, u, d)` (normalized,
  scratch object), `rebind` + JSON `bindings`. Zero wiring. (#8)

## Phase 5 — Collision & arcade physics

- `Collision.slide(rect, vel, solids)` (mechanism) +
  `Collision.moveAndSlide(body, solids)` (policy: zeroes blocked vel, sets
  `grounded`); `Contacts = { up, down, left, right, impact }`.
  `Solid = Rect & { oneWay? }`. Solid **sources**: `Solid[] | TileMap |
mixed array`. (#13, #14, #29, #40)
- Arcade `Physics` module retires (`GRAVITY`/`JUMP_FORCE`/`applyGravity`/
  `jump`/`variableJump`) — feel constants are game data. **Breaking.** (#11)
- `Timers.jumpGate({ coyoteMs, bufferMs })` → `gate.try(pressed, grounded)`.
  (#11)

## Phase 6 — ECS

- `ECS.component<T>()` — string name optional (`{ label }`). (#21)
- Despawn-in-iteration defers automatically; `flush()` leaves the public
  tier. (#22)
- `ECS.world()` → `ECS.create()`; instance idiom `ecs`; `World` type
  renamed. **Breaking.** (#23)

## Phase 7 — Content systems

- `Assets.load(manifest)` → per-key typed record; loader by extension;
  top-level-await pattern documented; progress callback kept. (#24)
- `Anim.sheet(img, { frame, states })` + `sheet.play(state)` cursors
  (self-deriving, same-state `set` is a no-op, typed states). (#25)
- `Particles.create()` (no singleton); `burst({ at, count, speed, life,
size, color })`; immediate-mode `emit({ at, chance, ... })` — the
  each-loop is the attachment; no Emitter component. (#28, #30)
- Tiles: `Tiles.grid(ascii, { size, legend })` — legend = semantics only
  (JSON-pure, server-collidable); marker rule (`spawns`, `spawnOne`);
  `level.rect`; `Tiles.set(img, { size, names })`; skins at the draw site
  with `Tiles.Skin<L>` + `satisfies`; selectors `pick` (coord-seeded),
  `anim` (clock-derived), `auto16` (+ function escape). (#39, #40, #41)
- `Fsm.create({...})`: typed map, enter/exit, transition-by-returned-name;
  AnimBridge retires (`anim.set(state.current)`). (#51)

## Phase 8 — Scenes & UI

- `Scenes.create({...})` typed map; `Loop.run(scenes)` structural handoff;
  stack = draw order (bottom→top from highest `opaque`) AND time boundary
  (push holds `Clock.game`; `holdsTime: false` for live-world pause);
  `switch(mode)` documented as first-class. (#31)
- Transitions become `scenes.go/push(name, { transition: fade(300) })`.
  (sweep)
- UI: return-value interaction; value-in/value-out sliders; container
  blocks auto-flow (`panel`/`row`, `gap`, anchors); identity = label ×
  container stack + `{ id }`. (#43, #44)
- Docs tiering: game tier (8 widgets) first, app tier separate. (#45)
- Pad/keyboard nav on the existing tab-focus machine; **spatial nav
  primary** (layout rects), call-order for tab/tie-break; activation folds
  into return values (zero call-site changes); `UI.nav({...})` bindings;
  no `back` (scene policy). (#46)
- `UI.modal` demotes to a backdrop container; `UI.confirm` = sugar
  returning `"yes" | "no" | null`; scenes own freezing. (#47)

## Phase 9 — Audio

- Unlock ceremony dies (`ensureAudio` internal; pre-gesture plays dropped
  with dev warn). (#35)
- `Audio.sfx({...})` typed map, `.play({ pitch: [min,max], bus })`;
  `Audio.recipes.*` (coin/jump/hit/explosion/laser/powerup/blip/click/
  whoosh) returning tweakable specs. (#36)
- `Audio.music(asset, { loop, volume })`; `play()` idempotent;
  `fade(vol, ms)`; ducking = scene hooks. Audio is real-time (outside the
  clock system). (#37)
- Mixer rebuild: `Audio.master` + default `buses.sfx/music` (platform
  knobs); `Audio.bus({ reverb, lowpass })` content instances;
  `bus.fade(params, ms)`; `duckUnder`; `Audio.raw` escape hatch. Absorbs
  today's `Mixer`. (#38)

## Phase 10 — Net

- Symmetric `Net.join(url, { room }) → Room`: `id, peers, onJoin, onLeave,
send, onMessage, close()`; star topology + host-healing internal; room
  names fold matchmaking in. Asymmetric host/join stays one tier down.
  (#48)
- `Net.sync(room, { hz, state })` → iterable of interpolated peer states
  (numbers lerp, fields step, timeout-pruned, self excluded); fuses
  `createInterpolator` + `createRoster` (which remain exported). (#49)
- Connections are resources (law exception, documented). (#50)
- Direction (round 2 specs the details): same Room vocabulary over
  client-server (WS, server = host); server-side `room.sync` down;
  `createPresence` ≈ server roster, `serverTick` ≈ server loop. (#53)

## Round-2 exercises (own samples, not in this plan's scope)

- **Physics2D**: `vel: Vec2` (#12), `step()` no-arg explicit, `attach`/
  `Phys` glue → each-loops, `onContact` → pollable `contacts`, planck
  isolation stays. Sketch in #52.
- **Server-authoritative sample** (road-rivals as corpus) → judge #53's
  unification in anger.
- **Signals**: justify-or-retire (scenes/ECS dissolve most uses).
- **Gizmos/Goodies** taxonomy + `game.ts` grab-bag rehoming
  (scoreTracker→Storage sugar, letterbox→camera, formatClock→Mathf).
- Spatial-nav implementation details; `Perf.netMeter` learns rooms.

## Breaking changes register

| Change                                                  | Item | Blast radius                    |
| ------------------------------------------------------- | ---- | ------------------------------- |
| `update()` loses `stepMs`                               | #5   | every sample using the param    |
| Arcade `Physics` retires                                | #11  | samples using applyGravity/jump |
| `vx/vy` → `vel: Vec2` (Body2D & friends)                | #12  | physics samples                 |
| `ECS.world()` → `ECS.create()`, `World` type rename     | #23  | ECS consumers                   |
| `Text.*` leaves public tier                             | #6   | HUD code → `UI.text`            |
| Screen-default draw space (world needs `Camera.render`) | #16  | every camera sample             |
| `level.draw`/`fx.draw` → `Draw.tiles`/`Draw.particles`  | #42  | tiles/particle samples          |
| `Tween` folds into `Anim`                               | #27  | tween consumers                 |
| `Mixer` absorbed into buses                             | #38  | audio samples                   |

Migration: the 35 existing samples are the test corpus — port them
phase-by-phase; each port validates the phase and updates the showcase.
