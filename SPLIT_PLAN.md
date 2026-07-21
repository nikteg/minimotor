# Split large `src/` modules into folder-per-module structures

## Context

`src/` is 28 files / ~10k lines, but a handful of modules have grown into
hard-to-navigate monoliths — `ui.ts` alone is **3044 lines** (a third of the
engine), followed by `audio.ts` (874), `engine.ts` (753), `net.ts` (622),
`ecs.ts` (590), `perf.ts` (386). A precedent for the fix already exists: a
prior pass split `goodies.ts` into `src/goodies/` — a folder of cohesive
"family" sub-files plus a pure barrel `index.ts` (`export * from "./sub.js"`),
with tests co-located in `goodies/__tests__/`. This plan applies that same
pattern to the remaining large modules so each concern lives in its own file
while the public surface (`build/index.js`, the `Minimotor` namespace, and the
separate `minimotor/physics2d` entry) stays byte-for-byte identical.

**Scope (confirmed with user):** split all large files — `ui`, `audio`,
`engine`, `net`, `ecs`, `perf`. **Leave `physics2d.ts` as a single file** (it's
a separate npm entry point; splitting it would mean touching `package.json`
`exports` + the vite alias — not worth it). `anim.ts` (325) / `tiles.ts` (346)
stay single for now — below the pain threshold.

## Pattern (mirror `src/goodies/`)

For each module `X.ts` → `src/X/`:

1. Create `src/X/` with one sub-file per cohesive section group. Each sub-file
   keeps its original section-header comments and exports the same named
   symbols. **No symbol renames, no signature changes.**
2. `src/X/index.ts` is a pure barrel: a top doc-comment + `export * from
   "./sub.js";` lines. If the module currently exports a facade namespace object
   (e.g. the `UI` default facade), assemble it here.
3. All relative imports keep explicit `.js` extensions (`moduleResolution:
   "bundler"`, repo convention).
4. Update `src/index.ts`: change `from "./X.js"` → `from "./X/index.js"`
   (matches how it already imports goodies).
5. Move `src/X.test.ts` → `src/X/__tests__/X.test.ts`, fixing relative imports
   (`./X.js` → `../index.js`, or a concrete `../sub.js`).
6. Delete the old `src/X.ts`.

## Per-module split

### `ui.ts` (3044) — the hard one, do first and carefully
Widgets share many **private** helpers (implicit context, `theme`, widget
identity, stack/layout `place`, `drawBox`, input/focus/overlay state). These
must move into a shared `src/ui/core.ts` and be **exported from `core.ts`** (but
NOT re-exported by the barrel) so widget files can import them. Proposed files:
- `core.ts` — context, theme, widget identity, stack/layout primitives, shared draw/input helpers (the internal glue every widget uses)
- `layout.ts` — row/col/group/spacer/clip, list, grid containers
- `table.ts` — table (large, self-contained)
- `text.ts` — text, text input, floating text (`float`/`drawFloats`), dialogue, tooltip
- `controls.ts` — button, panel, toggle, tabs, list item, slider, spinner, scrollbar, bar, select
- `overlays.ts` — popover, modal, confirm
- `dragdrop.ts` — drag & drop
- `index.ts` — barrel + assemble the default `UI` facade object
Verify the facade object exported today is reconstructed identically.

### `audio.ts` (874, 4 sections)
- `context.ts` (audio context/unlock), `mixer.ts` (`Mixer`: compressor/reverb/bus/duck), `sfx.ts` (`playSfx`, `Sfx` presets), `music.ts` (`Music`) — `index.ts` barrel. Keep the `Audio` facade assembly wherever it currently lives.

### `engine.ts` (753, core + facade)
- `core.ts` (Loop/Stage/Draw/Keys/Pointer primitives) + `facade.ts` (assembled namespaces) or split by subsystem if boundaries are cleaner on read; `index.ts` barrel. Confirm exact boundaries when reading the file.

### `net.ts` (622, 6 sections) — clean section cuts; one sub-file per section group.
### `ecs.ts` (590) — split world / component / query / system / built-in Sprite+renderer along its internal boundaries.
### `perf.ts` (386, 5 sections) — one sub-file per section group; `index.ts` barrel.

## Constraints / gotchas
- **Public surface must not change.** After the split, `npm run build` output and every sample (which consume `build/index.js` via the vite alias) behave identically.
- `.js` extensions mandatory on all relative imports.
- `physics2d.ts`, `anim.ts`, `tiles.ts`, `goodies/` untouched.
- `noEmitOnError: true` — a broken import fails the build loudly, which is the first-line safety net.
- Watch for the 2 test files that were failing to load before (import errors, likely from the goodies restructure) — resolve/confirm those while relocating tests so a green baseline is restored.

## Suggested order
Do the low-risk clean-cut modules first to validate the mechanics, then `ui.ts`:
`perf` → `net` → `audio` → `ecs` → `engine` → `ui`. Build + test after each.

## Verification
- After **each** module: `npm run build` (must stay green — `noEmitOnError`
  catches import breakage) and `npx vitest run src/<module>/__tests__` for that
  module's tests.
- After all: full `npx vitest run` — expect the previously-passing 372 tests
  green and the 2 formerly-failing test files now loading.
- `npm run build` then spot-check that `build/index.js` still exports the same
  `Minimotor` namespace and that `build/physics2d.js` is unchanged.
- Sanity-load a couple of samples' build path (no code change to samples) to
  confirm the public API is intact — but per standing constraint, **no devtools
  browser verification**; rely on build + tests.

---

# Round 2 — status + further split ideas

**Round 1 is done.** `perf`, `net`, `audio`, `ecs`, `engine`, and `ui` are now
folders with barrels; tests moved to `<module>/__tests__/`; the public
`Minimotor.*` surface and the `minimotor/physics2d` entry are unchanged. A new
`minimotor/server` entry (`src/net/server/`) adds Node-side rooms / tick /
signaling. `noUnusedLocals` is on, which now catches dead imports for free.

## ~~New highest-value target: `ui/core.ts` (~1650 lines)~~ — DONE

Split into `context` / `theme` / `stack` / `identity` / `input` / `text` /
`frame` with `core.ts` as a barrel (widget files + `index.ts` untouched). The
focus + overlay + editor + tooltip + float machinery and the frame-welded
`textInput`/`select` stayed together in `frame.ts` (~960 lines) — genuinely one
coupled unit; a further split would need moving `ensureWired`'s per-subsystem
housekeeping behind setters, not worth the risk yet. Original plan follows.

## Original write-up: `ui/core.ts` (~1650 lines)

The `ui` split intentionally parked the whole immediate-mode *kernel* in
`ui/core.ts` — implicit context, theme, draw helpers, layout primitives, shared
input, the focus system, the overlay/editor/tooltip/float frame-machinery, and
the two frame-welded widgets (`textInput`, `select`). It's now the single
largest file in the repo. A second-level split, all **within `src/ui/`**:

- `context.ts` — begin / uiCtx / withCtx / textWidth
- `theme.ts` — Theme / defaultTheme / setTheme / getTheme / uiFont + draw
  helpers (roundRectPath / drawBox / centeredText)
- `stack.ts` — the stack/layout primitives (`stack`, `place`, `runContainer`,
  `containerRect`, `layoutArgs`, `currentLayout`) used by `layout.ts`
- `identity.ts` — ids / idScope / widgetId
- `input.ts` — DEAD_POINTER / rawPointer / uiPointer / buttonState / hoverCursor
- `focus.ts` — the focus registry + keyboard wiring (state + all focus fns)
- `frame.ts` — overlay flags, tooltip, floats, spinAngle, `ensureWired`,
  `_reset`, and the editor/select-overlay machinery + `textInput`/`select`
- `text.ts` — the `text()` renderer (+ resolveColor / wrapLines)

Gotcha: the kernel state is mutated across these files (overlay flags, focus,
editors). Keep each piece of mutable state in ONE file and expose setters
(`enterOverlay`, `setActiveDrag` already model this) — ESM can't reassign an
imported binding. `frame.ts`↔`text.ts`↔widget files will have call-time
cycles; that's fine (functions are hoisted). The `index.ts` curated re-export
list stays as-is; internal helpers keep flowing between files via direct
`./x.js` imports, not the barrel.

## Sample games (a different axis)

The demos have outgrown single files too: `road-rivals/src/client/main.js`
(~1350), `ascent` (~1090), `solitaire` (~840). These aren't engine modules but
would read far better split by concern (input / simulate / render / entities /
hud). Lower priority — they're showcase code, not shipped API — but a good
"dogfood the primitives" exercise (e.g. road-rivals could lean on the new
`minimotor/server` room helpers, `Camera`, `Particles.burst`).

## Below the threshold (leave for now)

`physics2d.ts` (~434, separate entry — internal-only split possible but not
worth touching `package.json`/alias), `tiles.ts` (~346), `anim.ts` (~325),
`sprites.ts`/`camera.ts`/`input.ts`/`particles.ts` (~210-240). Revisit any that
cross ~400 lines.

## More server primitives to add (`src/net/server/`)

- ~~`presence`~~ (DONE — createPresence) — a server-side player-state registry with `touch(id, state)` +
  stale-prune (the `roadPlayers` Map + `seenAt` pattern road-rivals still
  hand-rolls), mirroring the client `Net.createRoster`.
- `rooms`/matchmaking — multiple named rooms on one server, join-by-code.

## Lessons from round 1 (fold into the mechanics)

- Rewrite **dynamic `import("./x.js")` and `vi.doMock("./x.js")`** specifiers in
  tests too, not just `from "…"` — missed ones fail to load silently (scenes,
  audio, engine tests each bit us once).
- Commit with `git add -A src` (not a narrow pathspec): `git mv`/`git rm` span
  two directories, so a narrow pathspec leaves the old-location deletion
  uncommitted (perf/net left stale monoliths in-tree one commit).
- Curate the barrel only for modules consumed via `import * as X` in
  `index.ts` (perf/net/audio/ecs/ui). `engine` is consumed via *named* imports,
  so its barrel can `export *` freely — the surface is controlled at index.ts.
- Node-only code (`net/server`) stays out of the browser bundle by using
  **structural** socket types (no `ws`/Node import) + a separate entry point.
