// ---------- ECS (Entity-Component-System) ----------
// A minimal-ceremony, sparse-set ECS. Components are plain-data with a typed
// handle; entities are generational ids (stale handles are detectable); queries
// iterate the smallest matching set and yield typed tuples.
//
//   const Position = Minimotor.ECS.component<{ x: number; y: number }>("Position");
//   const Velocity = Minimotor.ECS.component<{ x: number; y: number }>("Velocity");
//
//   const world = Minimotor.ECS.world();            // or Minimotor.World (default)
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
// component lists (spawn args, query inputs) type-check. The public API stays
// fully typed via the generic overloads below.
export type AnyComponent = Component<any>;

type AnyInit = ComponentInit<any>;

/** An entity id. Encodes a slot index plus a generation counter, so a handle to
 *  a despawned-and-recycled slot is detected as dead by `world.alive()`. */
export type Entity = number & { readonly __entity: unique symbol };

/** A simulation system: runs in the update phase (via `world.update()`). */
export type System = (world: World) => void;

/** A render system: runs in the draw phase (via `world.draw(ctx)`). */
export type RenderSystem = (world: World, ctx: CanvasRenderingContext2D) => void;

/** An image the built-in sprite renderer can blit. A `SpriteCanvas` from
 *  `Sprites.getSprite` carries `logicalSize`, so its on-screen size is inferred
 *  automatically; for other images pass `w`/`h` (or the natural size is used). */
type SpriteImage = (HTMLCanvasElement | HTMLImageElement | ImageBitmap) & {
  logicalSize?: number;
};

/** The engine-standard `Sprite` component: position + texture + presentation.
 *  Attach it and call `world.drawSprites(ctx)` — no hand-written blit loop.
 *  Drop to a manual `ctx` query only for custom visuals. */
export interface SpriteData {
  /** World position (logical px). */
  x: number;
  y: number;
  /** Texture to blit (canvas / image / bitmap). */
  img: SpriteImage;
  /** On-screen size (logical px). Inferred from `img` when omitted. */
  w?: number;
  h?: number;
  /** Anchor as a fraction of size; 0.5/0.5 (default) centers on `x,y`. */
  ax?: number;
  ay?: number;
  /** Rotation in radians (default 0), applied about the anchor. */
  rot?: number;
  /** Uniform scale (default 1). */
  scale?: number;
  /** Mirror horizontally / vertically about the anchor (default false). */
  flipX?: boolean;
  flipY?: boolean;
  /** Opacity 0..1 (default 1). */
  alpha?: number;
  /** Draw order — lower is drawn first (default 0). */
  z?: number;
  /** Skip drawing when false (default true). */
  visible?: boolean;
  /** Source sub-rect within `img` (px). Set all four to blit one cell of a
   *  sprite sheet / texture atlas — an `Anim` writes these each frame. When set,
   *  on-screen size defaults to `sw`/`sh` instead of the whole image. */
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
  /** Position at the previous fixed step. Maintained by `world.update()`;
   *  `drawSprites` uses it to interpolate when given an `alpha` — don't write
   *  these yourself (but *do* reset them alongside `x`/`y` when teleporting an
   *  entity, or it will visibly streak for one frame). */
  px?: number;
  py?: number;
}

/** Options for `world.drawSprites`. */
export interface DrawSpritesOptions {
  /** Render interpolation factor 0..1 (pass `Loop.alpha`). Sprites whose
   *  `px`/`py` snapshots exist are drawn between their previous and current
   *  step positions — smooth motion on 90/120/144 Hz displays. */
  alpha?: number;
  /** Visible world rect (camera view). When given, sprites fully outside it are
   *  skipped before any transform work. */
  view?: { x: number; y: number; w: number; h: number };
}

/** A container of entities, their components, and queries over them. Create with
 *  `ECS.world()`; a shared default is exposed as `Minimotor.World`. */
export interface World {
  /** Create an entity, optionally attaching components. Returns its id. */
  spawn(...inits: AnyInit[]): Entity;
  /** Mark an entity (and all its components) for removal. Deferred if a query is
   *  iterating; applied on the next flush. */
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
  /** Total live entities (despawns land after the deferred flush). */
  readonly size: number;
  /** Apply any buffered structural changes now (auto-run when queries finish). */
  flush(): void;
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
  /** Built-in renderer: blit every entity holding the standard `Sprite`
   *  component, sorted by `z` (ties keep spawn order). Honors anchor, rotation,
   *  scale, flip, alpha and visibility. Call from a scene `draw` or a render
   *  system. Pass `{ alpha: Loop.alpha }` for interpolated positions and/or
   *  `{ view }` to cull off-screen sprites. */
  drawSprites(ctx: CanvasRenderingContext2D, opts?: DrawSpritesOptions): void;

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
