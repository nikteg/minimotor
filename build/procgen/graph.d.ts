/** Adjacency lists for `count` nodes joined by undirected index pairs. */
export declare function adjacencyOf(count: number, links: ReadonlyArray<readonly [number, number]>): number[][];
/** BFS from `from`; returns each node's predecessor and depth (-1 if
 *  unreachable). */
export declare function bfs(adjacency: readonly number[][], from: number): {
    prev: number[];
    depth: number[];
};
/** The deepest node in a search — the other end of a double sweep. */
export declare function farthest(search: {
    depth: readonly number[];
}): number;
/** Walk a BFS's predecessor chain back from `to`, returned `from`-first. */
export declare function pathBetween(search: {
    prev: readonly number[];
}, from: number, to: number): number[];
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
export declare function topology(count: number, links: ReadonlyArray<readonly [number, number]>): Topology;
/** Nodes hanging OFF the main route, reachable from its first `steps` nodes
 *  without stepping past them. This is the shape "somewhere you can already get
 *  to, but that is not on the way" — a side chamber, a detour, an optional
 *  reward — with no opinion about what a caller puts there. */
export declare function branchesBefore(shape: Topology, steps: number, exclude?: Set<number>): number[];
