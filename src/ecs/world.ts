import { Sprite } from "./component.js";
import type { AnyComponent } from "./types.js";
import { Entity, RenderSystem, SpriteData, System, World } from "./types.js";

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
