// ---------- MAP-Elites ----------
// The practical way to AIM a generator. Ordinary search returns one best level;
// MAP-Elites returns a GRID of them, one per combination of behaviours you care
// about — "short and twisty", "long and open", "long and twisty" — each the
// best level found with that character.
//
// That is usually what a designer actually wants. A single "best" level is one
// opinion about a weighted sum; an archive is a menu, and it tells you which
// combinations your generator cannot reach at all (empty cells) — which is
// often the more useful finding.
//
// It needs no gradients and no differentiability: any `(level) => number` will
// do, including ones with hard cliffs like reachability. That is why it is the
// first thing to reach for, and `steer` the second.

import { type Rng, createRng } from "@src/rng/index.js";

/** One archived candidate: the best found so far for its behaviour cell. */
export interface Elite<T> {
  /** The candidate itself — normally a `CharGrid`. */
  candidate: T;
  /** Its fitness. Higher is better. */
  fitness: number;
  /** Its measured behaviour, each in [0, 1]. */
  measures: number[];
  /** Which archive cell it occupies, one index per measure. */
  cell: number[];
}

export interface Archive<T> {
  /** Every occupied cell, best fitness first. */
  elites: Array<Elite<T>>;
  /** The single fittest candidate found, or null if nothing was accepted. */
  best: Elite<T> | null;
  /** Occupied cells as a fraction of the archive — how much of the behaviour
   *  space this generator can actually reach. */
  coverage: number;
  /** Archive resolution per measure. */
  resolution: number[];
  /** The elite at a behaviour cell, or null when that cell is empty. */
  at(...cell: number[]): Elite<T> | null;
  /** Candidates evaluated to build this archive. */
  evaluated: number;
}

export interface IlluminateOptions<T> {
  /** Build a fresh random candidate. Called for the first `initial` rounds and
   *  whenever there is nothing to mutate yet. */
  create(rng: Rng): T;
  /** Vary an existing elite. Omit to search purely by fresh candidates, which
   *  is slower to converge but perfectly valid. */
  mutate?(parent: T, rng: Rng): T;
  /** Higher is better. Return `-Infinity` to reject a candidate outright. */
  fitness(candidate: T): number;
  /** One function per archive axis, each returning a value in [0, 1]. Values
   *  outside that range are clamped. Two or three axes is the sweet spot. */
  measures: ReadonlyArray<(candidate: T) => number>;
  /** Buckets per axis — a number for all, or one per axis. Default 8. */
  resolution?: number | readonly number[];
  /** Candidates to evaluate. Default 200. */
  iterations?: number;
  /** Fresh random candidates before mutation begins. Default a quarter of
   *  `iterations`, minimum 1. */
  initial?: number;
  /** Seed. The same seed gives the same archive. */
  seed?: number;
}

/** Search a behaviour space and keep the best candidate in each region of it.
 *
 *      const archive = Procgen.illuminate({
 *        create: (rng) => Procgen.repair(Procgen.caves({ cols: 48, rows: 32, seed: rng.seed })),
 *        mutate: (parent, rng) => Procgen.resynthesize(parent, model, { ... }),
 *        fitness: (grid) => Procgen.longestPath(grid),
 *        measures: [
 *          (grid) => Procgen.openness(grid),
 *          (grid) => Procgen.corridorRatio(grid),
 *        ],
 *        iterations: 300,
 *      });
 *      const twistyAndOpen = archive.at(6, 6);
 */
export function illuminate<T>(options: IlluminateOptions<T>): Archive<T> {
  const axes = options.measures.length;
  if (axes === 0) throw new Error("Procgen.illuminate: at least one measure is required");
  const resolution = Array.from({ length: axes }, (_, i) =>
    typeof options.resolution === "number" ? options.resolution : (options.resolution?.[i] ?? 8),
  );
  for (const buckets of resolution) {
    if (!Number.isInteger(buckets) || buckets < 1) {
      throw new Error("Procgen.illuminate: resolution must be positive integers");
    }
  }
  const iterations = options.iterations ?? 200;
  const initial = Math.max(1, options.initial ?? Math.ceil(iterations / 4));
  const rng = createRng(options.seed ?? 0);

  const archive = new Map<string, Elite<T>>();
  // Parallel list of occupied keys so a parent can be drawn in O(1) without
  // materialising the map's iterator every round.
  const occupied: string[] = [];

  for (let round = 0; round < iterations; round++) {
    const parentKey =
      options.mutate && round >= initial && occupied.length > 0
        ? occupied[rng.integer(0, occupied.length - 1)]
        : null;
    const candidate =
      parentKey === null
        ? options.create(rng)
        : (options.mutate as (parent: T, rng: Rng) => T)(
            (archive.get(parentKey) as Elite<T>).candidate,
            rng,
          );

    const fitness = options.fitness(candidate);
    if (!Number.isFinite(fitness)) continue;

    const measures: number[] = [];
    const cell: number[] = [];
    for (let i = 0; i < axes; i++) {
      const raw = options.measures[i](candidate);
      const value = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      measures.push(value);
      // The top of the range belongs to the last bucket, not a bucket past it.
      cell.push(Math.min(resolution[i] - 1, Math.floor(value * resolution[i])));
    }

    const key = cell.join(",");
    const held = archive.get(key);
    if (held && held.fitness >= fitness) continue;
    if (!held) occupied.push(key);
    archive.set(key, { candidate, fitness, measures, cell });
  }

  const elites = [...archive.values()].sort(
    (a, b) => b.fitness - a.fitness || a.cell.join(",").localeCompare(b.cell.join(",")),
  );
  const total = resolution.reduce((product, buckets) => product * buckets, 1);
  return {
    elites,
    best: elites[0] ?? null,
    coverage: archive.size / total,
    resolution,
    evaluated: iterations,
    at(...cell: number[]) {
      return archive.get(cell.join(",")) ?? null;
    },
  };
}
