# REVIEW_PLAN — hardening pass from the 2026-07 code review

Derived from a full read of `src/` (~20k lines, 42 test files / 528 tests, clean
`tsc --noEmit`). This is a work plan, not a redesign: the architecture is sound
and nothing here proposes changing it.

**What the review found, in one line each:**

- Two silent, total-failure bugs triggered by calling `App.init()` twice.
- `measureText` is called unmemoized on every widget every frame — the single
  biggest perf item in the codebase.
- A handful of contained camera/cache/lifecycle defects.
- `Physics2D` is the one module thin enough that real games fall through it.
- Assorted per-frame allocations in Clock, Net, ECS and UI input.

**Explicitly NOT in this plan:** trimming `Goodies`/`Gizmos`. That catalog is a
deliberate, growing feature of the engine — see
[§7](#7-goodiesgizmos--grow-the-catalog) and the rewritten
[ROADMAP § Goodies & Gizmos](ROADMAP.md).

Status legend: ⬜ todo · 🟡 in progress · ✅ done

---

## Priority 0 — silent total failures

### P0.1 ⬜ `App.init()` twice kills Clock timers and the whole UI kernel

**Severity: high.** Silent, total, affects two subsystems, and `App.init` is
documented as re-callable ("Calling it again tears down the previous default and
replaces it" — `engine/facade.ts:41`).

**Evidence.** Reproduced with a throwaway vitest against the real modules:

```
fired on app A: 5  | fired on app B: 0
UI frame-end ran on app C: 2 | on app D: 0
```

**Root cause.** Two one-shot latches that outlive the app instance they wired
themselves onto. `App.destroy()` clears the destroyed app's handler sets, but
nothing tells the latch holders they were unwired:

| Latch         | File                                                                                 | Consequence after re-init                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `driverWired` | `clock.ts:59`, set in `ensureDriver()` `clock.ts:67-76`                              | `Loop.onStep(fireAll)` was registered on the _dead_ app. **Every `Clock.after` / `Clock.every` stops firing** — on `Clock.world`, `Clock.ui` and every `Clock.create()` timeline.                        |
| `rt.wired`    | `ui/core/runtime.ts:25,28,53`, set in `ensureWired()` `ui/core/lifecycle.ts:123-140` | The new app gets no `onStep`/`onFrame`. The pointer cache never clears, overlay capture latches on, the focus registry never closes, `sweepCaches()` stops, `padNav()` stops. **The UI kernel is dead.** |

Both are the same shape, so fix them the same way.

**Fix.** Make the wiring observable rather than a boolean. Preferred: an
app-lifecycle notification in `engine/default-app.ts`, since it already owns the
slot and both consumers already import from `engine/`.

```ts
// engine/default-app.ts
const changeHandlers = new Set<() => void>();

/** Notified whenever the default app is installed, replaced or cleared —
 *  for module-level wiring that must re-attach to the new app's loop. */
export function onDefaultAppChange(fn: () => void): () => void {
  changeHandlers.add(fn);
  return () => changeHandlers.delete(fn);
}
// fire from BOTH setDefaultApp() and clearDefaultApp()
```

Then:

- `clock.ts` — on change, set `driverWired = false` and re-run `ensureDriver()`
  if `driven.size > 0`.
- `ui/core/lifecycle.ts` — on change, clear `wired` on every runtime in
  `allRuntimes` whose host resolves to the replaced app (the default runtime
  always qualifies). `ensureWired()` re-attaches on the next widget call.

**Alternative (smaller, also acceptable):** store the app the wiring attached to
(`let wiredApp: App | null`) and compare against `uiApp()` / `getDefaultApp()`
instead of a boolean. Fewer moving parts; slightly more per-call work.

**Acceptance.** New test file `src/__tests__/reinit.test.ts`:

1. `App.init("a")` → register `Clock.world.every(…)` → tick frames → asserts it
   fired; `App.init("b")` → register another → tick → **asserts it fires**.
2. Same shape for a `UI` `onFrameEnd` hook across a re-init.
3. `App.destroy()` also clears `frameHandlers` (see P0.2) — assert no handler
   runs after destroy.

Note when writing the harness: the loop's `if (!lastTime) lastTime = time` means
a first `tick(0)` yields zero elapsed. Drive with `tick(16)` then `tick(400)`.

### P0.2 ⬜ `app.destroy()` leaks `frameHandlers`

`engine/app.ts:804-806` clears `stepHandlers`, `stepStartHandlers` and
`resizeHandlers` but not `frameHandlers` (declared `app.ts:581`). One-line fix;
fold into P0.1's test.

---

## Priority 1 — performance

### P1.1 ⬜ Memoize `measureText` (biggest single win)

**Problem.** 24 unmemoized `measureText` call sites, all on per-frame widget
paths. Cost per widget:

| Widget                     | `measureText` calls per frame                                                         |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `UI.text` (plain)          | 2 — `natural` at `ui/core/text.ts:183`, plus `centeredText` at `ui/core/theme.ts:186` |
| `UI.text` (ellipsized)     | 2 + **~log₂(n)** — `ellipsize`'s binary search, `theme.ts:154-165`                    |
| `UI.text` (`wrap: true`)   | 2 + one per word — `wrapLines`, `text.ts:122-137`                                     |
| `UI.button`                | 1 (`button.ts:131`) + the label's `UI.text` cost                                      |
| `UI.tabs`                  | one **per tab** (`tabs.ts:49`)                                                        |
| `UI.slider`                | 3 (`slider.ts:91,93`)                                                                 |
| `UI.toggle` / `UI.tooltip` | 1 each (`toggle.ts:66`, `tooltip.ts:45`)                                              |
| `UI.confirm` / `UI.dialog` | one per button + title + one per line (`overlays.ts:231,235,237`)                     |
| `UI.textInput`             | up to 8 per frame while focused (`text-input.ts:582-609`)                             |

A moderate HUD is several hundred per frame. `measureText` is one of the most
expensive Canvas2D calls, and (font, string) pairs are near-static frame to
frame.

**Fix.** A memo in `ui/core/text.ts` (or a new `ui/core/measure.ts`) keyed on the
font string joined to the text with a separator that cannot occur in a font name
(a NUL escape), caching the three values every caller actually wants:

```ts
interface Metrics {
  width: number;
  asc: number;
  desc: number;
}
export function metrics(ctx: CanvasRenderingContext2D, str: string): Metrics;
export function measureWidth(ctx: CanvasRenderingContext2D, str: string): number;
```

Back it with the existing `sweptCache<Metrics>()` from `ui/core/frame-cache.ts`
— it already expires untouched entries after `STALE_FRAMES` (600) and sweeps
every `SWEEP_EVERY` (120) frames, which is exactly the eviction policy this
needs for dynamic strings (score counters, timers). The cache key must include
`ctx.font` because it is set by the caller before measuring.

Then route through it: `textWidth`, `text()`'s `natural`, `centeredText`'s
metrics read, `ellipsize`'s search, `wrapLines`, and the widget call sites
above. `ellipsize` benefits twice — memoizing turns its binary search from
~6 real measures into ~6 map hits after the first frame.

**Careful with:** `centeredText` pins `ctx.textBaseline = "alphabetic"` before
measuring _because_ `actualBoundingBox*` is baseline-relative (`theme.ts:178-181`).
The memo must preserve that invariant — measure under a known baseline, or key
on it. Also keep the mocked-ctx fallback path (`asc || desc` false → `"middle"`
baseline) working; jsdom tests depend on it.

**Acceptance.** A test asserting a second identical `UI.text` call in the same
frame issues no new `measureText` (spy on a mock ctx). Existing UI tests stay
green.

### P1.2 ⬜ Per-step array copies in `clock.ts`

`fireAll()` does `[...driven]` (`clock.ts:62`) and `fire()` does `[...timers]`
(`clock.ts:100`) — **every fixed step**, for every clock with a live timer.
Both are already flagged by oxlint (`unicorn/no-useless-spread`).

The copies exist so a timer callback can cancel/schedule during iteration.
Replace with either a reusable module-scope scratch array (refilled, not
reallocated) or mark-and-sweep on the `dead` flag that `TimerJob` already
carries. Keep the "a timer cancelled mid-fire does not fire" guarantee — add a
test for it if one is missing.

### P1.3 ⬜ Net per-message and per-frame allocations

| Item                                                        | File                  | Fix                                                                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new TextEncoder()` / `new TextDecoder()` per message       | `net/room.ts:29-30`   | Hoist both to module scope.                                                                                                                                                                             |
| `get peers()` returns `[...members]`                        | `net/room.ts:138`     | Reads like a cheap property, allocates per read. Return a cached array invalidated on join/leave, or document it as a snapshot and add a `peerCount` getter.                                            |
| `sync` iterator spreads `{...state, id}` per peer per frame | `net/room.ts:311-317` | Reuse a per-peer output object, or document as allocating and leave it (draw-loop only, bounded by peer count — lowest priority of the four).                                                           |
| `sync` drives on `setInterval`                              | `net/room.ts:283-292` | Not loop-driven, so it isn't pause-aware, isn't throttled with the tab, and broadcasts into an empty room. Move to `Loop.onStep` with an accumulator, and skip the send when `room.peers.length === 0`. |

### P1.4 ⬜ ECS / Physics2D iteration allocations

- `ecs/world.ts:255` — `each` calls `fn(...eachRow)`; the spread materializes an
  arguments array per entity. Special-case arities 1–3 (which covers essentially
  every real query) with direct calls, falling back to the spread beyond that.
- `ecs/world.ts:295-297` — `query`'s generator allocates a fresh `row` array per
  matched entity. This is inherent to the tuple-yielding API; the fix is
  documentation, not code — steer hot paths to `each` in the `query` doc comment.
- `physics2d.ts:425-431` — `attach`'s sync system uses `query` where `each` is
  available. Switch it; this is the engine's own hot loop and it should model the
  advice.

### P1.5 ⬜ `Solid[]` has no broadphase

`collision.ts:311-332`. The "fast path" for a plain `Solid[]` returns **the whole
array unfiltered**, and `slide()` then sweeps every element across up to 3
passes. Tile levels get O(1) broadphase via `Level.solidsNear`; loose solids get
O(n) per mover per step. 300 crates × 50 movers ≈ 45k sweeps/step.

`gather()` also re-scans the entire array calling `isSource()` on every call just
to pick a branch.

**Fix.** Ship a tiny uniform-grid `SolidSource` — the seam already exists, so
this is additive and costs the existing API nothing:

```ts
/** Bucket static solids into a uniform grid for O(1) broadphase.
 *  Rebuild when the set changes; pass the result anywhere Solids is taken. */
Collision.grid(solids: Solid[], cellSize: number): SolidSource
```

Also cache the `isSource` scan result — or drop the scan by asking callers to
pass a homogeneous array and checking only `solids[0]`.

### P1.6 ⬜ Smaller per-frame allocations

- `ui/core/input.ts:128-145` — `rawPointer()` builds a fresh object every call,
  including once per frame from `clearGestureClaim()`. Fill a module-scope
  scratch object; the returned value is already documented as read-only.
- `ui/core/input.ts:194-197,207-211` — `uiToScreen` and `dragPointer` allocate;
  `dragPointer` spreads the raw pointer. Same treatment.
- `text.ts:41-55` — `drawText` does a full `ctx.save()/restore()` per string.
  Set and restore the four properties (`font`, `fillStyle`, `textAlign`,
  `textBaseline`) instead.
- `tiles.ts:238-263` — `paintCells` sets `fillStyle` per cell on flat-color
  skins. Track the last fill and skip redundant sets; on a large level this is
  thousands of avoided state changes per frame (the `bake` path sidesteps it, but
  the live path is the default).
- `ui/widgets/lists.ts:569-572` — `thumbRect()` allocates, called 2-3× per
  scrollbar per frame.
- `camera.ts:123-161` — `desired()` and `targetPoint()` allocate per fold step.
  Bounded (usually 1 step/frame), but trivially avoidable with two scratch
  objects.

---

## Priority 2 — correctness defects

### P2.1 ⬜ Camera pixel snapping is in world units

`camera/camera.ts:219-224`:

```ts
ctx.scale(state.zoom, state.zoom);
ctx.translate(-Math.round(state.x + sh.x), -Math.round(state.y + sh.y));
```

The comment promises "keeps integer world geometry on integer device pixels",
but the rounding happens _before_ the scale. At `zoom: 3` camera motion
quantizes to 3-device-pixel jumps — visibly worse than not snapping at all.

**Fix.** Snap in device space: `-Math.round((state.x + sh.x) * zoom) / zoom`.
Add a test asserting the applied translation lands on a whole device pixel at
zoom 1, 2 and 3.

### P2.2 ⬜ `Camera.toWorld` / `toScreen` ignore shake and `into`

`camera/camera.ts:289-302`. Both use only `state.x/y` and `state.zoom`.
`Camera.toWorld(Pointer)` is documented as _the_ mouse-picking call
(`camera.ts:75`), but:

- Under a lens rendered via `render(cam, { into }, fn)` (minimap, split-screen,
  PiP) the mapping is wrong — `applyLens`'s `into` branch uses a completely
  different scale (`Math.min(into.w / r.w, into.h / r.h)`) and offset.
- The shake offset applied in `applyLens` is not applied here, so picking drifts
  during impacts.

**Fix.** Have `toWorld`/`toScreen` share one mapping function with `applyLens`.
For `into`, either store the last-rendered `into` rect on the lens, or add an
explicit `toWorld(p, { into })` overload — the explicit form is more in keeping
with the codebase's "no hidden frame state" style.

### P2.3 ⬜ `Camera.shake` restack drops amplitude

`camera/camera.ts:285`:

```ts
shakeAmp = Math.max(shakeOffset().x !== 0 || shakeOffset().y !== 0 ? shakeAmp : 0, amplitude);
```

Calls `shakeOffset()` twice, and uses "offset is nonzero" as a proxy for "a shake
is live". `wobble()` legitimately returns 0 on some steps, so a restack landing
on such a step silently discards the running amplitude. Replace with a direct
liveness test:

```ts
const live = shakeAmp > 0 && steps() - shakeStart < shakeSteps;
shakeAmp = Math.max(live ? shakeAmp : 0, amplitude);
```

### P2.4 ⬜ `UI.listItem`'s transparent guard never fires

`ui/widgets/lists.ts:683` — `if (ctx.fillStyle !== "transparent")`. Canvas
normalizes `fillStyle` on read; assigning `"transparent"` reads back as
`"rgba(0, 0, 0, 0)"`. The guard is dead, so every list row pays a no-op
`fillRect` every frame. Track the intended color in a local instead of
round-tripping through the context.

### P2.5 ⬜ `Sprites.getSprite` cache is unbounded

`sprites.ts:15-16` — `getSprite` uses a plain `Map` while `getLayer` right beside
it uses `lruCache(16)`. The real key folds in `size` and `dpr`
(`sprites.ts:48`), so baking at a size derived from an animating value (a pulsing
radius, a zoom-derived size) grows full canvases without bound. Same shape in
`tintCache`'s inner per-color `Map` (`sprites.ts:98-101,126-138`) — the outer
`WeakMap` is correctly keyed on the source, but the color map is unbounded.

**Fix.** Move `getSprite` to `lruCache` with a cap sized for small sprites
(64–128), and bound the tint color map similarly. Document the churn hazard the
way `Particles`' `dotCache` already does (`particles.ts:108-114`).

### P2.6 ⬜ Tile cull under-culls a rotated transform

`tiles.ts:364-387` derives the visible rect from only the top-left and
bottom-right screen corners. Correct for translate+scale, wrong under rotation
(the AABB of a rotated rect needs all four corners). Cheap fix: transform all
four corners and take the min/max. Low priority — nothing in the engine rotates
the camera today — but the code is presented as general.

### P2.7 ⬜ Doc fixes

- `clock.ts:172` — example says `Clock.world.resume()`; the API is `release()`.
- `tiles.ts:388-394` — bake staleness compares the _camera_ scale against
  `baked.scale`, but the bake renders at `min(scale, BAKE_MAX_SCALE)`. Above 2×
  the layer re-bakes on zoom changes that produce identical pixels. Store the
  device scale actually used and compare that.

---

## Priority 3 — API surface

Lower priority than the above; these are ergonomics and consistency, and some
are already registered elsewhere.

### P3.1 ⬜ The scratch-object contract needs an opt-out

"Reused scratch object: read, don't hold" appears on `Contacts`, `Contact`,
`BounceFaces`, `Camera.rect`, `Level.solidsNear` and `FrameTimings`. The sharpest
edge is `collision.ts:300`: `slide()` returns _one module-global_ `Contacts`, so
resolving two bodies in the same step silently makes the first body's contacts
alias the second's.

`Vec2` already solved this with an optional `out` parameter. Extend the same
convention where the aliasing is most likely to bite:

```ts
slide(rect, vel, solids, out?: Contacts): Contacts
moveAndSlide(body, solids, out?: Contacts): Contacts
```

Default path unchanged and still allocation-free; careful callers opt out.

### P3.2 ⬜ Collapse the duplicate collision exports

`index.ts:369-393` exports all ten collision functions **twice** — once loose,
once inside the `Collision` namespace — and then `Minimotor.Collision` a third
time via the default export. Pick the namespace, drop the loose re-exports.
~25 lines of public surface removed for zero capability lost.

Worth a wider pass: `Minimotor` is currently importable as named exports, as a
`Minimotor` namespace object, and as a default export. That's a deliberate
convenience, but it should be a documented choice rather than an accident.

### P3.3 ⬜ `Draw` gaps

There is no way to blit a plain loaded `HTMLImageElement` — `Draw.sprite` needs
a `SpriteLike` and `Draw.sprites` needs an iterable, so the common case drops to
`Draw.ctx`. Add:

- `Draw.image(img, x, y, w?, h?)` — the missing primitive.
- `Draw.rectStroke` / `Draw.circleStroke` — `line` already takes a width, so the
  absence of outlines is an inconsistency.
- `Draw.poly(points, color)` — trivial, and currently everyone hand-rolls
  `beginPath`/`moveTo`/`lineTo`.

Also consider trimming the overload machinery: `Draw.line` (`draw.ts:88-121`) has
6 parameters, 5 casts and a runtime `typeof` branch inside a drawing primitive.

### P3.4 ⬜ Finish retiring `Game.letterbox*`

`game.ts:49-130`. `App.init({ resolution })` does fit, bars, pointer mapping and
transform correctly; `Game.letterbox` / `drawLetterbox` / `letterboxView` do a
manual, weaker subset. It's the one place two APIs disagree about the same
concept. `letterboxView` additionally returns four closures that allocate per
call.

Already registered in `API_PLAN.md:220-222` — blocked only on migrating the
`pocket` sample. **Action: migrate `pocket` to `resolution`, then delete all
three.** Keep `createScoreTracker` and `formatClock`.

---

## Priority 4 — missing features

### P4.1 ⬜ Physics2D — close the real gaps

The adapter is elegant but thin enough that games fall through it within a day.
Ranked by how fast a real game hits them:

1. **Raycast** — `phys.raycast(x1, y1, x2, y2, opts?)`. Line-of-sight, ground
   probes, hitscan weapons, laser sights. planck exposes `world.rayCast`;
   the work is the px↔m conversion and a plain-data result shape.
2. **Sensors / triggers** — expose `isSensor` on `BodyOptions`. Overlap without
   collision (pickups, trigger volumes, checkpoints, water) is currently
   impossible without `body.raw`.
3. **Collision filtering** — `category` / `mask` (and optionally `group`) on
   `BodyOptions`. Any game past one entity type needs layers.
4. **End-contact** — `onContactEnd(cb)`. Today you can detect touch and never
   separation, so "is the player standing on this" needs manual bookkeeping.
   (`API_PLAN.md:227` proposes `onContact` → a pollable `contacts` list, which
   would subsume this — either shape is fine, but pick one.)
5. **World queries** — `phys.queryAABB(rect)` and `phys.pointPick(x, y)`.
   Click-to-select and area effects.
6. **Mouse/drag joint** — dragging a body with the pointer is table stakes for a
   physics sandbox and is fiddly to get right by hand.
7. **More shapes and joints** — polygon, edge/chain (terrain), plus distance /
   prismatic / weld joints. Lower priority; `box`/`circle`/`pin` covers a lot.

Keep the existing style throughout: pixels in, pixels out, plain-data results,
`raw` escape hatch preserved.

Two adjacent cleanups while in here: every `Body2D` setter allocates a
`new Vec2` (`physics2d.ts:203-259`), and `Pin2D.destroy()` doesn't guard
`pw.isLocked()` the way `destroyBody` does (`physics2d.ts:196-200,369-371`).

### P4.2 ⬜ Audio — stereo pan

`Audio` has buses, filters, aux reverb/delay, a master compressor and side-chain
ducking, but no positional or stereo panning. A `pan` option on
`PlayOptions`/`BusHandle` (a `StereoPannerNode`) is the cheap missing piece for
world-positioned sound.

### P4.3 ⬜ Net — reconnect and backoff

`net/room.ts` has no reconnect path: a dropped relay socket ends the room
permanently. Add reconnect with exponential backoff and a `room.onStatus`
channel so games can show "reconnecting…". Binary encoding (currently JSON per
snapshot at 15 Hz — `room.ts:29-30`) is a later, separate optimization.

---

## 7. Goodies/Gizmos — grow the catalog

**Decision: the catalog stays and expands.** The earlier review suggested
trimming genre-specific recipes; that is rejected. `Goodies` (pure recipes) and
`Gizmos` (stateful gadgets) are ready-made legos meant to be reached for in _any_
game or playful app — not extractions justified by one sample. They are a
headline feature, not overhead.

Actions:

- ✅ Rewrite `ROADMAP.md`'s L2 section as a first-class **Goodies & Gizmos**
  catalog: both namespaces documented, the split rule stated, the shipped shelf
  brought in sync with the code, and a large candidate backlog.
- ✅ Scope the Pixel Adventure "extraction rules" so rule 1 governs _engine
  infrastructure_ only, and can no longer be read as the admission bar for
  catalog recipes.
- ⬜ Close the `API_PLAN.md:232` open item ("Gizmos/Goodies taxonomy") — the
  taxonomy is decided: pure → `Goodies`, stateful → `Gizmos`.
- ⬜ Work the candidate backlog in the roadmap. Each new lego ships with
  deterministic unit tests and at least one sample using it.

The one piece of the earlier suggestion worth keeping: `README.md:91-94` files
both namespaces under "Grab bag", which undersells them. Promote them to their
own section describing what they are and how to find one.

---

## Suggested delivery order

Each step is independently shippable and testable.

| #   | Work                           | Items                  | Rough size                      |
| --- | ------------------------------ | ---------------------- | ------------------------------- |
| 1   | Re-init lifecycle fix          | P0.1, P0.2             | small, high value               |
| 2   | `measureText` memo             | P1.1                   | medium, biggest perf win        |
| 3   | Camera correctness             | P2.1, P2.2, P2.3       | small                           |
| 4   | Cheap allocation sweep         | P1.2, P1.3, P1.6, P2.4 | small                           |
| 5   | Cache bounds + doc fixes       | P2.5, P2.7             | small                           |
| 6   | Physics2D gaps                 | P4.1 items 1–4         | medium-large                    |
| 7   | Collision broadphase           | P1.5, P3.1             | medium                          |
| 8   | Draw primitives + surface trim | P3.2, P3.3             | small                           |
| 9   | `Game.letterbox` retirement    | P3.4                   | small, needs `pocket` migration |
| 10  | Catalog growth                 | §7 backlog             | ongoing                         |

Steps 1–5 are all low-risk and together remove every known silent failure plus
the dominant per-frame cost. They are the right first pass.

## Verification gate

Every step must leave these green:

```sh
pnpm verify        # tsc (src + samples) + oxlint + oxfmt --check
pnpm test          # vitest
pnpm test:e2e      # playwright
```

New behavior needs a unit test; the two P0 bugs specifically need regression
tests, since both failed silently with a fully green suite.
