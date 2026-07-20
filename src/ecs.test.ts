import { describe, it, expect, vi } from "vitest";
import { component, world, type Entity } from "./ecs.js";

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
