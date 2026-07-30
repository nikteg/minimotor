# Procedural Platformer Levels

`mm level generate` is a seeded greybox generator. Its JSON output is the same
neutral level-spec format used by API Lab's hand-authored design, so either
source can enter the build pipeline.

API Lab uses the same CLI pipeline for its production asset:

```text
tools/api-lab-levels.mjs (design + Sunny Land skin)
        │
        ▼
mm level build
        │
        ▼
assets/api-lab.ldtk
        │
        ├── mm level check
        └── loaded by main.ts at runtime
```

`pnpm api-lab:levels` rebuilds the LDtk artifact. `pnpm
verify:level-design` checks both that it is up to date and that all configured
movement, reachability, tileset, ladder, and portal constraints pass.

```sh
mm level generate --seed sunny-loop
mm level generate --seed cave-loop --layout tunnel
mm level generate --seed expedition --layout mixed
mm level generate --seed sunny-loop --trace
mm level generate --seed sunny-loop --difficulty 0.7 --json -o level.json
mm level build level.json \
  --skin tools/api-lab-levels.mjs \
  --template samples/api-lab/assets/api-lab.ldtk \
  -o generated.ldtk
mm level check generated.ldtk
mm level check generated.ldtk --verbose
```

Optional generator features are `gaps`, `platforms`, `ladders`, `gems`,
`tunnels`, and `exit`. Solids and the player spawn are always generated.
`--layout varied` (the default) chooses between `surface`, `tunnel`, and
`mixed` from the seed. Tunnel and mixed layouts carve corridors and expanded
chambers through solid terrain; use `--layout surface` or `--without tunnels`
when a game should stay above ground.

```sh
# Keep the default set, except climbing and collectibles.
mm level generate --without ladders --without gems --trace

# Exact allow-list: terrain, player, gaps, and an exit.
mm level generate --features gaps,exit --json -o simple-level.json

# Bare terrain and a player.
mm level generate \
  --without gaps --without platforms --without ladders \
  --without gems --without exit
```

Use either `--features` or `--without`, not both. Ladders and the current gem
breadcrumb pass require platforms; the CLI reports that dependency instead of
silently producing unreachable content.

## Scoring and AI search

Inspect one candidate's raw metrics and normalized score components:

```sh
mm level score --seed candidate --profile balanced
mm level score --seed candidate --profile flow
mm level score --seed candidate --profile exploration
```

The current metric vector contains gap ratio, event density, vertical range,
column-pattern variety, rhythm entropy, reward coverage, enclosure ratio, and
room count. The score also includes hard validity and spatial-composition
components. Every value remains visible in the output; the aggregate is a
search proxy, not a hidden claim that a level is fun.

Run search-based procedural generation with a small quality-diversity archive:

```sh
mm level optimize \
  --seed experiment-1 \
  --count 500 \
  --profile exploration \
  --top 10 \
  -o best-level.json \
  --dataset candidates.jsonl
```

The optimizer evaluates seeded candidates across the difficulty range. It keeps
the best candidate in each verticality/event-density behavior bin, prints the
elites, writes the overall winner as a buildable neutral spec, and optionally
exports every metric vector as JSONL.

## Automated bot playtesting

Run generated candidates through the same deterministic movement simulation
used by `mm level test`:

```sh
mm level simulate \
  --seed bot-experiment \
  --levels 20 \
  --rounds 4 \
  --bots 12 \
  --attempts 4 \
  --max-steps 1500 \
  --without ladders \
  --double-jump \
  -o best-bot-tested.json \
  --report ranked-report.json \
  --replay completion-proof.json \
  --dataset bot-results.jsonl
```

Each round generates `--levels` candidates. If the population succeeds too
often, the following round raises generator difficulty; broad failure lowers
it. This makes `--rounds` a real `generate → play → score → adapt` loop.

For each candidate, a beam-search planner first tries to produce a concrete
input sequence that reaches the exit. Expert, intermediate, beginner, and
completionist personas then replay that proof with different deterministic
reaction delays and input errors. `--bots X --attempts Y` therefore produces
`X × Y` episodes per candidate.

`--report` preserves the complete ranking and `--replay` preserves the winning
planner's compact input commands and final simulation stats. The replay is a
reproducible proof of why the candidate passed, not just a boolean assertion.

The report includes:

- planner solvability and search expansions;
- success rates per persona;
- completion time and deaths;
- mean progress and stuck rate;
- gem coverage and path diversity;
- input complexity;
- observed dash, double-jump, and wall-jump usage.

A candidate passes only when the planner and every expert replay finish and the
population is not broadly stuck. Ranking targets a useful success-rate band
instead of blindly maximizing completion, then combines that behavioral score
with the existing interpretable heuristic score. Bot results are feasibility
and difficulty evidence—not a replacement for human ratings. Keep unseen seeds
and human-rated levels as a holdout set to detect bot-specific overfitting.

## Training a preference model

Each JSONL row contains `rating: null`. Replace it with a normalized `0..1`
rating obtained from:

- a human pairwise/rating interface;
- completion, death, retry, and abandonment telemetry;
- one or more game-playing agents representing different skill levels.

Then train and use the model:

```sh
mm level train candidates-rated.jsonl -o preference-model.json

mm level score \
  --seed unseen-candidate \
  --model preference-model.json

mm level optimize \
  --seed learned-search \
  --count 1000 \
  --model preference-model.json \
  -o learned-best.json
```

The first model is deliberately small and inspectable: standardized ridge
regression over the metric vector. It is real supervised learning and provides
a useful baseline before introducing neural models. Keep a held-out set of
human ratings, compare predicted and actual preference there, and never train
and report accuracy on the same rows.

The passes are deliberately visible:

1. `terrain` creates slowly varying regions from a deterministic seed;
2. `route` carves conservative one- or two-tile gaps;
3. `traversal` places optional platforms and ladders;
4. `rewards` adds a spawn, exit, and gem breadcrumbs;
5. validation rejects output outside the movement envelope.

This is a starting point for a Spelunky-like hybrid generator. The next useful
step is a library of hand-authored beat templates (safe ladder lesson, wall-jump
pocket, route split, regroup room). A graph generator should arrange those
beats first; a geometry pass can then fit them to the grid, followed by the
existing validator and tileset pass.

## Why this shape

- Minecraft documents world generation as seeded passes: base terrain, biomes,
  structures, and features. Separating passes keeps each responsibility
  inspectable.
- Compton and Mateas model platformer generation as a hierarchy that preserves
  rhythm and connectivity rather than treating a level as undifferentiated
  noise.
- Rhythm-based platformer generation creates an intended input rhythm first,
  then selects geometry under designer-controlled style constraints.
- Constraint-based PCG treats hard playability rules separately from softer
  design preferences. That maps well to `generate → validate → retry`.
- Spelunky-style systems combine a guaranteed route graph with authored room
  motifs and local random variation.

Sources:

- [Minecraft world generation overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/world-generation)
- [Procedural Level Design for Platform Games](https://doi.org/10.1609/aiide.v2i1.18755)
- [Rhythm-Based Level Generation for 2D Platformers](https://users.soe.ucsc.edu/~ejw/papers/smith-grids.pdf)
- [Procedural Constraint-based Generation for Game Development](https://researchportal.bath.ac.uk/en/studentTheses/procedural-constraint-based-generation-for-game-development/)
- [A Procedural Method for Automatic Generation of Spelunky Levels](https://mohammadshaker.com/wp-content/uploads/2016/09/2015evo-splky.pdf)
