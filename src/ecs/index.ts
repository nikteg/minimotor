// ---------- ECS (Entity-Component-System) ----------
// A tiny archetype-free ECS: components, a generational entity id scheme, and
// a world factory that owns spawn/query/systems. Content-agnostic — it knows
// nothing about sprites or rendering (see `Sprites.Sprite` for the standard
// sprite component and `Draw.sprites` for its renderer).
// Split into types / component (the registry) / world (the factory).
export * from "./types.js";
export * from "./component.js";
export * from "./world.js";
