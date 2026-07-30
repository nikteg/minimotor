# Minimotor API Review — running notes

Dogfooding review: this sample exercises each capability through explicit,
game-owned factories. After each increment, the API it touched is judged.
Verdicts: **keep** / **change** / **undecided**. Items marked "change" get an
ideal-API sketch. These notes began as a design spec; accepted changes are now
implemented directly in Minimotor and exercised by this sample.

---

## Increment 1 — bootstrap: square moves with arrow keys

**What we built:** `Stage.init` + `Loop.run({ update, draw })` + `Keys.down`,
clamped with `Mathf.clamp`, HUD line via `Text.drawText`. TypeScript, named imports.

**What went well:** named imports are clean; `Stage.init("game")` by element id is a
great first line; DPR/resize handling is invisible; strict TS compiles with zero
friction; `Mathf.clamp` at hand without importing anything extra.

**Friction found:** (Claude's critique — verdicts pending)

1. **The `let vp` reassignment idiom.** `Stage.init` returns a viewport snapshot
   that goes stale on resize; keeping it fresh requires the
   `Stage.onResize((next) => (vp = next))` dance. Forgetting it fails silently
   (clamps use the old size). The API's easiest path is the wrong path.
   - Verdict: **change** (agreed)
   - Sketch (live view, no subscription needed for the common case):
     ```ts
     // before
     let vp = Stage.init("game");
     Stage.onResize((next) => (vp = next));
     // after — `view` is a stable object, mutated in place on resize
     const view = Stage.init("game");
     ```

2. **`draw(ctx)` doesn't receive the viewport.** Every real draw needs the size;
   today it must be closure-captured (and kept fresh, see #1).
   - Verdict: **dropped** after discussion — once #1 makes the viewport live,
     any module can hold it (or read `Stage.viewport`) without staleness, so a
     `view` param is a second name for the same object. `draw(ctx)` keeps
     passing `ctx` as the raw-canvas escape hatch, but the idiomatic sample
     doesn't use it (see #6, #7).

3. **`clearRect` boilerplate + two sources of background truth.** Every sample's
   first draw line is the same clear; the visible background lives in the HTML
   CSS (`body { background: #222 }`) while the canvas clears to transparent.
   - Verdict: **change** (agreed)
   - Sketch: `Stage.init("game", { background: "#222" })` → engine clears each
     frame (opt-out: `Loop.run({ clear: false, ... })`).

4. **`Keys.down(code: string)` is stringly-typed.** `Keys.down("ArrowLetf")`
   compiles; no completion for the (large but well-known) code set.
   - Verdict: **change** (agreed)
   - Sketch: `down(code: KeyCode): boolean` where
     `type KeyCode = "ArrowLeft" | "Space" | ... | (string & {})` — completion
     and typo-catching without closing the set.

5. **`update(stepMs)` ambiguity.** The step is fixed (1000/60) yet passed as a
   parameter, which invites dt-multiplication style in some places and
   per-step constants (like `SPEED = 3`) in others. Should the API commit to
   per-step units and pass nothing, or embrace dt?
   - Verdict: **change** (agreed) — `update()` takes no arguments. The fixed
     step IS the time unit; constants are documented in px/step and px/step².
     Accepted cost: per-step numbers need ×60 to read as seconds, and a future
     step-rate change would re-scale every game's constants. Determinism and
     no-dt-footguns win for this engine.

6. **Two overlapping HUD-text APIs with different shapes.**
   `UI.text("hi", { x, y, size })` vs `Text.drawText(ctx, "hi", x, y, { font })` —
   options-object vs positional, `size: 14` vs `font: "16px monospace"`, one
   needs `ctx`, one doesn't. Also the `Text.drawText` naming stutter.
   - Verdict: **change** (agreed) — `UI.text` is the blessed HUD-text call:
     options object, no ctx threading, consistent with the immediate-mode UI
     layer. `Text.drawText`/`drawCentered` retire from the public tier (their
     align/baseline powers become `UI.text` options).

7. **Simple shapes require raw ctx state pairs.** Drawing a square means
   `ctx.fillStyle = c; ctx.fillRect(x, y, w, h)` — the engine owns background
   and text but not shapes, so every toy still touches canvas state. (Raised
   by Niklas: "no fillRect, right?")
   - Verdict: **change** (agreed)
   - Sketch (revised with #9 — geometry accepts structural shapes too):
     ```ts
     Draw.rect(x, y, w, h, color); // positional, for literals
     Draw.rect(rect, color); // anything with {x, y, w, h} — your
     // player object IS a Rect structurally
     Draw.circle(pos, r, color); // anything with {x, y}
     Draw.line(a, b, color);
     ```
     A `(pos, size, color)` variant was considered and cut: the `Rect`
     overload covers it better, since entities carry `x/y/w/h` together and
     `Collision.rectsOverlap` already speaks that shape. Styled content
     (text/UI) keeps options objects. Deliberate two-shape rule stands.

**Verdicts:** #1, #3, #4, #6, #7 change (agreed); #2 dropped after discussion;
#5 still open. The imaginary `src/main.ts` shows the sample with all agreed
items applied (tagged `[#n]` in comments).

---

## Increment 2 — named input actions (Input.map)

**What we built:** raw `Keys` polling replaced by `Input.map({...})` — named
actions fusing keyboard (arrows + WASD) and gamepad; movement via
`input.vector(...)`, `jump` action wired (color feedback only until physics).

8. **`Input.map` — the input abstraction.** Agreed shape (Godot-inspired):
   - Named actions, **property access** (`input.jump.pressed`), typed by
     inference — no stringly lookups at the call site.
   - **One flat binding list per action**; gamepad bindings use `"pad:"`
     prefix strings, template-literal typed (`` `pad:${PadButton}` ``) so they
     are as typo-safe as `KeyCode`. Bindings are plain JSON → rebinding is
     data (`input.rebind(...)` + `Storage.save("bindings", input.bindings)`).
   - **`input.axis(neg, pos)` → -1..1** (Godot `get_axis`): analog-aware,
     deadzone handled, keys snap to ±1.
   - **`input.vector(l, r, u, d)` → normalized `{x, y}`** (Godot
     `get_vector`): fixes the 1.41× diagonal bug at the correct layer.
     Returns a reused scratch object (read, don't hold — same contract as
     `Game.timings`).
   - **Zero wiring**: no `input.update()` in the loop; the map hooks the
     fixed step itself.
   - Strictly optional layer — raw `Keys` remains the floor below it.
   - Verdict: **change** (agreed)

9. **Vector types in the engine? (1D/2D/3D)** Raised by Niklas. Claude's
   proposal:
   - **Vec2: yes — as plain data + functions, not a class.** A structural
     `interface Vec2 { x: number; y: number }` plus a `Vec2.*` function
     namespace (`add`, `sub`, `scale`, `len`, `norm`, `dot`, `dist`, `lerp`,
     `angle`, `rotate`, …). Because it's structural, everything with `x`/`y`
     already IS a Vec2 — sprites, bodies, pointer, `input.vector()` — no
     wrapping, no churn, JSON-safe for net snapshots. Hot-path variants take
     an `out` param (`Vec2.norm(v, out)`) to stay allocation-free.
   - **No class methods** (`v.add(w)`): per-frame allocation churn, breaks
     plain-data ethos, and structural typing is the whole win.
   - **Vec1: no** — that's `number` (and `axis()` already returns it).
   - **Vec3: no** — YAGNI in a 2D canvas engine; revisit only if pseudo-3D
     (z-depth) games actually appear. Sprite `z` is draw order, not math.
   - **Geometry APIs take structural overloads** (Niklas: "i kinda want
     vectors in draw.rect etc too"): positional args stay for literals, and a
     second overload accepts the structural type — `Vec2` where a point is
     meant, `Rect` where a box is meant (see #7's revised sketch). Vec2 is
     still not a _required_ currency; it's just always accepted.
   - Verdict: **change** (agreed)

10. **Vec2 clamp utilities** (Niklas requested). All in-place, following #9:
    ```ts
    Vec2.clamp(v, min, max); // component-wise; min/max are Vec2s
    Vec2.clampRect(v, x, y, w, h); // keep point inside a region…
    Vec2.clampRect(v, rect); // …with the structural overload (#7 rule)
    Vec2.limit(v, maxLen); // magnitude clamp — velocity caps
    ```
    `limit` is the sneaky-important one for games (max speed without
    distorting direction).
    - Verdict: **change** (agreed)

---

## Increment 3 — gravity + jump (tiny platformer)

**What we built:** horizontal run via `input.axis` + `Mathf.approach`,
manual gravity/jump integration with `Vec2.add`, floor/wall containment via
`Vec2.clampRect`, and a `Timers.jumpGate` for coyote time + jump buffering.
The up/down input actions were removed — gravity owns Y now.

11. **The arcade `Physics` module is too magic.** Today: module-level
    `GRAVITY = 0.7` and `JUMP_FORCE = -13.5` constants (feel constants are
    _game_ data — every game tunes them), and `applyGravity(body, floorY)`
    fuses integration with floor collision. Meanwhile the genuinely hard part
    of jumping — coyote time + input buffering — lives elsewhere.
    - Claude's proposal: **retire `Physics.applyGravity`/`jump`/
      `variableJump`** — with the perfect API each is 1 explicit line of game
      code (see sample). Keep and polish the hard part as `Timers.jumpGate`:
      ```ts
      const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 120 });
      // per step — buffers presses, tracks time-since-grounded internally:
      if (gate.try(input.jump.pressed, player.grounded)) player.vel.y = JUMP;
      ```
      Zero wiring (stepped by the engine like Input.map). Variable jump
      stays an honest one-liner:
      `if (input.jump.released && player.vel.y < 0) player.vel.y *= 0.45;`
    - Verdict: **change** (agreed) — retire the arcade helpers + constants;
      keep/polish `Timers.jumpGate` as sketched.

12. **Velocity shape: nested `vel: Vec2` vs flat `vx`/`vy`.** The sample
    nests (`player.vel = { x, y }`) so integration composes with #9:
    `Vec2.add(player, player.vel)`, `Vec2.limit(player.vel, MAX)`. But the
    existing ECS `Sprite` and `Physics2D.Body2D` speak flat `vx`/`vy`, which
    Vec2 utils can't touch. Blessing nested implies aligning those later
    (bigger blast radius) or living with two conventions at the seam.
    - Verdict: **change** (agreed) — Niklas: "I dont care about migration
      cost, lets go all the way with vectors." Nested `vel: Vec2` is the
      engine-wide convention; the change-plan includes aligning
      `Physics2D.Body2D` (`vx`/`vy`/`spin` → `vel: Vec2` + `spin`) and any
      other flat velocity carriers (Gizmos `Car`, etc.). Freebie already in
      hand: `Pointer` has `x`/`y`, so it's structurally a Vec2 today —
      `Vec2.dist(Pointer, player)` just works.

---

## Increment 4 — platforms + collision

**What we built:** a floor and three platforms as plain `Rect`s; movement
resolution replaced the manual floor check with one swept move-and-slide
call. The floor is now just another solid.

13. **`Collision.slide` — the missing composition.** The engine has the
    primitives (`rectsOverlap`, `sweptAABB`) but every platformer must
    hand-roll the same resolution loop: per-axis movement, time-of-impact
    ordering, don't tunnel, derive grounded/bonk. That loop is the most
    error-prone code beginners write. Godot's `move_and_slide` proves the
    right altitude:

    ```ts
    const hit = Collision.slide(player, player.vel, platforms);
    player.grounded = hit.down;
    if (hit.down || hit.up) player.vel.y = 0;
    ```
    - Moves the rect by `vel`, sliding along solids; swept, so no tunneling
      at high speed.
    - Returns contact flags `{ up, down, left, right }` as a reused scratch
      object (read, don't hold).
    - Deliberately does NOT touch velocity or decide grounding — what a
      contact _means_ stays game code (one-way platforms, bouncy walls,
      wall-jumps all stay possible on top).
    - Solids are plain structural `Rect[]` (#9) — the same objects Draw.rect
      renders.
    - Verdict: **change** (agreed), with the layering below.
    - One-way platforms: **flag on the data** (agreed) —
      `type Solid = Rect & { oneWay?: boolean }`. A `oneWay` solid collides
      only while moving downward with the body's previous bottom at or above
      its top (the classic rule). Serializes cleanly, level-editor friendly,
      subsumes today's `crossedDown`.

14. **`Collision.moveAndSlide` — the policy layer** (Niklas: "how would
    move_and_slide look for us if we wanted it?"). Two altitudes, Godot-style
    default path built on the #13 mechanism:
    ```ts
    interface MoverBody extends Rect { vel: Vec2; grounded: boolean }

    Collision.moveAndSlide(body: MoverBody, solids: Solid[]): Contacts
    ```
    Contract:
    - swept-slides `body` by `body.vel` against `solids` (via #13);
    - zeroes the blocked component(s) of `body.vel` — down/up contact clears
      `vel.y`, left/right contact clears `vel.x`;
    - sets `body.grounded = contacts.down`;
    - respects `oneWay` flags;
    - still returns the contacts scratch object (wall-jumps read
      `hit.left`/`hit.right` even on the easy path).
      Anything with different policy (bounce, sticky walls, no grounded
      concept) drops one altitude to `Collision.slide`, which never touches
      `vel` or `grounded`. `moveAndSlide` is ~10 lines implemented on `slide` —
      cheap to own, and it encodes the two lines everyone writes subtly wrong
      (zero only the blocked axis; grounded from this step's down contact).
    - Verdict: **change** (agreed in discussion)

---

## Increment 5 — camera (world bigger than screen)

**What we built:** a fixed 2400×600 world with platforms in world
coordinates, and the primary camera configured to follow the player with
deadzone + damping. Draw code wraps the world pass in `Camera.render(...)`;
top level stays screen space (#16, after a three-design discussion).
`Stage.init`'s return value went unused for the first time — with a camera,
game code never reads the viewport.

15. **A camera always exists — configure it, don't create it.** (Shaped by
    Niklas: "would it make sense to require a camera?") Today's
    `createCamera({ worldW, worldH, viewW, viewH, damping, deadZoneX,
deadZoneY })` has two problems: `viewW`/`viewH` is the #1 stale-snapshot
    bug reborn, and the pairs want to be shapes (#9). But the deeper fix is
    architectural: the engine already runs on default-instance singletons
    (`Stage`/`Loop`/`Keys` + `createGame` escape hatch) — the camera should
    be one too. `Stage.init` brings an identity camera (0, 0, zoom 1); games
    that never touch it render exactly as before. Configuring it:

    ```ts
    Camera.follow(player, {
      world, // Rect-ish; camera clamps itself to it
      deadzone: { w: 160, h: 100 },
      damping: 0.15, // per-step lerp factor (ease-out)
    });
    ```
    - No view size in the config — the camera reads the live viewport (#1).
    - Advances itself after each update step (zero wiring); retarget with
      `Camera.follow(other)`.
    - `Camera.x/y/zoom` readable; `Camera.rect` = visible world rect
      (culling).
    - Folds `shake` in: `Camera.shake(amplitude, ms)`.
    - Verdict: **change** (agreed in discussion)

16. **Blocks set the drawing space; SCREEN is the default.** (Went through
    three designs in discussion: twin namespaces → Layer instances → blocks.)
    There is exactly ONE primitive set — `Draw.rect/line/circle/text` — and
    it draws in the _ambient_ space, which is the screen at top level.
    `Camera.render(fn)` runs its callback in world space:

    ```ts
    draw() {
      Camera.render(() => { /* world: platforms, player, world text */ });
      Draw.rect(hpBar, "#333");     // screen — no wrapper needed
      UI.text("Score", { x: 10, y: 8 });
    }
    ```

    Why blocks beat the alternatives:
    - vs twin namespaces (`Draw.*`/`UI.*` twins): no duplicated primitives;
      helpers inherit the caller's space with no `pen` parameter threading.
    - vs Layer instances (`pen: Layer` param): same, plus no interface to
      document; the cost is that a line's space is contextual (look up to
      the enclosing block) — accepted.
    - vs `begin()/end()`: the callback IS the push/pop pair; you can't
      forget the pop.
      Why SCREEN default (Niklas's call): failure modes swap loudness — a
      forgotten `Camera.render` makes the world visibly stop scrolling
      (immediate, unshippable), while world-default's forgotten screen wrapper
      gives a quietly drifting HUD (discovered weeks later). Also makes the
      sample's progression honest: increments 1–4 draw at top level with no
      camera and that's _true_, not "identity transform by luck"; increment
      5's diff is exactly the concept arriving. LÖVE precedent
      (screen-until-transformed).
      `UI.*` shrinks to what it really is: themed, input-aware WIDGETS,
      always screen space regardless of ambient blocks (they own hit-testing).
    - Verdict: **change** (agreed)

17. **World-space text + coordinate converters** (from Niklas: "how would I
    draw UI.text in camera space?"). With #16, `Draw.text` is one primitive
    drawing in the ambient space — inside `Camera.render` it's world text
    (damage numbers, name tags; zooms and shakes), at top level it's screen
    text. `UI.text` remains the themed HUD _widget_ (#6). Plus lens
    converters for crossing spaces without drawing:

    ```ts
    Camera.toScreen(pos, out?);
    Camera.toWorld(pos, out?);   // Camera.toWorld(Pointer) = mouse picking
    ```
    - Verdict: **change** (agreed)

18. **Parallax = `Camera.layer(factor, fn)`.** Parallax layers are not
    cameras (no deadzone/damping/life of their own) — they are a derived
    transform of the main camera: translation × factor. A nested block
    inside `Camera.render` (or a top-level shorthand for it):
    `factor 0` ≈ screen-fixed, `1` = world. Replaces today's
    `scrollColumns` helper.
    - Verdict: **change** (agreed)

19. **A camera is a lens: world rect → screen rect.** Main camera: visible
    world slice → whole canvas. Minimap: whole world → corner rect. Split
    screen: two cameras → two halves. One abstraction, one API:

    ```ts
    const minimap = createCamera({ world, fit: world });
    Camera.render(minimap, { into: { x: 10, y: 40, w: 200, h: 50 } }, () => {
      for (const p of platforms) Draw.rect(p, "#666");
      Draw.rect(player, "#4ecdc4");
      Draw.rect(Camera.rect, "#ffffff22"); // main cam's view rect = viewfinder
    });
    ```

    `into` clips; omitted `into` = full canvas; `Camera.render(fn)` with no
    camera argument = the primary camera (#16's world block). `Camera.rect`
    being a structural Rect (#9) makes the viewfinder a one-liner.
    - Verdict: **change** (agreed)

20. ~~`UI.rect` / `UI.line` — screen-space shape primitives.~~
    - Verdict: **dropped** — screen-as-default (#16) made it moot: top-level
      `Draw.rect` IS a screen-space shape. `UI.*` stays widgets-only.

---

## Increment 6 — coins via ECS

**What we built:** a `Coin` component (whose data is just a `Vec2`), one coin
per platform, collected on overlap (despawn + score), drawn inside the camera
block, score in the HUD. First contact with the ECS in the imaginary API.

21. **Component registration ceremony.** Today:
    `ECS.component<T>(name: string)` — a mandatory string name alongside the
    generic. The name buys debugging/serialization, but it's a second,
    stringly identity that can collide and drift from the variable name.
    Ideal: `const Coin = ECS.component<Vec2>()` — identity is the object,
    optional `{ label }` for tooling. Also shown: component data can BE a
    Vec2 (no wrapper object), so queries feed `Draw.circle(c, ...)` and
    `Collision.circleRect(c, ...)` directly.
    - Verdict: **change** (agreed)

22. **Despawn-during-iteration must be safe by default.** The classic ECS
    footgun: mutating the entity set while iterating it. Today's API exposes
    `flush()`, implying game code is responsible for calling it at the right
    time. Ideal: `despawn()` inside `each()` defers automatically and the
    world applies pending ops when the outermost iteration ends — `flush()`
    disappears from the public tier (kept internal, or for advanced manual
    batching only).
    - Verdict: **change** (agreed)

23. **When does ECS earn its place — and a naming smell.** Honest
    comparison: for coins alone, a plain `coins: Vec2[]` with swap-remove is
    less code and zero new concepts. The ECS starts paying when (a) several
    entity KINDS share cross-cutting behaviors (lifetime, movement,
    rendering), or (b) spawn/despawn churn is high. The API is already
    optional (good — keep it that way); the sample uses it here to judge the
    ergonomics, and the layering means dropping back to arrays is always
    possible. Separate note: `ECS.world()` collides with the most natural
    name for level data (`world = { w, h }` since increment 5) — the sample
    had to name the instance `ents`. Candidates: rename the concept
    (`ECS.create()`, `Entities`), or accept that consumers rename.
    - Verdict: **change** (agreed) — `ECS.create()` replaces `ECS.world()`;
      the blessed instance idiom is `const ecs = ECS.create()`. The `World`
      type (and `implicit world instance) get renamed accordingly
      in the change-plan. Break-even guidance (arrays vs ECS) goes in docs.

---

## Increment 7 — animation (spritesheet states + landing squash)

**What we built:** the player rect became an animated hero: an asset load,
a spritesheet with idle/run/jump states driven by one line of gameplay
logic, sprite drawing fitted to the player Rect, and a landing-squash
motion. Pulled `Assets` and the `Anim`/`Tween` seam into review.

24. **Typed asset manifests.** `Assets.load({ hero: "assets/hero.png" })`
    returns a record whose KEYS are inferred from the manifest — `art.hero`
    autocompletes, `art.herp` doesn't compile. Top-level await makes the
    module boundary the loading screen (progress callbacks stay available
    for games that want a real loading bar). Today's `createAssets()` store
    - manifest types exist but don't give per-key inference.
    * Verdict: **change** (agreed)

25. **Spritesheet: config + cursor split, typed states.**

    ```ts
    const heroSheet = Anim.sheet(art.hero, {
      frame: { w: 32, h: 32 }, // structural (#9)
      states: {
        idle: { row: 0, frames: 4, fps: 6 },
        run: { row: 1, frames: 6, fps: 12 },
        jump: { row: 2, frames: 1 },
      },
    });
    const anim = heroSheet.play("idle"); // per-entity playback cursor
    anim.set(grounded ? "run" : "jump"); // typed: keyof states
    ```
    - Sheet = shared immutable config; `play()` = cheap per-entity cursor
      (many entities, one sheet).
    - Cursor self-advances (zero wiring); `set()` to the same state is a
      no-op (doesn't restart the loop — the classic bug).
    - State names flow through the generics: `anim.set("rnu")` is a compile
      error, same spirit as #4/#8.
    - Verdict: **change** (agreed)

26. **`Draw.sprite` joins the ambient-space primitives.**
    `Draw.sprite(anim, player, { flipX, scaleY })` — fitted to a structural
    Rect (anchor/scale derived), so sprites work inside camera blocks,
    minimaps, and parallax layers with no special path. Replaces the current
    split where sprite rendering lives in ECS (`drawSprites`) or manual ctx
    code. (ECS `drawSprites` remains as the batch path on top of this.)
    - Verdict: **change** (agreed)

27. **Two tween systems is one too many.** Today `Anim.animate/sequence/
parallel` (Motion) and `Clock`/`Tween` both answer "value over time".
    The sample's squash uses `Anim.animate({ from, to, ms, ease })` and it's
    fine — but the change-plan should bless ONE value-over-time API and fold
    the other into it (Claude's lean: keep `Anim.animate` as the surface,
    since sequence/parallel composition lives there; `Tween` becomes an
    alias or retires; `Clock` stays for scheduling, not tweening).
    Replacement-on-edge pattern shown in the sample (reassign the motion on
    landing) reads well; finished motions hold their end value.
    - Verdict: **change** (agreed)

---

## Increment 8 — juice (shake, bursts, dust)

**What we built:** particle bursts on coin pickup and landing, camera shake
scaled by fall speed (`impact` captured before `moveAndSlide` zeroes it),
`Particles.draw()` placed explicitly in the world pass.

28. **Particles: explicit instances (no singleton), self-stepping sim,
    explicit draw.** `const fx = Particles.createSystem()` — Niklas questioned the
    original singleton proposal; discussion produced a taxonomy law:
    - **Runtime services belong to one explicit game**:
      `game.Loop`, `game.Draw`, `game.Keys`, `game.Pointer`, plus factories
      such as `createUI(game)` and `createCamera(game)`.
    - **Game content is explicit instances** (plural by nature): `Input.map`,
      `ECS.create`, `Timers.jumpGate`, sheet cursors, motions,
      `createCamera`, and now `Particles.create` — particles want plurality
      (dust behind + sparks in front = two systems, two draw positions;
      confetti in screen space vs debris in world space = two blocks) and
      scene lifecycle (create per scene, drop on teardown).
      Alternatives rejected: engine singleton (inverts the moment a game needs
      two systems), ECS-integration (forces ECS; particle perf wants pooled
      arrays), self-drawing bursts (placement unanswerable).
      `fx.burst({ at, count, speed, life, size, color })`: structural `at`,
      `[min, max]` tuple ranges. The stepping law stands: SIMULATION
      self-steps, DRAWING is one explicit `fx.draw()` call — order and space
      are the game's decisions. Both laws go in the docs.
    - Verdict: **change** (agreed)

29. **`Camera.shake` survived contact with reality — and `Contacts` gained
    `impact`.** (#15's folding validated.) Shake offsets the main lens only:
    HUD steady (outside the block, #16), minimap steady (own lens, #19) —
    by construction. The ordering wrinkle (impact speed needed before
    `moveAndSlide` zeroes `vel.y`) is resolved in the API (Niklas: "make
    moveAndSlide return impact"): the contacts object carries
    `impact` — entry speed into the first blocking surface, px/step, `0`
    when contact-free. Amends the #13/#14 `Contacts` shape:
    `{ up, down, left, right, impact }`.
    - Verdict: **change** (agreed)

30. **Particles × ECS: immediate-mode emission, no integration API.**
    (From Niklas: "how would particles interface with ecs?") Three contact
    points, three answers:
    - Event bursts: already zero-integration — `fx.burst({ at: c })` inside
      the `ecs.each` that detects the event (sample's coin pickup).
    - Continuous emitters: **immediate-mode** — call
      `fx.emit({ at: t, chance: 0.4, ... })` every step from the owning
      system; the `each` loop IS the attachment, so despawn stops emission
      with nothing retained and nothing to leak. Rejected: an `Emitter`
      component + `attach` glue (buys one line, costs a component type and a
      hidden system — YAGNI, revisit if samples repeat the pattern), and
      retained emitter objects in component data (leak factory; would force
      despawn hooks into the ECS).
    - Particles as entities: stays rejected (#28) — pooled arrays win.
      Fine print: `chance` is stateless probabilistic emission (slight
      clumping, fine for juice); games needing deterministic `rate` keep the
      accumulator in their own component data.
    - Verdict: **change** (agreed)

---

## Increment 9 — scenes (title / playing / paused / cleared)

**What we built:** the game restructured into a typed scene map; `playing`
resets the level on enter; Escape pushes a `paused` overlay over the frozen
game; collecting everything goes to `cleared`. `Loop.run(scenes)` is the
entire handoff.

31. **Scenes: typed map, structural handoff, draw-through stack.** Today:
    `Scenes.define("title", scene)` + `Scenes.go("title")` — stringly
    registration, same disease as #21. Ideal reuses the #8 inference
    pattern:

    ```ts
    const scenes = Scenes.create({ title: {...}, playing: {...} });
    scenes.go("playing");        // typed: keyof the map; "playnig" won't compile
    Loop.run(scenes);            // the manager IS GameCallbacks, structurally
    ```
    - Scene shape: `{ enter?, exit?, update, draw, opaque?, holdsTime? }`.
      `holdsTime: false` on a pushed scene keeps `Clock.world` flowing while
      updates stay gated — the "live world under the pause menu" look:
      nothing moves (logic frozen) but idle cycles/particles keep breathing.
      Default `true` (hard freeze). Companion trick: the pushed scene's
      `enter()` is the home for visual policy like `anim.set("idle")` so a
      mid-sprint pause doesn't keep the run cycle pumping in place.
    - Stack semantics (sharpened in discussion): only the TOP scene
      updates (input routes itself — polling + update-gating, no
      capture/bubble system). Draw runs bottom→top starting from the
      highest `opaque: true` scene. Drawing below a modal is a RE-DRAW of
      frozen state, not a screenshot — resize-proof, translucency-trivial.
    - **The stack is a time boundary**: `push` holds `Clock.world` (#34),
      `pop` releases it. Pause is a consequence, not code: gameplay logic
      freezes (update gated) AND every clock-derived value freezes (motions,
      cursor frames, particles) with zero pause-awareness anywhere.
      `go` replaces the stack and holds nothing.
    - Honesty clause for the docs: scenes add zero capabilities — a
      `switch (mode)` is a first-class way to build a game, and a plain
      `paused` boolean is legitimate for tiny games. Scenes are a convention
      with teeth (named modes, enter/exit as the home for reset logic,
      standardized modality); `Loop.run(scenes)` stays a structural handoff,
      never an integration requirement.
    - Verdict: **change** (agreed)

32. **Content lifecycle: clock-derived, not registered — GC is the
    teardown.** The deep one. "Zero wiring" so far implied self-stepping
    objects (input maps, cursors, motions, particle sims) REGISTER on the
    engine's step — but then a dropped reference keeps stepping and leaks,
    and scenes would need ownership/dispose machinery to compensate.
    Resolution: these objects don't register at all — they DERIVE their
    state lazily from the engine clock when read:
    - `input.axis/pressed` — pure reads over `Keys`/gamepad state (edge
      state already step-tracked by the engine);
    - anim cursors — `frame = f(now - stateStart)`;
    - motions — `value = ease(clamp(elapsed / ms))`;
    - particle sims — advance in `draw()` by elapsed steps;
    - `jumpGate.try()` — updates internal timers from elapsed on call.
      Nothing holds them → dropping the reference IS the teardown → scenes
      need zero lifecycle API for content, and #28's taxonomy gets its
      enforcement mechanism for free. Game-bound services register against
      their owner and are destroyed with it. "Zero wiring" is now stated as:
      **pull, don't push — derive from the clock, never register.**

    Expanded (discussion): two mechanisms under the law —
    - **Closed-form**: store the birth certificate, compute on read.
      Motions (`ease(clamp(elapsed/ms))`), cursors
      (`floor(elapsed * fps) % frames`), even ballistic particles
      (`p₀ + v₀t + ½gt²`).
    - **Lazy fold**: for genuinely integrating state — store
      `{lastReadStep, state}`, fold forward by elapsed steps on read,
      memoized per step. Same math a registered system would do; only the
      driver changes (reader, not registry).
      Payoffs beyond lifecycle: unread content costs nothing; reads are pure
      and testable (set clock, read, assert); evaluation order is the code's
      read order, not hidden registry order.
    - Verdict: **change** (agreed)

33. **Anchored HUD positioning.** Title/pause/cleared text wants "center of
    screen" without reading the viewport (which the game stopped doing in
    increment 5). `UI.text(str, { anchor: "center", y: -30 })` — x/y become
    offsets from the anchor (`topLeft` default, `center`, `top`,
    `bottomRight`, …). Also the natural home for safe-area handling
    (anchors respect insets; absolute x/y can't).
    - Verdict: **change** (agreed)

34. **Two ambient clocks: `Clock.world` and `Clock.ui` — and clocks own the
    time constructors.** Clock-derived content (#32) needs to know which
    time it lives in. `Clock.world` is gameplay time — held by modal pushes
    (#31). `Clock.ui` never stops. Binding mechanism (chosen over a
    forgettable `clock:` option param, creation-scope blocks, and
    scene-bound magic): **the clock is the factory** —
    ```ts
    Clock.world.animate({...})   // fundamental form
    Anim.animate({...})         // sugar for Clock.world (the 99% path)
    UI.animate({...})           // sugar for Clock.ui — interface time
    const boss = Clock.create(); boss.animate({...}); boss.hold();
    ```
    The binding is visible in every call; any custom clock (cutscenes, boss
    fights) gets the full time toolkit (`animate`, `after`, …) for free.
    The layer taxonomy extends cleanly: world things live in world time
    (`Draw`/`Anim`), interface things in interface time (`UI`). Free wins:
    slow-mo (`Clock.world.scale = 0.5` — world slows, HUD doesn't), hit-stop
    (`Clock.world.hold()` + a `Clock.ui` timer to release).
    - Verdict: **change** (agreed)

---

## Increment 10 — audio (synth sfx + music with pause-ducking)

**What we built:** three synth sound effects (jump sweep, coin chime with
per-play pitch jitter, landing thud) fired from gameplay edges, and a
file-based music track started by `playing.enter` and ducked by the pause
scene's hooks.

35. **The unlock ceremony disappears.** Browsers gate AudioContext behind a
    user gesture; today game code calls `ensureAudio()` at the right moment.
    Ideal: the engine unlocks on the first input event it already listens
    for; plays before unlock are dropped with a dev-console warn (dropping a
    pre-gesture blip is correct — queuing it would play a stale sound). Zero
    wiring, one less footgun.
    - Verdict: **change** (agreed)

36. **Sfx: typed map of synth specs, content instances, jitter at play.**

    ```ts
    const sfx = Audio.sfx({
      jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
      thud: { noise: true, freq: { from: 200, to: 60 }, ms: 150, volume: 0.6 },
    });
    sfx.jump.play();
    sfx.coin.play({ pitch: [0.95, 1.15] }); // tuple = per-play random jitter
    ```
    - Same typed-map + property-access house style as #8/#31.
    - **Convention guard discovered:** `[min, max]` tuples are RESERVED for
      randomness (#28); anything directional (a frequency sweep) is
      `{ from, to }`. The two never collide anywhere in the API.
    - Synth-first stays minimotor's identity (dependency-free, no asset
      pipeline for a jump blip); sample-based sfx load via `Assets` and get
      the same `.play(overrides)` surface.
    - **Recipe building blocks (`Audio.Recipes`)** (Niklas: "add more built in typical sound
      effect building blocks") — sfxr-tradition generators that return
      SPECS, not opaque sounds, so they're tweakable and teachable:
      ```ts
      const sfx = Audio.sfx({
        coin: Audio.Recipes.coin(), // classic chime
        boom: Audio.Recipes.explosion({ ms: 400 }), // override any field
        hurt: Audio.Recipes.hit(),
      });
      ```
      Roster: `coin, jump, hit, explosion, laser, powerup, blip, click,
whoosh`. Each returns a plain SfxSpec — inspect it, tweak it, learn
      the synth vocabulary from it.
    - Verdict: **change** (agreed)

37. **Music is content; ducking is scene policy; audio lives on the
    hardware clock.**
    - `Audio.music(art.theme, { loop: true, volume: 0.5 })` — an instance
      from an asset (synth/pattern music can come later as another source).
      `play()` idempotent; `fade(volume, ms)` is the one transition tool
      (ducking = fade down on `paused.enter`, fade up on `exit` — no duck
      concept needed, no pause-awareness in the audio layer).
    - **Deliberately outside the #34 clock system**: audio runs in real
      time on the hardware clock — a held `Clock.world` must not stop the
      pause-menu music, and fades are wall-time by nature. (Optional future
      juice, noted not specced: pitch-bending sfx by `Clock.world.scale`
      during slow-mo.)
    - `Audio.*` master (volume/mute, persisted via `Storage`) is the
      game-owned mixer API; sfx maps and music instances are content (#28
      taxonomy holds).
    - Verdict: **change** (agreed)

38. **The mixer: default buses are platform, custom buses are content.**
    (From Niklas: "how does the audio mixer tie into everything?") The
    mixer is the routing graph `sound → bus → master`; each node has volume
    - effects (reverb/lowpass/compressor).
    * **Default buses ship with the engine** (`Audio.master`,
      `Audio.buses.sfx`, `Audio.buses.music`) — stable, well-known knobs, so
      a settings screen is three sliders + `Storage`, zero plumbing. Sfx
      maps route to `buses.sfx` by default, music to `buses.music`.
    * **Custom buses are content**: `Audio.bus({ reverb, lowpass })`;
      routing per-map (`Audio.sfx(spec, { bus })`) or per-play
      (`.play({ bus })`).
    * **Environments are scene policy on bus params**:
      `Audio.buses.sfx.fade({ reverb: 0.5 }, 400)` in a scene's
      `enter`/`exit` — every sound in the game gets the cave treatment, no
      individual sound told anything. (Sharpens #37: pause-duck can be
      instance-fade or bus-fade; scenes pick the altitude.)
    * **Sidechain ducking is declarative bus config** (per-sound automatic,
      so not a scene event):
      `Audio.buses.music.duckUnder(Audio.buses.sfx, { amount: 0.3, ms: 120 })`.
      The one survivor of today's `Mixer` as a named concept.
    * **Escape hatch**: no arbitrary graph API — `Audio.raw` exposes the
      AudioContext, same drop-to-raw ethos as the canvas.
    * Verdict: **change** (agreed)

---

## Increment 11 — tiles (the level becomes data)

**What we built:** the hand-placed `Solid[]` platforms replaced by an ASCII
tilemap with a legend; coins and the player start are spawn markers in the
grid; the camera world, collision solids, culled rendering, and world clamp
all derive from `level`. The hand-kept `world` const is gone.

39. **ASCII levels with a legend — the level IS the source file.** Today:
    `Tiles.grid(data: number[][], config)` — a number matrix nobody can
    read. Ideal:

    ```ts
    const level = Tiles.grid(
      `
    ......o.....
    .....===....
    ..P.........
    ############
    `,
      {
        size: 50,
        legend: {
          "#": { solid: true },
          "=": { solid: true, oneWay: true }, // #13's flag
        },
      },
    );
    ```

    **Revised after Niklas's "wish I could use it more as data":** the
    legend is SEMANTICS ONLY — plain JSON flags, no colors, no selector
    objects. The entire level def (grid string + size + legend) is
    serializable data: file-loadable, editor-friendly, net-sendable, and —
    decisive — `minimotor/server` runs `moveAndSlide` against the same
    level with zero canvas dependencies. Presentation moved to skins (#41).
    - Verdict: **change** (agreed)
    - **The marker rule**: legend chars are tiles; `.` and space are empty;
      any OTHER char is a spawn marker — `level.spawns("o"): Vec2[]`,
      `level.spawnOne("P"): Vec2` (tile centers). Tiles stay dumb; the game
      owns what markers mean (coins, start, enemies later). No callback
      magic in the map.
    - **Derived geometry**: `level.rect` is the world Rect — feeds
      `Camera.follow({ world })` and `Vec2.clampRect(player, level.rect)`;
      the hand-kept world const dies.
    - **`level.draw()`** inside the camera block, culled to `Camera.rect`
      by grid math for free. Legend colors now; sprite tiles later via
      `{ sprite }` legend values + atlas.
    - Today's grid-movement helpers (`MoveOptions`/`MoveResult`/`MoveDir` —
      snake/sokoban steppers) are orthogonal to this and keep living for
      grid-movement games.
    - Verdict: **change** (agreed)

40. **`moveAndSlide` takes solid SOURCES, and the tilemap is one.**
    `Collision.moveAndSlide(body, level)` — same call shape as the
    `Solid[]` array, but the grid answers "which solids are near this
    body?" in O(1) instead of scanning an array (broadphase for free — the
    actual point of tile grids). Accepted sources: `Solid[]`, a `TileMap`,
    or a mixed array (`[level, movingPlatform]`) for when dynamic solids
    join the static world.
    - Verdict: **change** (agreed)

41. **Tilesets & skins: presentation applied at the draw site.** (From
    Niklas: "how can it be combined with tilesets/atlas?", revised by "wish
    I could use it more as data".)

    ```ts
    const tiles = Tiles.set(art.tileset, {
      size: 16, // source cell size
      names: { ground: [0, 0], plank: [2, 0] },
    });
    const skin = { "#": tiles.auto16(tiles.ground), "=": tiles.plank };
    // or the zero-asset tier:  const skin = { "#": "#3a3f4a", "=": "#31555a" };
    level.draw(skin);
    ```

    A skin is a plain `{ char: color | selector }` map handed to `draw` —
    appearance decided where drawing happens, per the drawing-is-explicit
    law. Same level, many skins: themes, seasons, and the minimap drawing
    the level with flat colors inside its lens (#19 + #41 compose).
    - **Typed skins** (Niklas: "can we add typescript helper for skin?"):
      `Tiles.grid` infers `K = keyof legend`; the exported `Tiles.Skin<L>`
      type makes `satisfies Tiles.Skin<typeof level>` the blessed authoring
      idiom — completeness enforced (new tile kind → every skin errors
      until it answers), unknown chars rejected, `null` = deliberately
      invisible. No runtime identity helper (API noise; `satisfies` does
      it at zero cost). Markers need no skin entry and stay typed as
      plain `string` (extracting chars from the ASCII literal type is
      gymnastics that dies on runtime-loaded levels — not specced).
    - **Multi-cell shapes stay tiles.** A legend entry may declare
      `span: [cols, rows]`, while its skin uses
      `tiles.region(col, row, cols, rows)`. The API Lab slopes are therefore
      ordinary `R`/`L` map cells with both collision and atlas art handled by
      `Tiles`; no marker conversion, custom `Solid[]`, sprite construction, or
      extra draw call. Spans also work for larger ladders, doors, and arches.
      Slope shape falls out of the same geometry: `[2, 1]` is a shallow
      two-cell ramp and `[1, 1]` is the usual 45° one-cell ramp. Taller custom
      ratios such as `[1, 2]` remain possible without another collision API.
    - **Nine-grid terrain is the common automatic tier.**
      `tiles.auto9(base, { stride, connect: "solid" })` reads the conventional
      top/middle/bottom × left/middle/right atlas. `stride` supports atlases
      whose entries have padding; semantic connectivity joins ground to slope
      spans even when their legend characters differ. `auto16` remains the
      richer bitmask tier for concave/cardinal combinations.
    - **Multi-character legend glyphs preserve visual geometry.** This is not
      a named-token matrix: a glyph consumes its literal ASCII columns.
      Longest match wins, and width becomes the default horizontal span, so
      `//#####\\` visibly authors two-cell slopes without anchor-plus-dot
      notation. Explicit `span` remains for vertical/taller footprints.
      Tileset names are a separate descriptive layer and may name either
      `[col, row]` cells or `[col, row, cols, rows]` regions—e.g.
      `terrain.ground9`, `terrain.slopeDown`, and `terrain.steepUp`.
    - Verdict: **change** (agreed)

42. **Data never draws itself — `Draw` owns all rendering.** (From Niklas:
    "it feels like level.draw() is wrong. why does it know how to draw?")
    A `.draw()` method on the level drags the rendering layer into a pure
    data object we just made server-safe. Rendering moves to the renderer:
    ```ts
    Draw.tiles(level, skin); // was level.draw(skin)
    Draw.particles(fx); // was fx.draw() — same violation, milder
    ```
    The level keeps query methods (`spawns`, `rect`, solids source) — pure
    data questions, valid server-side. The rule in final form: the game
    decides WHERE and in what ORDER (call placement); `Draw` is the only
    namespace that knows what a canvas is. Everything visible is a `Draw.*`
    call — one discoverable vocabulary, all content platform-free.
    - Verdict: **change** (agreed)

---

## Increment 12 — UI widgets (the pause menu gets real)

**What we built:** the pause overlay became a settings menu — a centered
auto-flowing panel with Resume/Restart buttons and music/sfx volume sliders
bound to the default buses (#38), persisted via `Storage` in the scene's
`exit` hook.

43. **Interaction model: return values, value-in/value-out.**

    ```ts
    if (UI.button("Resume")) scenes.pop();
    Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume);
    ```
    - A widget's interaction IS its return value (button → clicked,
      slider → new value, toggle → new boolean). No callbacks, no binding
      objects, no event system — the dear-imgui tradition, and the same
      "existence is calling" law as immediate-mode emission (#30).
    - Sliders/toggles are value-in/value-out: the game owns the state and
      the wiring is visible in one line. `min`/`max`/`step` via options,
      default 0..1.
    - First positional arg is the label (buttons/sliders always have one);
      options object second — consistent with the styled-content rule (#7).
    - Verdict: **change** (agreed)

44. **Layout: containers are blocks that auto-flow; identity is the label,
    scoped by containers.**

    ```ts
    UI.panel({ anchor: "center", w: 260, pad: 16, gap: 10 }, () => {
      UI.text("PAUSED", { size: 28 });
      if (UI.button("Resume")) ...
    });
    ```
    - Inside a container, widgets take NO positions — vertical flow with
      `gap`, sized to content unless overridden. `UI.row(fn)` for
      horizontal runs. Containers anchor like text (#33). Absolute x/y
      remains for containerless one-offs (the HUD coin counter).
    - Blocks are correct here (unlike the camera default path): nesting IS
      the semantics of layout.
    - Widget identity (hover/drag/focus state across frames) = the label,
      hashed within the container stack; `{ id }` option for label
      collisions ("OK" twice in one panel).
    - Verdict: **change** (agreed)

45. **Surface tiering — the UI module is the engine's biggest and should
    say so.** Today's `ui/` has ~50 exported option types (button, panel,
    toggle, tabs, slider, spinner, bar, table, list, grid, popover, modal,
    confirm, drag-drop, textInput, select, scrollbar, theming…). Proposal:
    - **Game tier** (documented first, small): text, button, slider,
      toggle, panel, row/col, bar, theme — covers ~90% of games.
    - **App tier** (kept, documented separately): table, list, grid, tabs,
      textInput, select, popover/modal/confirm, drag-drop — for
      tool/sim/card games that are basically applications.
    - Gamepad/keyboard focus navigation: now designed — see #46 (Niklas has
      tab focus working in today's UI; it's the right foundation).
    - Verdict: **change** (agreed)

46. **Pad/keyboard menu navigation piggybacks on tab focus.** (Niklas: "I
    have tab focusing working in UI now. Can we piggy back on that?") Yes —
    and it's the CORRECT base because immediate mode gives
    focus order = call order = visual order (#44 auto-flow).
    - **Spatial nav is the specced behavior** (Niklas: "i want spatial
      nav"): dpad/stick moves focus to the nearest widget rect in the
      pressed direction — the containers compute every widget rect during
      layout, so the geometry is free. Plain call-order next/prev remains
      as the tab-key behavior and the tie-break fallback. Both drive the
      SAME focus machine tab focusing already keeps.
    - **Activation folds into return values (#43)**: `if (UI.button(...))`
      already means clicked; it now also means focused+activated
      (Enter/Space/`pad:a`). Focused sliders consume left/right to adjust,
      returned through the same value-in/value-out call. **Existing menus
      become pad-navigable with zero call-site edits** — the payoff of
      never having had an event system.
    - Bindings: engine defaults, overridable via
      `UI.nav({ next, prev, activate })` in `KeyCode`/`PadCode` vocabulary
      (#4/#8). Deliberately NO `back` binding — cancel/close is scene
      policy, not UI's.
    - Frozen scenes fall out of the nav ring automatically (their widgets
      aren't called; focus is keyed by widget identity, #44).
    - Mouse coexistence: hover ≠ focus; last-device-wins shows/hides the
      focus ring.
    - Verdict: **change** (agreed — with spatial nav primary)

47. **Scenes × UI overlays: one owner per concern.** (Niklas: "how does
    scenes co-exist with the UI modal api we have now?") Today UI ships its
    own overlay system (popover/modal/confirm) while scenes model modality
    — two modality systems, the #27 disease. The cure:
    - **Scenes own time, input gating, lifecycle. UI overlays own
      appearance and hit-blocking within one frame's widget tree.** They
      compose; they never compete.
    - `UI.modal` demotes to a CONTAINER VARIANT: backdrop panel that
      swallows pointer/focus for widgets drawn earlier the same frame —
      knows nothing about clocks or updates. `UI.confirm(text)` is sugar
      over it returning `"yes" | "no" | null`.
    - Composition rules: popover → widget-local, never a scene. Confirm
      inside an already-modal scene (pause menu) → pure UI. Mid-GAMEPLAY
      confirm → a tiny pushed scene whose draw is one `UI.confirm` call
      (the push supplies time-hold + gating per #31).
    - Kills today's silent failure: `UI.confirm` mid-game with the world
      running behind the dialog — freezing was never UI's job, so it can
      no longer be half-done.
    - Verdict: **change** (agreed)

---

## Increment 13 — net (ghost players)

**What we built:** join a named room over the dev signaling endpoint; every
player broadcasts position 15×/s; other players render as translucent,
interpolated ghosts; peer count in the HUD. Offline degrades to
single-player with one `.catch(() => null)`.

48. **A symmetric room, not host/guest branches.** Today `Net.host()` and
    `Net.join()` return different session types with different vocabularies
    (`broadcast`/`send(guestId)` vs `send`), so the star topology leaks
    into game code as `if (isHost)` branches. Ideal:

    ```ts
    const room = await Net.join(signalUrl, { room: "api-lab" });
    room.id; room.peers; room.onJoin(fn); room.onLeave(fn);
    room.send(msg);                 // to everyone (host relays internally)
    room.onMessage((from, msg) => ...);
    ```

    Who hosts, relay fan-out, and host-drop healing (which the current
    rtc-session already does!) are INTERNAL. Room names fold matchmaking
    into `join`. Typed via `Net.join<Msg>`. The current asymmetric API
    remains the lower tier for genuinely host-authoritative games.
    - Verdict: **change** (agreed)

49. **`Net.sync` — declarative state replication.** Every casual
    multiplayer game hand-assembles the same three parts: a send-timer, a
    per-peer interpolator, a timeout-pruned roster (`createInterpolator` +
    `createRoster` + a loop, today). Fused:

    ```ts
    const ghosts = Net.sync(room, {
      hz: 15,
      state: () => ({ x: player.x, y: player.y, flip: facing < 0 }),
    });
    for (const g of ghosts) Draw.rect(g.x, g.y, 32, 32, "#4ecdc466");
    ```

    Numbers lerp between snapshots, other fields step; peers prune on
    timeout; self excluded; states are plain structural objects (#9's
    "JSON-safe for net snapshots" foretold this). The parts stay exported
    as the lower tier.
    - Verdict: **change** (agreed)

50. **The stated exception to #32: net is real IO.** Connections can't be
    clock-derived — sending must self-drive, sockets aren't GC-collectable
    semantics. A room is a RESOURCE: explicit `room.close()` (tears down
    its syncs), like audio living on the hardware clock (#37). Laws are
    better with their exceptions written down.
    - Verdict: **change** (agreed)

51. **Fsm: keep, restyle to the house pattern.** (Claude's sweep flag said
    justify-or-retire; Niklas correctly pushed back — ascent-style player
    state IS the justification: transition rules like "wall-jump only from
    wallslide" are where hand-rolled booleans become bug farms.)

    ```ts
    const state = Fsm.create({
      idle: { update: () => (run !== 0 ? "run" : undefined) },
      jump: { enter() { vel.y = JUMP; }, update: () => (vel.y > 0 ? "fall" : undefined) },
      ...
    });
    state.update();
    anim.set(state.current);   // the entire AnimBridge — one line, machinery retired
    ```

    Typed map (#8/#31 pattern), enter/exit hooks like scenes,
    transition-by-returned-name. The altitude ladder: scenes = game modes,
    Fsm = entity behavior, anim states = visuals driven by the Fsm.
    Break-even documented (the api-lab ternary is below it; ascent is
    above). Signals keeps its justify-or-retire flag — Fsm's reprieve
    doesn't transfer.
    - Verdict: **change** (agreed)

52. **Physics2D round-2 sketch — our laws applied.** `vel: Vec2` (#12);
    `step()` takes no arg (#5) and STAYS explicit — physics is game-driven,
    path-dependent simulation, not registered content (an unstepped world
    doesn't simulate; a dropped one is GC'd — #32-consistent); the `Phys`
    component + `attach()` glue retires per #30 (the each-loop is the
    attachment: `ecs.each(Body, (e, b) => Draw.sprite(anim, b, ...))`);
    `onContact(cb)` → pollable `phys.contacts` valid after step (#22's
    no-callback-timing treatment); planck stays isolated behind the
    `minimotor/physics2d` entry (dependency-free core is the promise).
    - Verdict: **change** (agreed)

53. **Server-authoritative tier = the same room, viewed from the end that
    owns the truth.** (Niklas: "how does the server-authoritative tier tie
    together with our current net changes?")
    - `Net.join(url, { room })` is IDENTICAL client code across topologies:
      P2P star (WebRTC, host peer relays) or client-server (WebSocket, the
      server IS the host). Today's `serve()`/`Room` becomes the server
      speaking the room protocol from the other end.
    - `Net.sync` generalizes symmetrically: clients sync state up; the
      server runs `room.sync({ hz: 20, state: () => worldPacket })` down.
      Today's primitives already mirror this: `createPresence` ≈ the
      server-side roster, `serverTick` ≈ the server's fixed-step loop —
      the change-plan names them as the same machinery.
    - Authority policy (validation, bots, relay rules) stays game code.
      Specifics judged in round 2 with a server-authoritative sample
      (road-rivals as corpus).
    - Verdict: **change** (agreed)

---

## Sweep — existing API areas the sample never touched

Quick dispositions; each "flag" is a candidate for a round-2 review.

- **Physics2D** (planck entry point): unreviewed; already owes #12 work
  (`vx/vy/spin` → `vel` Vec2). Needs its own round — `Phys` component +
  `attach()` glue predates the #30 "each-loop-is-the-attachment" insight.
- **Fsm**: ~~justify-or-retire flag~~ reversed by Niklas (ascent's player
  state is the justification) — keep and restyle, see #51.
- **Signals** (event bus): many uses dissolve into scenes/ECS/direct calls.
  Flag: justify or retire.
- **Transitions** (fade/wipe): should become a `scenes.go`/`push` option —
  `scenes.go("playing", { transition: fade(300) })` — instead of a manual
  run/swap API. Flag with that sketch.
- **App construction**: the old fluent builder was removed. The API now uses
  `createApp(canvas, options)` directly.
- **Fullscreen**: two exports orbiting `Stage` — fold into
  `Stage.init({ fullscreen: ... })` / `Stage.fullscreen()`. Flag.
- **game.ts grab-bag** (`createScoreTracker`, `letterbox`, `formatClock`):
  homeless helpers. scoreTracker is Storage sugar; letterbox is a camera
  concern post-#19; formatClock is Mathf-ish. Flag: rehome or retire.
- **Gizmos/Goodies**: two grab-bag namespaces with real gems (seedRng,
  shuffleBag, undoStack, steering, floodFill) — no API problems observed,
  but organization/naming deserves a deliberate pass (is `car` physics?
  is `combo` scoring?). Flag: taxonomy pass, low urgency.
- **Timers** (`window`, `buffer`, `cooldown`): fine; `jumpGate` reviewed
  (#11). Check naming (`window` collides with the global in docs examples).
- **Storage**: used throughout the sample; typed load/save with fallback
  is exactly right. **Keep as-is.**
- **Perf**: plugin + HUD fine as the one blessed EnginePlugin; `netMeter`
  should learn about #48 rooms. Minor flag.
- **Sprites** (atlas/packAtlas/tint): general tools under #41's `Tiles.set`
  — keep; document as the layer below sheets/tilesets.
- **Server tier** (`serve`/`Room`, `matchmake`, `signaling`, `createPresence`,
  `serverTick`): deliberately NOT judged by this sample (P2P only touched
  signaling). Server-authoritative games are a different genre of consumer
  — round-2 review with its own sample (road-rivals is the corpus).
  - `Tiles.set` is the space-indexed cousin of `Anim.sheet` (same family:
    image + grid → cells; sheet indexes by time, set by name). Source
    cell size scales to the map's world tile size — the two never need
    to agree.
  - Tile behaviors are cell SELECTORS, not systems:
    `tiles.pick(cells, weights)` — per-cell variants, seeded by cell
    coords (deterministic, stateless, #32 applied to aesthetics);
    `tiles.anim(cells, { fps })` — Clock.world-derived (pauses with the
    world), coord-offset phase; `tiles.auto16(base)` — autotiling via the
    standard 16-cell bitmask layout (neighbors sharing the legend char),
    escape hatch: `tile: (neighbors) => cell`.
  - Cheap by construction: selectors are per tile KIND; pure functions of
    (coords, neighbors, clock) → static layers bakeable offscreen.
  - `Sprites.atlas`/`packAtlas` stay as the general tools underneath.
  - Verdict: **change** (agreed)
