# API Lab Level Design Plan

Status: design brief; implement in phases, not as ad-hoc edits to `main.ts`.

## Purpose

API Lab is a multiplayer Minimotor showcase, not a long campaign. Its level
should make the engine's features obvious, give several players room to move,
and remain enjoyable indefinitely without a finish state.

The target is one compact, memorable place with reconnecting routes. It should
feel like a sunny island settlement above a small cave network—not a horizontal
catalogue of test fixtures.

## Research distilled

These are the principles this plan applies:

- Start with the character's movement and build the level around it. Yacht Club
  found that changing a character's mobility required drastically different
  spaces; mechanics and layout cannot be designed independently.
- Teach in a safe setup, develop the idea, combine or twist it once, then give
  the player a rest. Early challenges should let players learn without harsh
  failure.
- Design at three scales: individual jump, room/zone, and whole-level route.
  Celeste's designers describe repeatedly moving between those scales and
  cutting or repurposing material to preserve pacing.
- Block out and playtest before decorating. Landmarks, silhouettes, palette,
  and props should reinforce an already-readable route.
- Show a destination or landmark, briefly obscure it, then reveal it again from
  a new angle. This creates direction and a sense of progress without arrows.
- Pixel backgrounds are authored layers. Distant layers move less than nearby
  ones; Shovel Knight commonly used five or six layers, partly to make the
  gameplay layer easier to read.
- A texture may repeat only when its edges were made to repeat and its repeat
  dimensions are known. A flattened scenic illustration is not a tile.
- Pixel art needs a stable logical resolution, nearest-neighbor sampling, and
  preferably integer display scaling. Arbitrary image scaling creates uneven
  pixels even when smoothing is disabled.

Sources:

- [Designing Celeste — GDC Vault](https://www.gdcvault.com/play/1024307/Level-Design-Workshop-Designing-Celeste)
- [Specter of Torment level-design deep dive — Yacht Club Games](https://old.yachtclubgames.com/2020/01/specter-of-torment-level-design-deep-dive-15/)
- [Breaking the NES — Yacht Club Games](https://www.yachtclubgames.com/blog/breaking-the-nes/)
- [Level Design Tips and Tricks — Game Developer](https://www.gamedeveloper.com/design/level-design-tips-and-tricks)
- [8 Tips & Techniques for Designing Levels — Game Developer](https://www.gamedeveloper.com/design/8-tips-techniques-for-designing-levels)
- [New Super Mario Bros. Wii: planning 1-1 — Nintendo](https://iwataasks.nintendo.com/interviews/wii/nsmb/1/4/)
- [2D parallax and seamless repeat — Godot documentation](https://docs.godotengine.org/en/4.5/tutorials/2d/2d_parallax.html)
- [Crisp pixel art — MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look)

## What is wrong with the current level

The current 104×27 map repeats ladders, shelves, gems, and pits at roughly even
intervals. It demonstrates that each primitive exists, but it has no hierarchy:
no clear route, teaching sequence, focal point, quiet space, or memorable
region. The long surface and three rectangular caves also make multiplayer
players spread out without naturally meeting again.

The background has a separate structural problem. `sunnyland-background.png`
is one flattened 384×240 composition. It is currently stretched to the camera
rectangle, changing its aspect ratio, and made to cover every world location.
It was not authored as a horizontally repeating strip or as independent
parallax layers. No amount of overlap, pixel rounding, or tile padding can turn
that source image into a correct endless background.

The Sunny Land `preview.png` succeeds because it is an authored scene:

- large, connected terrain masses establish the playable silhouette;
- sky, sea, terrain, and caves occupy intentional bands;
- slopes and pits are occasional events rather than a constant texture;
- houses and trees act as landmarks;
- props are sparse and grouped;
- underground rooms use their own dark visual field.

Use the preview as an art-direction reference, not as a level to trace.

## Design pillars

1. **Readable in one glance.** Gameplay surfaces have the strongest contrast.
   Scenery never disguises collision.
2. **Teach by doing.** Every featured mechanic gets a safe introduction before
   it appears in a combined challenge.
3. **Built for a group.** Routes split and reconnect. Regroup spaces fit four
   players. No required route is a single-file ladder.
4. **A place, not a test track.** Each zone has one purpose, one landmark, and
   one visual rhythm.
5. **Terse sample code.** The level remains semantic ASCII data plus a small
   skin/scenery description. Presentation fixes do not modify collision data.
6. **No ending required.** The route loops back to the commons; gems respawn
   and players can keep exploring.

## Locked movement metrics

Measure these again if physics constants change. Do not art-pass the level
while they are unstable.

| Metric                       |        Current value | Design use                     |
| ---------------------------- | -------------------: | ------------------------------ |
| Tile                         |       32×32 world px | Layout grid                    |
| Player collider              |       22×28 world px | Clearance and ledges           |
| Run speed                    | 3 px/step (180 px/s) | Traversal timing               |
| Jump velocity                |          -10 px/step | Jump envelope                  |
| Gravity                      |         0.5 px/step² | Jump envelope                  |
| Approximate apex             |      3 tiles, 0.33 s | Maximum rise, not routine rise |
| Approximate full-jump travel |        under 4 tiles | Maximum gap, not routine gap   |
| Comfortable gap              |            1–2 tiles | Tutorials and main route       |
| Advanced gap                 |              3 tiles | Optional route only            |
| Comfortable rise             |            1–2 tiles | Main route                     |

Variable jump, coyote time, wall jump, player collision, and network conditions
make the theoretical maximum a poor baseline. Graybox tests decide the final
numbers.

## Proposed world: Sunny Loop

Target size: approximately 72×28 tiles. Use a loop with a lower return route,
not a 100-tile straight line.

```text
                         optional canopy route
                    +-----------------------------+
                    |                             |
[1 Commons] -> [2 Orchard Steps] -> [3 Hill Homes] -> [4 Old Well]
     ^                                                       |
     |                                                       v
     +---- [7 Return Grotto] <- [6 Crystal Gallery] <- [5 Caves]
```

The main direction is visually clear, but nothing displays “level complete.”
After the return grotto, players emerge into the commons and may run the loop
again, take the canopy route, meet other players, or collect respawned gems.

### Zone beats

| Zone               | Gameplay purpose                                    | Composition                                                            | Multiplayer purpose                                                |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Commons         | Safe spawn; run and low jump                        | Broad grass terrace, sign, one large tree; first destination visible   | Four spawn slots, room to jump on players, natural meeting point   |
| 2. Orchard Steps   | Introduce one-way platforms and drop-through        | Three wide shelves in a staircase; gems trace the intended arc         | Shelves are wide enough to pass; upper and ground routes reconnect |
| 3. Hill Homes      | Introduce slopes                                    | One continuous hill with houses grounded on flat terraces              | Large rest space; landmark visible from both approaches            |
| 4. Old Well        | Introduce ladder auto-grab and sideways exit        | Short safe ladder beside a walkable return ramp, then a deeper descent | Ladder is never the only route; players can wait beside it         |
| 5. Caves           | Develop ladders and wall movement                   | Two compact chambers with a visible exit and safe floors               | Parallel vertical routes prevent blocking                          |
| 6. Crystal Gallery | Combine jump, slope, ladder, and player interaction | Broad cavern with clustered gems and one optional high cache           | Central regroup arena; shared pickup effects are easy to observe   |
| 7. Return Grotto   | Cooldown and surface return                         | Gentle climb, waterfall/sky reveal, short ladder or slope              | Slow players rejoin the group before the commons                   |
| Canopy route       | Optional wall-jump challenge                        | Tree platforms above zones 2–3, always over safe ground                | Faster route and a place to see off-screen labels work             |

### Beat grammar

For each mechanic:

1. **Show:** the next surface and landing are visible before commitment.
2. **Teach:** failure lands on safe ground.
3. **Develop:** repeat with one changed dimension.
4. **Combine:** use it once with a previously learned mechanic.
5. **Rest:** provide at least half a screen of uncomplicated movement.

Gems are breadcrumbs and optional rewards, not completion counters. Use small
clusters to describe a jump arc, mark a route split, or reward an optional
challenge. Avoid evenly spacing them across every platform.

## Collision and visual grammar

- Collision is authored only by the semantic level grid. Decorative sprites
  never create or correct collision.
- A slope marker produces its collision shape and matching tile art from the
  same tile-space definition. Never hand-offset one independently.
- Every ladder is a continuous grid-aligned run. Its top uses one explicit cap
  tile; its art is never scaled or overlapped to hide seams.
- One-way platforms have a unique thin silhouette. Solid ground is visually
  thick. A player should know the rule without trying it.
- Buildings and trees sit on flat terraces. Their visible base touches the
  collision surface exactly and does not conceal a ledge or slope.
- Keep at least one player-width of clear visual space around important landing
  edges.
- Foreground gameplay tiles use the highest contrast and saturation. Distant
  art uses fewer values, lower contrast, and less detail.
- One large landmark per zone; group small props in twos or threes, then leave
  negative space.
- Avoid blind jumps, collision-only floors, decorative false platforms, and
  black void visible below the art.

## Background system

### Fundamental rule

Do not repeat or stretch `sunnyland-background.png`. Retire it from in-game
world rendering. It may remain as a reference or be used in a fixed-aspect
intro panel.

Build four purpose-made visual layers:

1. **Sky field:** a flat palette or vertical bands drawn to fill the camera.
   It never repeats and can never expose darkness.
2. **Far clouds/islands:** a genuinely seamless horizontal strip, at least 512
   source pixels wide, moving at roughly 5–10% of camera motion.
3. **Sea/horizon:** a seamless strip with a fixed world-height horizon, moving
   at roughly 15–25%. Its upper and lower edges end in flat colors that can
   extend indefinitely.
4. **Near silhouettes:** sparse trees, rocks, or cave shapes moving at roughly
   40–60%, kept away from playable edges.

The cave gets a separate set:

- a solid cave base color that fills all exposed space;
- one seamless low-contrast rock texture layer;
- sparse authored silhouettes around chambers;
- a short transition at the well and return opening.

The surface background should not remain visible beneath the cave, and the cave
should never depend on a large black rectangle.

### Asset contract

Create explicit assets rather than draw-time seam patches:

```text
samples/api-lab/assets/background/
  clouds-loop.png       # seamless on left/right edge
  ocean-loop.png        # seamless on left/right edge
  distant-trees-loop.png
  cave-rock-loop.png
```

Each file records its native size and repeat axis in a small data declaration.
Every repeating edge must match in the source pixels. If it does not match in
an image editor, it is not a repeating asset.

Use `Camera.layer(factor, draw)` for motion. A small sample-local
`drawBackground()` may compose the layers; it must not know about collision,
ladders, slopes, or per-tile seam workarounds.

### Camera and pixel rules

- Choose one logical camera height (recommendation: 216 world px) and derive
  width from the viewport aspect ratio.
- Preserve source aspect ratios. Crop deliberately where necessary; never
  stretch art independently on X and Y.
- Keep nearest-neighbor sampling enabled through the central raster path.
- Snap the camera transform and repeated layer origins in logical pixel space.
- Prefer integer presentation scale. When the physical viewport cannot fit an
  integer scale exactly, use a documented crop/letterbox policy instead of
  silently distorting pixels.
- The base fill must cover the entire camera at every supported aspect ratio,
  camera position, shake offset, and device-pixel ratio.

## Implementation phases

### Phase 1 — lock feel and graybox

- Move the ASCII level into a named `LEVEL` constant in the same sample file.
- Add a temporary jump-envelope gizmo or test fixture.
- Build only zones 1–3 in plain collision colors.
- Test with keyboard and gamepad, then with two players.
- Adjust geometry, not physics, unless the movement itself is demonstrably
  wrong.

Exit gate: a new player reaches Hill Homes without explanation, and all common
jumps have comfortable margin.

### Phase 2 — complete the loop

- Add zones 4–7 and the optional canopy route.
- Place spawn markers, gem markers, and scenery anchors semantically.
- Ensure every region has two-way traversal and a visible way out.
- Add a respawn/checkpoint policy if returning to the original spawn makes a
  fall take more than ten seconds to recover from.

Exit gate: one solo traversal and a two-player traversal both complete without
debug movement or getting stuck.

### Phase 3 — author background assets

- Recreate the Sunny Land mood as separate layers using its palette and
  `preview.png` as reference.
- Verify seamless strips in an image editor before importing them.
- Implement the sky and cave base fills first, then one layer at a time.
- Delete the old stretched-background path and any local overlap/padding hacks
  made solely to conceal seams.

Exit gate: every test screenshot is fully covered with no aspect distortion,
black void, or visible repeat boundary.

### Phase 4 — terrain and scenery art pass

- Skin the accepted graybox without moving collision.
- Ground props from their visible opaque bounds.
- Use landmarks and prop clusters from the zone table.
- Do a readability pass in grayscale and at 50% display size.

Exit gate: testers can distinguish solid ground, one-way platforms, slopes, and
ladders without instructions.

### Phase 5 — multiplayer polish

- Validate four spawn slots and four-player space in each regroup area.
- Confirm player collision cannot permanently block ladders or narrow exits.
- Place shared gem clusters where multiple clients can see prediction,
  validation, pickup effects, and respawn.
- Test death, slow motion, sound, remote animation, labels, and reconnects in
  both surface and cave zones.

Exit gate: two clients can loop for five minutes without diverging state,
missing effects, or trapping one another.

## Automated and visual checks

Add tests that validate design invariants rather than compensating in drawing:

- all rows have equal width and every marker is recognized;
- player spawns have solid support and safe clearance;
- ladders are continuous, grid-aligned, and have valid tops/bottoms;
- slope art source, world rectangle, and collision rectangle share one
  definition;
- solid and one-way tiles do not occupy the same cell;
- a coarse reachability graph connects every main-zone anchor;
- main-route gaps and rises remain within the locked movement envelope;
- scenery anchors do not overlap required landing edges;
- repeating assets have matching opposite edge pixels;
- raster destination rectangles resolve consistently after camera transforms.

Capture screenshot baselines at minimum:

- 800×450, 1280×720, and 2048×1229;
- device-pixel ratio 1 and 2;
- Commons, Hill Homes, surface/cave transition, Crystal Gallery;
- camera at rest and during death shake.

The screenshot review checks coverage, seams, aspect ratio, collision/art
alignment, visual hierarchy, and HUD overlap. A passing unit test alone is not
visual approval.

## Playtest questions

Ask observers; do not teach them first:

1. Where do you think you should go?
2. What surfaces can you stand on or pass through?
3. What did the gems lead you toward?
4. Where did you first understand slopes, ladders, and drop-through?
5. Did another player block you or disappear for too long?
6. Which place do you remember after closing the game?

Record confusion by zone and beat. Fix the earliest cause, then retest from a
fresh start.

## Definition of done

- The world reads as one coherent island and cave loop.
- Every core mechanic has a safe introduction and one meaningful combination.
- The level is fully traversable solo and comfortable with four players.
- The route loops indefinitely and has no clear/goal state.
- No required landing is blind.
- No scenery contradicts collision.
- No background is stretched to a different aspect ratio.
- Only source-authored seamless assets repeat.
- No supported viewport exposes unpainted or black space.
- Pixel density and tile edges remain stable while the camera moves.
- The API Lab level data and background composition stay short enough to teach
  from; complexity belongs in reusable Minimotor APIs, not sample patches.
