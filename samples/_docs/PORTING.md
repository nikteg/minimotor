# Porting samples to the new API (API_PLAN)

The engine surface changed (see `../API_PLAN.md`; rationale in
`api-lab/API-REVIEW.md`). The reference port is `api-lab/src/main.ts`.
Samples import named exports: `import { Stage, Loop, Draw, ... } from "minimotor"`
(the `Minimotor` default object still exists, but prefer named imports).

## Breaking changes cheat sheet (old → new)

### Engine core

- `let vp = Stage.init(...)` + `Stage.onResize((n) => (vp = n))` →
  `const view = Stage.init(...)` — the viewport is LIVE (mutated in place).
  Delete resize-rebinding handlers; `Stage.onResize(fn)` still exists for
  reactions (re-layout).
- `Stage.init(c, { plugins, pauseOnPortrait, preventKeys })` unchanged; NEW
  `background: "#222"` — the engine clears every frame. Delete
  `ctx.clearRect(...)` from draw and any `background:` on body/canvas CSS.
- `update(stepMs)` → `update()` — the fixed step IS the time unit. Constants
  become per-step (`SPEED = 3` px/step); anything that multiplied by `stepMs`
  folds the constant in. `Loop.step` still exists for real ms.
- `createGame(opts).use(p).pauseOnPortrait().build()` →
  `createGame({ ...opts, plugins: [p], pauseOnPortrait: true })`.
- `Fullscreen.applyFullscreen()` / `fullscreenCSS` →
  `Stage.init(c, { fullscreen: true })` or `Stage.fullscreen()`.

### Drawing (screen space is the DEFAULT; world lives in camera blocks)

- `ctx.fillStyle = c; ctx.fillRect(x, y, w, h)` → `Draw.rect(x, y, w, h, c)`
  or `Draw.rect(rectObj, c)` (anything with x/y/w/h).
- circles → `Draw.circle(x, y, r, c)` / `Draw.circle(pos, r, c)`;
  lines → `Draw.line(x1, y1, x2, y2, c, width?)` / `Draw.line(a, b, c, w?)`.
- `Text.drawText(ctx, s, x, y, style)` → `Draw.text(s, { x, y, size, color,
align, baseline })` (plain/world text) or `UI.text(s, {...})` (themed HUD).
  The `Text` namespace is GONE.
- `UI.text` gains `anchor: "center" | "topRight" | ...` — x/y become offsets.
- Raw ctx still available (`draw(ctx)` param or `Draw.ctx`) as the escape
  hatch — fine for gradient/path-heavy scenes; don't force-port those.

### Camera (a default camera ALWAYS exists; identity until configured)

- `createCamera({ worldW, worldH, viewW, viewH, damping, deadZoneX/Y })` +
  `cam.update(tx, ty)` + manual `ctx.translate(-cam.x, -cam.y)` →
  ```js
  Camera.follow(player, { world: { w, h }, deadzone: { w, h }, damping: 0.15 });
  // draw():
  Camera.render(() => {
    /* world-space Draw.* calls */
  });
  /* top level = screen space (HUD) */
  ```
- `cam.sx(x)/sy(y)/wx/wy` → `Camera.toScreen(pos)` / `Camera.toWorld(pos)`
  (`Camera.toWorld(Pointer)` = mouse picking).
- `Camera.shake(amp, ms)` unchanged in name; `shakeX()/shakeY()` are GONE —
  the shake is applied inside `Camera.render` automatically.
- `scrollColumns` parallax → `Camera.layer(factor, () => { ... })`.
- Minimap/split-screen: `const lens = createCamera({ fit: world });`
  `Camera.render(lens, { into: rect }, () => { ... })`.
- `Camera.snap()` after teleports/scene entry (replaces `snapTo`).

### Input

- `Input.actions({ jump: ["Space"] })` / `trackKeys()` →
  `Input.map({ jump: ["Space", "pad:a"] })`; call sites:
  `input.jump.pressed/down/released`, `input.axis("left", "right")`,
  `input.vector("left", "right", "up", "down")` (normalized).
- Raw `Keys.down("ArrowLeft")` unchanged (now typo-checked).
- `Input.gamepad()` unchanged; menus are pad-navigable automatically.

### Time

- `Clock.after/every(ms, fn)` → `Clock.world.after/every(ms, fn)` (or
  `Clock.ui.*` for interface timers).
- `Tween.to(obj, { x: 10 }, ms, ease)` → a Motion:
  `const m = Anim.animate({ from, to, ms, ease })` and read `m.value`
  (motions are clock-derived; nothing ticks). For multi-field object tweens
  either several motions or fold into game state.
- `anim.tick(dt)` / `motion.tick(dt)` — GONE; values derive from the clock.
- Slow-mo/pause: `Clock.world.scale` / `.hold()`.

### Collision & physics

- `Physics.applyGravity(body, floorY)` / `jump` / `variableJump` — GONE:
  ```js
  body.vel.y += GRAVITY; // game constants
  if (gate.try(input.jump.pressed, body.grounded)) body.vel.y = JUMP;
  if (input.jump.released && body.vel.y < 0) body.vel.y *= 0.45;
  Collision.moveAndSlide(body, solids); // or slide(...)
  ```
  Bodies are plain `{ x, y, w, h, vel: { x, y }, grounded }` (velocity is a
  nested Vec2 now, NOT vx/vy).
- `map.moveAABB(rect, dx, dy)` (tiles) → `Collision.slide(rect, vel, level)`
  or `Collision.moveAndSlide(body, level)`; contact faces:
  `hit.up/down/left/right` + `hit.impact`.
- `jumpGate.update(grounded, pressed, dt)` → `gate.try(pressed, grounded)`.
- `Vec2` namespace exists: `add/sub/scale/addScaled/len/norm/dist/lerp/
clamp/clampRect/limit` — mutate-first, structural.

### ECS

- `ECS.world()` → `ECS.create()`; idiom `const ecs = ECS.create()`.
- `Minimotor.World` (shared default) — GONE; create your own.
- `ECS.component<T>("name")` → `ECS.component<T>()` (label optional).
- `world.flush()` — GONE (despawn-in-iteration is safe automatically).
- `world.drawSprites(ctx, opts)` — GONE, and the ECS no longer knows about
  sprites at all. The `Sprite` component moved to the `Sprites` namespace
  (`Sprites.Sprite`, was `ECS.Sprite`); read its store with the generic
  `ecs.dense(Sprites.Sprite)` and blit with `Draw.sprites(ecs.dense(
Sprites.Sprite), opts)`. For px/py interpolation call `Sprites.interpolate(
ecs)` once (opt-in, replaces the old automatic snapshot). Draw owns rendering;
  the ECS is a content-agnostic data container.

### Anim

- `Anim.sheet(img, { fw, fh, fps, frames })` + `anim.update(dt)` +
  `anim.draw(ctx, x, y)` / `Anim.states({...}, "idle")` →
  ```js
  const sheet = Anim.sheet(img, {
    frame: { w: 32, h: 32 },
    states: { idle: { row: 0, frames: 4, fps: 6 }, run: { row: 1, frames: 6, fps: 12 } },
  });
  const anim = sheet.play("idle");
  anim.set(cond ? "run" : "idle"); // same-state set is a no-op
  Draw.sprite(anim, entityRect, { flipX }); // bottom-center anchored
  ```
- `Anim.states` is BACK — for kits shipped as one image PER state
  (`idle.png`, `run.png`, …) instead of one packed grid. Same cursor surface as
  `Anim.sheet.play` (`.set`/`.state`/`.frame`/`.done`, `Draw.sprite`-ready):
  ```js
  const kit = Anim.states({
    idle: { image: art.idle, frames: 4, fps: 6 },
    run: { image: art.run, frames: 6, fps: 12 },
    jump: { image: art.jump }, // 1 static frame
  });
  const anim = kit.play("idle");
  ```
- Assets `{ src, sheet: { fw, fh } }` specs → `{ src, sheet: { frame: {...},
states: {...} } }`.

### Particles

- `Particles.burst(x, y, { colors })` (singleton) →
  `const fx = Particles.create();` then
  `fx.burst({ at: { x, y }, color, speed: [a, b], life: [a, b] })`.
  Speeds are px/STEP now (divide old px/s values by 60), gravity px/step².
- `Particles.draw(ctx)` → `Draw.particles(fx)` (inside the camera block for
  world particles).
- Continuous: `fx.emit({ at, chance: 0.4, ... })` each step.

### Tiles

- `Tiles.grid(numberMatrix, { tw, colors, solid })` → ASCII + legend + skin:
  ```js
  const level = Tiles.grid(
    `
  ..o..
  #####
  `,
    { size: 32, legend: { "#": { solid: true } } },
  );
  const skin = { "#": "#3a3f4a" };
  // draw (world pass):   Draw.tiles(level, skin);
  // collide:             Collision.moveAndSlide(body, level);
  // markers:             level.spawns("o"), level.spawnOne("P")
  // world size:          level.rect
  ```
- Tileset images: `Tiles.set(img, { size, names })` + selectors
  (`tiles.pick`, `tiles.anim`, `tiles.auto16`) as skin values.

### Scenes

- `Scenes.define("a", {...}); Scenes.go("a")` (global) →
  ```js
  const scenes = Scenes.create({ first: {...}, second: {...} }); // first key opens
  Loop.run(scenes);
  scenes.go("second", { transition: Transitions.fade(300) });
  scenes.push("paused"); scenes.pop();
  ```
- push HOLDS Clock.world (pause freeze for free); `holdsTime: false` on the
  pushed scene for live-world menus; `opaque: true` unchanged.
- Scene `world:` auto-drive is GONE — call `ecs.update()` / draw explicitly.

### UI

- Label-first shapes: `UI.button("Play")`, `UI.slider("Music", vol)` →
  returns the new value, `UI.toggle("Mute", muted)`.
- `UI.panel({ anchor: "center", w: 260, gap: 10 }, () => { ...children... })`
  auto-flows a column (menus).
- `UI.confirm("Quit?")` → `"yes" | "no" | null` per frame.
- Everything else (tabs/table/list/textInput/...) unchanged.

### Audio

- `ensureAudio()` calls — DELETE (first gesture unlocks automatically).
- `Sfx.coin()`-style presets → `const sfx = Audio.sfx({ coin:
Audio.Recipes.coin(), ... }); sfx.coin.play({ pitch: [0.95, 1.1] })`.
  `Audio.tone(...)` / `playSfx` still exist (low tier) — fine to keep.
- `Sfx.setVolume/setOn` → `Audio.buses.sfx.volume` / `.muted`;
  `Mixer.setMasterVolume` → `Audio.master.volume`.
- `Music.*` (pattern player) unchanged; file tracks:
  `Audio.music(arrayBuffer, { loop, volume })`.

### Net

- `Net.host({ signal })` / `Net.join({ signal })` (asymmetric) →
  `Net.hostSession(...)` / `Net.joinSession(...)` (renamed, still there),
  OR the new symmetric room:
  `const room = await Net.join(url, { room: "name" })` +
  `Net.sync(room, { hz, state: () => ({...}) })` → iterate ghost states.
- `createInterpolator` / `createRoster` unchanged.

## Ground rules

- Samples stay plain `.js` (except api-lab). Keep each sample's structure
  and behavior; this is a mechanical port, not a redesign.
- Don't reintroduce `clearRect`/manual camera translates where the new API
  covers them; DO keep raw-ctx rendering where a sample is genuinely
  path/gradient-heavy (that's the escape hatch working).
- After porting, sanity-check every imported name against
  `../build/index.d.ts`.
