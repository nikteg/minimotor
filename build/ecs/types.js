// ---------- ECS (Entity-Component-System) ----------
// A minimal-ceremony, sparse-set ECS. Components are plain-data with a typed
// handle; entities are generational ids (stale handles are detectable); queries
// iterate the smallest matching set and yield typed tuples.
//
//   import { component, createEcs } from "minimotor/ecs";
//
//   const Position = component<{ x: number; y: number }>("Position");
//   const Velocity = component<{ x: number; y: number }>("Velocity");
//   const world = createEcs();
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
export {};
