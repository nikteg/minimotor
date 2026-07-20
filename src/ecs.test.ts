import { describe, it, expect, vi } from "vitest";
import { component, world, Sprite, type Entity } from "./ecs.js";

const Position = component<{ x: number; y: number }>("Position");
const Velocity = component<{ x: number; y: number }>("Velocity");
const Tag = component<true>("Tag");

function ids(world: ReturnType<typeof world>, ...cs: Parameters<typeof world.query>): Entity[] {
  return [...world.query(...cs)].map((row) => row[0]);
}

describe("ECS entities & components", () => {
  it("spawns with components and reads them back", () => {
    const w = world();
    const e = w.spawn(Position.with({ x: 1, y: 2 }), Velocity.with({ x: 3, y: 4 }));
    expect(w.alive(e)).toBe(true);
    expect(w.get(e, Position)).toEqual({ x: 1, y: 2 });
    expect(w.has(e, Velocity)).toBe(true);
    expect(w.has(e, Tag)).toBe(false);
  });

  it("add overwrites, remove detaches", () => {
    const w = world();
    const e = w.spawn();
    w.add(e, Position, { x: 0, y: 0 });
    w.add(e, Position, { x: 9, y: 9 });
    expect(w.get(e, Position)).toEqual({ x: 9, y: 9 });
    w.remove(e, Position);
    expect(w.has(e, Position)).toBe(false);
    expect(w.get(e, Position)).toBeUndefined();
  });

  it("despawn removes the entity and all its components", () => {
    const w = world();
    const e = w.spawn(Position.with({ x: 0, y: 0 }), Velocity.with({ x: 0, y: 0 }));
    w.despawn(e);
    expect(w.alive(e)).toBe(false);
    expect(w.get(e, Position)).toBeUndefined();
    expect(w.count(Position)).toBe(0);
    expect(w.count(Velocity)).toBe(0);
  });

  it("size tracks live entities through spawn/despawn/clear", () => {
    const w = world();
    expect(w.size).toBe(0);
    const a = w.spawn(Position.with({ x: 0, y: 0 }));
    w.spawn();
    expect(w.size).toBe(2);
    w.despawn(a);
    expect(w.size).toBe(1);
    w.despawn(a); // stale handle — must not double-count
    expect(w.size).toBe(1);
    w.clear();
    expect(w.size).toBe(0);
  });
});

describe("ECS generational ids", () => {
  it("a recycled slot invalidates the old handle", () => {
    const w = world();
    const a = w.spawn(Position.with({ x: 1, y: 1 }));
    w.despawn(a);
    const b = w.spawn(Position.with({ x: 2, y: 2 })); // reuses a's slot, new generation
    expect(w.alive(a)).toBe(false); // stale handle detected
    expect(w.alive(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(w.get(a, Position)).toBeUndefined();
    expect(w.get(b, Position)).toEqual({ x: 2, y: 2 });
  });

  it("operations on a dead handle are no-ops", () => {
    const w = world();
    const e = w.spawn();
    w.despawn(e);
    expect(() => {
      w.add(e, Position, { x: 0, y: 0 });
      w.remove(e, Position);
      w.despawn(e);
    }).not.toThrow();
    expect(w.has(e, Position)).toBe(false);
  });
});

describe("ECS queries", () => {
  it("yields only entities holding every component, with typed tuples", () => {
    const w = world();
    const moving = w.spawn(Position.with({ x: 0, y: 0 }), Velocity.with({ x: 1, y: 2 }));
    w.spawn(Position.with({ x: 5, y: 5 })); // no Velocity — excluded

    const rows = [...w.query(Position, Velocity)];
    expect(rows).toHaveLength(1);
    const [id, pos, vel] = rows[0];
    expect(id).toBe(moving);
    pos.x += vel.x;
    pos.y += vel.y;
    expect(w.get(moving, Position)).toEqual({ x: 1, y: 2 });
  });

  it("empty when any component has no entities", () => {
    const w = world();
    w.spawn(Position.with({ x: 0, y: 0 }));
    expect([...w.query(Position, Velocity)]).toEqual([]);
    expect([...w.query(Tag)]).toEqual([]);
  });

  it("drives from the smallest set (correct regardless of arg order)", () => {
    const w = world();
    for (let i = 0; i < 100; i++) w.spawn(Position.with({ x: i, y: 0 }));
    const rare = w.spawn(Position.with({ x: -1, y: 0 }), Velocity.with({ x: 0, y: 0 }));
    expect(ids(w, Velocity, Position)).toEqual([rare]);
    expect(ids(w, Position, Velocity)).toEqual([rare]);
  });
});

describe("ECS iteration safety (command buffer)", () => {
  it("despawns during a query apply after it finishes, not mid-walk", () => {
    const w = world();
    const spawned: Entity[] = [];
    for (let i = 0; i < 6; i++) spawned.push(w.spawn(Position.with({ x: i, y: 0 })));

    let visited = 0;
    for (const [id, pos] of w.query(Position)) {
      visited++;
      if (pos.x % 2 === 0) w.despawn(id); // remove evens while iterating
    }
    // All 6 were visited (buffer prevented mid-iteration swap-removal)…
    expect(visited).toBe(6);
    // …and the deferred despawns applied on completion.
    expect(w.count(Position)).toBe(3);
    expect(spawned.filter((e) => w.alive(e))).toHaveLength(3);
  });

  it("entities spawned during a query are not visited until the next one", () => {
    const w = world();
    w.spawn(Position.with({ x: 0, y: 0 }));
    let visited = 0;
    for (const _row of w.query(Position)) {
      void _row;
      visited++;
      if (visited === 1) w.spawn(Position.with({ x: 1, y: 1 })); // appended, not visited now
    }
    expect(visited).toBe(1);
    expect(w.count(Position)).toBe(2); // present for the next query
    expect([...w.query(Position)]).toHaveLength(2);
  });

  it("nested queries flush only when the outer one completes", () => {
    const w = world();
    const a = w.spawn(Position.with({ x: 0, y: 0 }));
    const b = w.spawn(Position.with({ x: 1, y: 0 }));
    for (const [outer] of w.query(Position)) {
      w.despawn(outer);
      for (const [inner] of w.query(Position)) {
        // inner query still sees everyone; despawns are buffered
        expect(w.alive(inner)).toBe(true);
      }
    }
    expect(w.alive(a)).toBe(false);
    expect(w.alive(b)).toBe(false);
    expect(w.count(Position)).toBe(0);
  });
});

describe("ECS systems", () => {
  it("runs update systems in order then flushes buffered changes", () => {
    const w = world();
    const order: string[] = [];
    w.spawn(Position.with({ x: 0, y: 0 }), Velocity.with({ x: 2, y: 3 }));

    w.system("move", (world) => {
      order.push("move");
      for (const [, p, v] of world.query(Position, Velocity)) {
        p.x += v.x;
        p.y += v.y;
      }
    });
    w.system("cull", (world) => {
      order.push("cull");
      for (const [e, p] of world.query(Position)) if (p.x > 1) world.despawn(e);
    });

    w.update();
    expect(order).toEqual(["move", "cull"]);
    // move ran before cull; the entity moved to x=2 then was despawned on flush
    expect(w.count(Position)).toBe(0);
  });

  it("render systems receive the ctx", () => {
    const w = world();
    w.spawn(Position.with({ x: 5, y: 7 }));
    const ctx = {} as CanvasRenderingContext2D;
    const drawn: Array<[number, number]> = [];
    w.renderSystem("blit", (world, c) => {
      expect(c).toBe(ctx);
      for (const [, p] of world.query(Position)) drawn.push([p.x, p.y]);
    });
    w.draw(ctx);
    expect(drawn).toEqual([[5, 7]]);
  });

  it("system() replaces a system registered under the same name", () => {
    const w = world();
    const first = vi.fn();
    const second = vi.fn();
    w.system("s", first);
    w.system("s", second);
    w.update();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("ECS drawSprites", () => {
  // Minimal 2D-context stand-in that records the calls we assert on.
  function mockCtx() {
    const calls: string[] = [];
    let alpha = 1;
    const ctx = {
      calls,
      set globalAlpha(v: number) {
        alpha = v;
      },
      get globalAlpha() {
        return alpha;
      },
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      translate: (x: number, y: number) => calls.push(`translate ${x},${y}`),
      rotate: (r: number) => calls.push(`rotate ${r}`),
      scale: (x: number, y: number) => calls.push(`scale ${x},${y}`),
      drawImage: (_img: unknown, dx: number, dy: number, dw: number, dh: number) =>
        calls.push(`draw ${dx},${dy} ${dw}x${dh} @${alpha}`),
    };
    return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
  }

  const img = { width: 20, height: 20 } as HTMLCanvasElement;

  it("centers by default and infers size from the image", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 100, y: 50, img }));
    const ctx = mockCtx();
    w.drawSprites(ctx);
    // Untransformed fast path: no translate, absolute coords.
    // Default anchor 0.5 → 100-10, 50-10; size 20x20; alpha 1.
    expect(ctx.calls).toContain("draw 90,40 20x20 @1");
    expect(ctx.calls.filter((c) => c === "save")).toHaveLength(0);
  });

  it("respects explicit size, anchor and alpha", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 0, y: 0, img, w: 40, h: 10, ax: 0, ay: 1, alpha: 0.5 }));
    const ctx = mockCtx();
    w.drawSprites(ctx);
    expect(ctx.calls).toContain("draw 0,-10 40x10 @0.5"); // ax0 → 0, ay1 → -10
  });

  it("draws in ascending z order", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 3, y: 0, img, z: 10 }));
    w.spawn(Sprite.with({ x: 1, y: 0, img, z: -5 }));
    w.spawn(Sprite.with({ x: 2, y: 0, img, z: 0 }));
    const ctx = mockCtx();
    w.drawSprites(ctx);
    // Fast path draws at x - 10 (anchor 0.5 of the 20px image).
    const order = ctx.calls.filter((c) => c.startsWith("draw")).map((c) => c.split(" ")[1]);
    expect(order).toEqual(["-9,-10", "-8,-10", "-7,-10"]);
  });

  it("skips invisible and fully transparent sprites", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 0, y: 0, img, visible: false }));
    w.spawn(Sprite.with({ x: 0, y: 0, img, alpha: 0 }));
    const ctx = mockCtx();
    w.drawSprites(ctx);
    expect(ctx.calls.filter((c) => c.startsWith("draw"))).toHaveLength(0);
  });

  it("applies rotation and scale only when non-default", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 0, y: 0, img })); // no rot/scale
    w.spawn(Sprite.with({ x: 0, y: 0, img, rot: 1, scale: 2 }));
    const ctx = mockCtx();
    w.drawSprites(ctx);
    expect(ctx.calls.filter((c) => c.startsWith("rotate"))).toEqual(["rotate 1"]);
    expect(ctx.calls.filter((c) => c.startsWith("scale"))).toEqual(["scale 2,2"]);
  });

  it("flips about the anchor with a negative scale", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 0, y: 0, img, flipX: true }));
    const ctx = mockCtx();
    w.drawSprites(ctx);
    expect(ctx.calls).toContain("scale -1,1");
    expect(ctx.calls).toContain("draw -10,-10 20x20 @1"); // anchored offset unchanged
  });

  it("interpolates between the previous and current step positions", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 0, y: 0, img }));
    w.system("move", (wo) => {
      for (const [, s] of wo.query(Sprite)) s.x += 10;
    });
    w.update(); // snapshot px=0, then move to x=10
    const ctx = mockCtx();
    w.drawSprites(ctx, { alpha: 0.5 });
    expect(ctx.calls).toContain("draw -5,-10 20x20 @1"); // rendered at x=5
  });

  it("culls sprites outside the view rect", () => {
    const w = world();
    w.spawn(Sprite.with({ x: 1000, y: 0, img }));
    w.spawn(Sprite.with({ x: 10, y: 10, img }));
    const ctx = mockCtx();
    w.drawSprites(ctx, { view: { x: 0, y: 0, w: 100, h: 100 } });
    expect(ctx.calls.filter((c) => c.startsWith("draw"))).toHaveLength(1);
  });
});

describe("ECS each (callback queries)", () => {
  it("visits matching entities with the same semantics as query", () => {
    const w = world();
    const e1 = w.spawn(Position.with({ x: 1, y: 2 }), Velocity.with({ x: 3, y: 4 }));
    w.spawn(Position.with({ x: 9, y: 9 })); // no Velocity → not visited
    const rows: [Entity, number, number][] = [];
    w.each(Position, Velocity, (e, p, v) => rows.push([e, p.x, v.x]));
    expect(rows).toEqual([[e1, 1, 3]]);
  });

  it("defers structural changes issued during iteration", () => {
    const w = world();
    w.spawn(Position.with({ x: 0, y: 0 }));
    w.spawn(Position.with({ x: 1, y: 0 }));
    let visited = 0;
    w.each(Position, (e) => {
      visited++;
      w.despawn(e); // buffered until the loop completes
      expect(w.count(Position)).toBeGreaterThan(0);
    });
    expect(visited).toBe(2);
    expect(w.count(Position)).toBe(0); // flushed afterwards
  });
});
