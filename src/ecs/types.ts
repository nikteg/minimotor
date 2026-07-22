// ---------- ECS (Entity-Component-System) ----------
// A minimal-ceremony, sparse-set ECS. Components are plain-data with a typed
// handle; entities are generational ids (stale handles are detectable); queries
// iterate the smallest matching set and yield typed tuples.
//
//   const Position = Minimotor.ECS.component<{ x: number; y: number }>("Position");
//   const Velocity = Minimotor.ECS.component<{ x: number; y: number }>("Velocity");
//
//   const world = Minimotor.ECS.world();            // or Minimotor.Ecs (default)
//   const e = world.spawn(Position.with({ x: 0, y: 0 }), Velocity.with({ x: 1, y: 0 }));
//
//   for (const [id, pos, vel] of world.query(Position, Velocity)) {
//     pos.x += vel.x;
//     pos.y += vel.y;
//   }
//
// Determinism & safety: structural changes issued *while a query is iterating*
// (spawn attaches immediately since the caller needs the id; despawn/remove are
// buffered) are applied when the outermost `for…of` completes — so a query never
// mutates the set it's walking, and multi-step frames stay deterministic.

/** A component handle. Carries the element type `T` for typed queries. */
export interface Component<T> {
  readonly id: number;
  readonly name: string;
  /** Pair this component with data for `world.spawn(...)`. */
  with(data: T): ComponentInit<T>;
}

/** A component + its initial data, produced by `Component.with()`. */
export interface ComponentInit<T> {
  readonly component: Component<T>;
  readonly data: T;
}

// `any` is intentional here: these erase the element type so heterogeneous
// component lists (spawn args, query inputs) type-check (`Component<T>` is
// invariant in `T`, so `unknown` can't stand in). The public API stays fully
// typed via the generic overloads below.
// oxlint-disable-next-line typescript/no-explicit-any
export type AnyComponent = Component<any>;

// oxlint-disable-next-line typescript/no-explicit-any
type AnyInit = ComponentInit<any>;

/** An entity id. Encodes a slot index plus a generation counter, so a handle to
 *  a despawned-and-recycled slot is detected as dead by `world.alive()`. */
export type Entity = number & { readonly __entity: unique symbol };

/** A simulation system: runs in the update phase (via `world.update()`). */
export type System = (world: Ecs) => void;

/** A render system: runs in the draw phase (via `world.draw(ctx)`). */
export type RenderSystem = (world: Ecs, ctx: CanvasRenderingContext2D) => void;

/** A container of entities, their components, and queries over them. Create
 *  with `ECS.create()` — the blessed instance idiom is `const ecs =
 *  ECS.create()`. ECS worlds are game CONTENT: make one per scene or per
 *  game, drop it to tear it down. */
export interface Ecs {
  /** Create an entity, optionally attaching components. Returns its id. */
  spawn(...inits: AnyInit[]): Entity;
  /** Mark an entity (and all its components) for removal. Safe inside
   *  `each`/`query`: deferred automatically and applied when the outermost
   *  iteration ends — no skipped-element bugs, nothing to call. */
  despawn(e: Entity): void;
  /** Is this exact handle still live? (False for a recycled/despawned slot.) */
  alive(e: Entity): boolean;
  /** Attach or overwrite a component on an entity. */
  add<T>(e: Entity, c: Component<T>, data: T): void;
  /** Read a component, or undefined if absent/dead. */
  get<T>(e: Entity, c: Component<T>): T | undefined;
  /** Does the entity have this component? */
  has(e: Entity, c: AnyComponent): boolean;
  /** Remove a component. Deferred if a query is iterating. */
  remove(e: Entity, c: AnyComponent): void;
  /** How many entities currently have this component. */
  count(c: AnyComponent): number;
  /** Total live entities (despawns land once the outermost iteration ends). */
  readonly size: number;
  /** Remove every entity and component (systems are kept). */
  clear(): void;

  /** Register (or replace, by name) an update-phase system. Systems run in
   *  registration order when `update()` is called. */
  system(name: string, fn: System): void;
  /** Register (or replace, by name) a draw-phase system. */
  renderSystem(name: string, fn: RenderSystem): void;
  /** Run every update system in order, then flush buffered structural changes. */
  update(): void;
  /** Run every render system in order with the given context. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** The live backing array of a component's data — every row currently
   *  attached, packed (a sparse set's dense side). This is the zero-copy bridge
   *  to code that consumes component data in bulk without the ECS knowing what
   *  that code does: e.g. hand the `Sprite` store to the renderer with
   *  `Draw.sprites(ecs.dense(Sprites.Sprite), { alpha, view })`. The array is
   *  the store's own backing — read and mutate elements freely, but don't
   *  change its length (spawn/despawn own that). Empty when nothing holds `c`. */
  dense<T>(c: Component<T>): readonly T[];

  /** Callback-form query for hot systems: no generator, no per-entity tuple
   *  allocation. Same matching semantics as `query`. */
  each<A>(a: Component<A>, fn: (e: Entity, a: A) => void): void;
  each<A, B>(a: Component<A>, b: Component<B>, fn: (e: Entity, a: A, b: B) => void): void;
  each<A, B, C>(
    a: Component<A>,
    b: Component<B>,
    c: Component<C>,
    fn: (e: Entity, a: A, b: B, c: C) => void,
  ): void;
  each<A, B, C, D>(
    a: Component<A>,
    b: Component<B>,
    c: Component<C>,
    d: Component<D>,
    fn: (e: Entity, a: A, b: B, c: C, d: D) => void,
  ): void;

  query<A>(a: Component<A>): Iterable<[Entity, A]>;
  query<A, B>(a: Component<A>, b: Component<B>): Iterable<[Entity, A, B]>;
  query<A, B, C>(a: Component<A>, b: Component<B>, c: Component<C>): Iterable<[Entity, A, B, C]>;
  query<A, B, C, D>(
    a: Component<A>,
    b: Component<B>,
    c: Component<C>,
    d: Component<D>,
  ): Iterable<[Entity, A, B, C, D]>;
  query(...cs: AnyComponent[]): Iterable<[Entity, ...unknown[]]>;
}
