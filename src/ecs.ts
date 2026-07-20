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
type AnyComponent = Component<any>;
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

let nextComponentId = 0;

/** Define a component type. Call once per component (module scope), then attach
 *  instances to entities. The name is for debugging only; identity is the id. */
export function component<T>(name: string): Component<T> {
  const id = nextComponentId++;
  const self: Component<T> = {
    id,
    name,
    with(data: T): ComponentInit<T> {
      return { component: self, data };
    },
  };
  return self;
}

/** The engine-standard sprite component. Bake a texture with `Sprites.getSprite`
 *  (or load an image), attach `Sprite.with({ x, y, img })`, then let
 *  `world.drawSprites(ctx)` draw it. */
export const Sprite = component<SpriteData>("Sprite");

// Entity id packing: id = generation * CAP + index. Plain arithmetic (not
// bit-shifts) to sidestep 32-bit sign issues on large generations.
const INDEX_CAP = 1 << 20; // up to ~1M live entities
const indexOf = (e: Entity): number => (e as number) % INDEX_CAP;
const genOf = (e: Entity): number => Math.floor((e as number) / INDEX_CAP);
const makeId = (index: number, gen: number): Entity => (gen * INDEX_CAP + index) as Entity;

/** Sparse set: dense arrays of data + owning-entity-index, and a reverse map
 *  from entity index to dense slot. O(1) add/remove/lookup, cache-friendly scan. */
interface Store {
  dense: unknown[];
  owners: number[]; // entity index for each dense slot
  slotOf: (number | undefined)[]; // entity index -> dense slot
}

/** Register `fn` under `name`, replacing any existing entry with that name. */
function upsert<F>(list: { name: string; fn: F }[], name: string, fn: F): void {
  const existing = list.find((s) => s.name === name);
  if (existing) existing.fn = fn;
  else list.push({ name, fn });
}

/** Swap-remove an entity's slot from a store, keeping the dense arrays packed. */
function removeAt(st: Store, index: number): void {
  const slot = st.slotOf[index];
  if (slot === undefined) return;
  const last = st.dense.length - 1;
  if (slot !== last) {
    // Move the last element into the freed slot and fix its reverse map.
    const movedOwner = st.owners[last];
    st.dense[slot] = st.dense[last];
    st.owners[slot] = movedOwner;
    st.slotOf[movedOwner] = slot;
  }
  st.dense.pop();
  st.owners.pop();
  st.slotOf[index] = undefined;
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

export function world(): World {
  const generations: number[] = [];
  const alive: boolean[] = [];
  const free: number[] = [];
  const stores = new Map<number, Store>();
  // Which component ids each entity index holds — so despawn touches only the
  // entity's own stores instead of scanning every registered component type.
  const owned: (Set<number> | undefined)[] = [];

  let iterating = 0;
  let liveCount = 0;
  const commands: (() => void)[] = [];

  // Reused per-call scratch (drawSprites list / each row) — hot-path, no allocs.
  const scratch: SpriteData[] = [];
  const eachRow: unknown[] = [];

  const updateSystems: { name: string; fn: System }[] = [];
  const renderSystems: { name: string; fn: RenderSystem }[] = [];

  function defer(fn: () => void): void {
    if (iterating > 0) commands.push(fn);
    else fn();
  }

  function flush(): void {
    // A command may itself queue more (rare); drain until settled.
    while (commands.length) {
      const batch = commands.splice(0, commands.length);
      for (const fn of batch) fn();
    }
  }

  function store(cid: number): Store {
    let st = stores.get(cid);
    if (!st) {
      st = { dense: [], owners: [], slotOf: [] };
      stores.set(cid, st);
    }
    return st;
  }

  function addAt(index: number, cid: number, data: unknown): void {
    const st = store(cid);
    const slot = st.slotOf[index];
    if (slot !== undefined) {
      st.dense[slot] = data; // overwrite
      return;
    }
    st.slotOf[index] = st.dense.length;
    st.dense.push(data);
    st.owners.push(index);
    (owned[index] ??= new Set()).add(cid);
  }

  function despawnAt(index: number): void {
    const cids = owned[index];
    if (cids) {
      for (const cid of cids) removeAt(stores.get(cid)!, index);
      cids.clear();
    }
    generations[index]++;
    alive[index] = false;
    liveCount--;
    free.push(index);
  }

  const self: World = {
    spawn(...inits) {
      let index: number;
      if (free.length) {
        index = free.pop()!;
        alive[index] = true;
      } else {
        index = generations.length;
        generations.push(0);
        alive.push(true);
      }
      liveCount++;
      // Attaching is an append — safe even mid-query (queries snapshot length).
      for (const init of inits) addAt(index, init.component.id, init.data);
      return makeId(index, generations[index]);
    },

    get size() {
      return liveCount;
    },

    despawn(e) {
      if (!self.alive(e)) return;
      const index = indexOf(e);
      defer(() => despawnAt(index));
    },

    alive(e) {
      const index = indexOf(e);
      return alive[index] === true && generations[index] === genOf(e);
    },

    add(e, c, data) {
      if (!self.alive(e)) return;
      addAt(indexOf(e), c.id, data);
    },

    get(e, c) {
      if (!self.alive(e)) return undefined;
      const st = stores.get(c.id);
      const slot = st?.slotOf[indexOf(e)];
      return slot === undefined ? undefined : (st!.dense[slot] as never);
    },

    has(e, c) {
      if (!self.alive(e)) return false;
      return stores.get(c.id)?.slotOf[indexOf(e)] !== undefined;
    },

    remove(e, c) {
      if (!self.alive(e)) return;
      const index = indexOf(e);
      const st = stores.get(c.id);
      if (st) {
        defer(() => {
          removeAt(st, index);
          owned[index]?.delete(c.id);
        });
      }
    },

    count(c) {
      return stores.get(c.id)?.dense.length ?? 0;
    },

    flush,

    clear() {
      stores.clear();
      generations.length = 0;
      alive.length = 0;
      free.length = 0;
      owned.length = 0;
      commands.length = 0;
      iterating = 0;
      liveCount = 0;
    },

    system(name, fn) {
      upsert(updateSystems, name, fn);
    },

    renderSystem(name, fn) {
      upsert(renderSystems, name, fn);
    },

    update() {
      // Snapshot sprite positions before simulating, so drawSprites can
      // interpolate between the previous and current step (`Loop.alpha`).
      const spriteStore = stores.get(Sprite.id);
      if (spriteStore) {
        for (const d of spriteStore.dense) {
          const s = d as SpriteData;
          s.px = s.x;
          s.py = s.y;
        }
      }
      for (const s of updateSystems) s.fn(self);
      flush();
    },

    draw(ctx) {
      for (const s of renderSystems) s.fn(self, ctx);
    },

    drawSprites(ctx, opts) {
      const lerp = opts?.alpha;
      const view = opts?.view;

      // Reuse the scratch list — a fresh array per frame is pure GC churn.
      scratch.length = 0;
      const st = stores.get(Sprite.id);
      if (!st) return;
      for (const d of st.dense) scratch.push(d as SpriteData);

      // Sorting an already-ordered list is cheap but not free; check first.
      let ordered = true;
      for (let i = 1; i < scratch.length; i++) {
        if ((scratch[i].z ?? 0) < (scratch[i - 1].z ?? 0)) {
          ordered = false;
          break;
        }
      }
      if (!ordered) scratch.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

      let ctxAlpha = 1; // track instead of save/restore per sprite
      for (const s of scratch) {
        if (s.visible === false) continue;
        const alpha = s.alpha ?? 1;
        if (alpha <= 0) continue;

        const img = s.img;
        const clipped = s.sw !== undefined && s.sh !== undefined;
        // With a source rect the natural size is the cell; otherwise the image.
        const w = s.w ?? (clipped ? s.sw! : (img.logicalSize ?? img.width));
        const h = s.h ?? (clipped ? s.sh! : (img.logicalSize ?? img.height));
        const ax = s.ax ?? 0.5;
        const ay = s.ay ?? 0.5;
        const rot = s.rot ?? 0;
        const scale = s.scale ?? 1;
        const flipX = s.flipX === true;
        const flipY = s.flipY === true;

        // Interpolated render position (snapshots come from world.update()).
        let x = s.x;
        let y = s.y;
        if (lerp !== undefined && s.px !== undefined && s.py !== undefined) {
          x = s.px + (s.x - s.px) * lerp;
          y = s.py + (s.y - s.py) * lerp;
        }

        if (view) {
          // Conservative reject: w+h bounds the diagonal, so this is safe for
          // any rotation and any anchor in [0,1].
          const ext = (w + h) * scale;
          if (
            x + ext < view.x ||
            x - ext > view.x + view.w ||
            y + ext < view.y ||
            y - ext > view.y + view.h
          ) {
            continue;
          }
        }

        if (alpha !== ctxAlpha) {
          ctx.globalAlpha = alpha;
          ctxAlpha = alpha;
        }

        if (rot === 0 && scale === 1 && !flipX && !flipY) {
          // Common case: no transform needed at all.
          if (clipped) {
            ctx.drawImage(img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, x - ax * w, y - ay * h, w, h);
          } else {
            ctx.drawImage(img, x - ax * w, y - ay * h, w, h);
          }
        } else {
          ctx.save();
          ctx.translate(x, y);
          if (rot !== 0) ctx.rotate(rot);
          const kx = scale * (flipX ? -1 : 1);
          const ky = scale * (flipY ? -1 : 1);
          if (kx !== 1 || ky !== 1) ctx.scale(kx, ky);
          if (clipped) {
            ctx.drawImage(img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, -ax * w, -ay * h, w, h);
          } else {
            ctx.drawImage(img, -ax * w, -ay * h, w, h);
          }
          ctx.restore();
        }
      }
      if (ctxAlpha !== 1) ctx.globalAlpha = 1;
    },

    // Callback query: shares the matching logic shape with `query` but calls
    // straight through — no generator machinery, no per-entity tuple.
    each: ((...args: unknown[]): void => {
      const fn = args.pop() as (...xs: unknown[]) => void;
      const cs = args as AnyComponent[];
      if (cs.length === 0) return;
      let driver: Store | null = null;
      for (const c of cs) {
        const st = stores.get(c.id);
        if (!st || st.dense.length === 0) return;
        if (!driver || st.dense.length < driver.dense.length) driver = st;
      }
      const cols = cs.map((c) => stores.get(c.id)!);

      iterating++;
      try {
        const len = driver!.dense.length; // snapshot: new spawns aren't visited
        outer: for (let i = 0; i < len; i++) {
          const index = driver!.owners[i];
          eachRow.length = 0;
          eachRow.push(makeId(index, generations[index]));
          for (const col of cols) {
            if (col === driver) {
              eachRow.push(col.dense[i]);
              continue;
            }
            const slot = col.slotOf[index];
            if (slot === undefined) continue outer;
            eachRow.push(col.dense[slot]);
          }
          fn(...eachRow);
        }
      } finally {
        if (--iterating === 0) flush();
      }
    }) as World["each"],

    // Implementation is one loose signature; the typed overloads live on the
    // World interface, so the cast just bridges impl → declared overloads.
    query: ((...cs: AnyComponent[]): Iterable<[Entity, ...unknown[]]> => {
      const gen = function* (): Generator<[Entity, ...unknown[]]> {
        if (cs.length === 0) return;
        // Drive iteration from the smallest matching store; bail if any is empty.
        let driver: Store | null = null;
        for (const c of cs) {
          const st = stores.get(c.id);
          if (!st || st.dense.length === 0) return;
          if (!driver || st.dense.length < driver.dense.length) driver = st;
        }
        const cols = cs.map((c) => stores.get(c.id)!);

        iterating++;
        try {
          const len = driver!.dense.length; // snapshot: new spawns aren't visited
          for (let i = 0; i < len; i++) {
            const index = driver!.owners[i];
            const row: unknown[] = [makeId(index, generations[index])];
            let ok = true;
            for (const col of cols) {
              // The driver's data is already at hand — no membership re-check.
              if (col === driver) {
                row.push(col.dense[i]);
                continue;
              }
              const slot = col.slotOf[index];
              if (slot === undefined) {
                ok = false;
                break;
              }
              row.push(col.dense[slot]);
            }
            if (ok) yield row as [Entity, ...unknown[]];
          }
        } finally {
          if (--iterating === 0) flush();
        }
      };
      return { [Symbol.iterator]: gen };
    }) as World["query"],
  };

  return self;
}
