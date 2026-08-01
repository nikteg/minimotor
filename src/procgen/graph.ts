// ---------- Layout topology ----------
// A room layout is a graph, and most of what makes a level feel designed is a
// property of that graph rather than of its tiles: which room is the far end,
// what route joins the two ends, what hangs off that route as a side branch.
//
// Those questions have nothing to do with any particular game, so they are
// answered here, over plain indices and index pairs. Nothing in this file
// touches a grid, a glyph or a rule — feed it `rooms().links` and it tells you
// the SHAPE. What that shape then means is a recipe's business; see
// `./recipes/dungeon` for one that reads a locked-door progression out of it.

/** Adjacency lists for `count` nodes joined by undirected index pairs. */
export function adjacencyOf(
  count: number,
  links: ReadonlyArray<readonly [number, number]>,
): number[][] {
  const adjacency: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of links) {
    if (!adjacency[a].includes(b)) adjacency[a].push(b);
    if (!adjacency[b].includes(a)) adjacency[b].push(a);
  }
  return adjacency;
}

/** BFS from `from`; returns each node's predecessor and depth (-1 if
 *  unreachable). */
export function bfs(
  adjacency: readonly number[][],
  from: number,
): { prev: number[]; depth: number[] } {
  const prev = Array.from<number>({ length: adjacency.length }).fill(-1);
  const depth = Array.from<number>({ length: adjacency.length }).fill(-1);
  depth[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of adjacency[node]) {
      if (depth[next] >= 0) continue;
      depth[next] = depth[node] + 1;
      prev[next] = node;
      queue.push(next);
    }
  }
  return { prev, depth };
}

/** The deepest node in a search — the other end of a double sweep. */
export function farthest(search: { depth: readonly number[] }): number {
  let best = 0;
  for (let i = 0; i < search.depth.length; i++) {
    if (search.depth[i] > search.depth[best]) best = i;
  }
  return best;
}

/** Walk a BFS's predecessor chain back from `to`, returned `from`-first. */
export function pathBetween(
  search: { prev: readonly number[] },
  from: number,
  to: number,
): number[] {
  const path: number[] = [];
  for (let node = to; node >= 0; node = search.prev[node]) {
    path.push(node);
    if (node === from) break;
  }
  return path.reverse();
}

export interface Topology {
  adjacency: number[][];
  /** One end of the graph's longest route. */
  start: number;
  /** The other end. */
  end: number;
  /** Node indices from `start` to `end`, in order. */
  main: number[];
}

/** The double sweep: the two most distant nodes and the route between them.
 *  Exact on trees, and a good approximation on the near-trees a room layout
 *  produces once a few loop edges are added.
 *
 *      const layout = Procgen.rooms({ cols, rows, seed });
 *      const shape = Procgen.topology(layout.rooms.length, layout.links);
 *      const entrance = layout.rooms[shape.start];
 */
export function topology(count: number, links: ReadonlyArray<readonly [number, number]>): Topology {
  const adjacency = adjacencyOf(count, links);
  if (count === 0) return { adjacency, start: -1, end: -1, main: [] };
  const start = farthest(bfs(adjacency, 0));
  const fromStart = bfs(adjacency, start);
  const end = farthest(fromStart);
  return { adjacency, start, end, main: pathBetween(fromStart, start, end) };
}

/** Nodes hanging OFF the main route, reachable from its first `steps` nodes
 *  without stepping past them. This is the shape "somewhere you can already get
 *  to, but that is not on the way" — a side chamber, a detour, an optional
 *  reward — with no opinion about what a caller puts there. */
export function branchesBefore(
  shape: Topology,
  steps: number,
  exclude = new Set<number>(),
): number[] {
  const onMain = new Set(shape.main);
  const out: number[] = [];
  for (const node of shape.main.slice(0, steps)) {
    for (const neighbour of shape.adjacency[node]) {
      if (onMain.has(neighbour) || exclude.has(neighbour) || out.includes(neighbour)) continue;
      out.push(neighbour);
    }
  }
  return out;
}
