# AGENTS.md

Notes for coding agents working in this repo. Human docs live in `README.md`
and in the long header comments at the top of each module — those are the
source of truth. This file records things that are hard to discover by reading
the code.

## Checking nine-slice and tile frame art

`mm ui` reads the atlas pixels and reports frame defects as numbers. **Use it
instead of screenshotting a themed sample** — a 1px slit where a repeat wraps
is invisible at 1×, and a downscaled screenshot cannot show you which inset is
wrong. This tool names the inset and gives you the corrected value.

```
mm ui nineslice samples/ui-gallery/assets/themes/kenney-pixel-ui/theme.json
mm ui nineslice <atlas.png> --rect 0,0,48,16 --insets 8,4,8,4
mm ui nineslice <theme.ts> --atlas <atlas.png>     # needs pnpm build first
mm ui frame <atlas.png> --grid 0,208,16,16         # a 3×3 of separate tiles
mm ui autotile <atlas.png> --grid …                # infers sockets from the art
mm ui autotile <atlas.png> --grid … --masks … --cols …   # checks a declared layout
```

`autotile` without `--masks` derives the adjacency relation from the pixels —
the step WFC calls adjacency extraction — and reports the socket alphabet, how
dense the relation is, and any tile nothing may be placed beside. It reads
sockets as _exact_ edge equality, so a sheet drawn with detailed rather than
flat edges comes back sparse; it says so and downgrades its own findings when
that happens. None of the ui-gallery atlases are autotile sheets, so `nineslice`
is the tool for those.

Omit `--insets` and it derives them from the art instead of checking them.
`--only <name>` narrows to one frame, `--json` is machine-readable, `--out
<dir>` writes a zoomed source crop with the inset cuts drawn on and a contact
sheet of the frame composed at sizes chosen to expose wrap bugs.

### Reading the output

Each axis prints a **slice strip**: one character per source column (or row),
identical art sharing a letter, with `|` at the inset boundaries.
`ABBCCCCC|CCCC…CCCC|CCCCCBBA` is a frame whose corners are `ABB` and whose
centre is uniform. This one line tells you the period, the insets, and whether
the centre is really repeating — read it before anything else.

The verdict that matters is on the same line: `ok (n whole repeats)` means the
centre band tiles cleanly; `BAD (17 / 4 = 4.25 repeats)` is the slit, and the
finding underneath carries the inset that fixes it.

### What it can and cannot know

It measures three independent things: whether the centre band's own repeat
period divides the band (a phase break — the classic slit), whether the band
wraps onto itself without a seam, and whether the declared insets agree with
where the art actually stops repeating. A frame can pass all three and still be
wrong for reasons no pixel measurement reaches — most often a corner cut from
the wrong place, since a corner is drawn once and so repeats nothing. Findings
are graded: `error` is a defect that will render wrong, `warning` is probably
wrong, `info` is an observation (a generous inset renders fine; it only raises
the frame's minimum size).

One caveat about the engine it models: insets whose sum equals the frame's
width or height leave a zero-width centre band, and `repeatSlice`
(`src/ui/core/theme.ts`) loops forever on one. That is reported as `no-center`.

## Debugging UI layout

The immediate-mode UI has a built-in layout recorder. **Use it instead of
screenshotting the canvas and diffing pixels** — pixel diffing over a running
sample is noisy, slow, and does not tell you _which_ container is wrong. The
recorder names the offending container directly.

### The API

Exported from `createUI(...)`, implemented in `src/ui/core/layout-capture.ts`:

| Call                     | What it gives you                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `UI.layoutCapture(true)` | Start recording. Off by default; while off the cost is one module-level boolean check per placement.                            |
| `UI.layoutTree()`        | The last **completed** frame's entries, in draw order (containers before their children).                                       |
| `UI.layoutIssues()`      | Children that spilled outside the container that placed them — the signature of a container that failed to size to its content. |
| `UI.lastRect()`          | The rect the most recent widget got. Useful for flowing non-UI drawing (e.g. bitmap text) through the layout.                   |

Each `LayoutEntry` carries `kind` (`"row"`, `"col"`, `"panel"`, `"button"`,
`"text"`, …), the optional `id`, `rect` (layout coords), `screenRect` (after
`UI.scaled`), `scale`, `parent` (index into the same array), and the `clips` /
`pinned` flags. `layoutIssues()` stays quiet about the two legitimate ways a
rect leaves its box: a clipping/scrolling container, and a hand-positioned
`x`/`y` rect.

### In a test

```ts
UI.layoutCapture(true);
// ...render one frame...
expect(UI.layoutIssues()).toEqual([]);
const buttons = UI.layoutTree().filter((e) => e.kind === "button");
```

### Chasing a one-frame layout pop in a browser sample

Log the tree from inside the draw callback (not from `addInitScript` — a rAF
hook installed there runs _before_ the module executes and reports the bare
canvas), then compare consecutive frames:

```ts
UI.layoutCapture(true);
Loop.draw(() => {
  // ...build the UI...
  console.log("TREE", JSON.stringify(UI.layoutTree().filter((e) => e.kind === "text")));
});
```

Filter to leaf widgets. Container boxes converge harmlessly on their own and
over-report if you diff the whole tree. Use a **fresh browser context per
page** — navigating within one tab carries cached sizes across and contaminates
the measurement.

### The three causes a pop almost always has

1. **Auto-sizing is one frame behind, by design.** `UI.row`/`UI.col` without an
   explicit size resolve their rect from `cachedContentSize(key)` — _last_
   frame's measurement. An unmeasured container reports a default height of
   `30`. Convergence costs one frame **per nesting level**, so a deep tree
   settles slowly. Flattening the tree is the fix; explicit sizes only hide it.

2. **Without an explicit `id`, the container's cache key is its structural
   position.** `containerKey` (`src/ui/core/flow.ts`) falls back to
   `` `${parent.key}>${kind}#${parent.children++}` ``. Two screens that build
   the same shape at the same position **share one cache entry**, so switching
   between them hands the incoming screen the outgoing screen's size. Wrap each
   screen in `UI.idScope("screen-name", …)` to give it its own namespace.

3. **A stale container size is only visible to siblings placed _after_ it.**
   Layout positions are assigned in order, so a container that is 288px too
   short shifts everything following it and nothing before it. This is why a
   pop can disappear on one page and persist on another with the same structure
   — the difference is whether anything trails the auto container. Moving the
   trailing element is often the whole fix.

Worked example: `samples/fonts/fonts.ts`, whose five tabbed pages hit all three
at once.

### Unrelated: the pre-script canvas pop

`createApp({ fullscreen: true })` injects its stylesheet and sizes the canvas
from JS, so between first paint and module execution a bare `<canvas>` sits at
its default 300×150 and then jumps. That is not a layout bug and
`layoutTree()` will not show it. Fix it per-sample by mirroring the end state
statically in the HTML — see `samples/fonts/index.html`.
