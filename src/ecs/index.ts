// ---------- ECS (Entity-Component-System) ----------
// A tiny archetype-free ECS: components, a generational entity id scheme, and
// a world factory that owns spawn/query/systems and a built-in Sprite renderer.
// Split into types / component (registry + built-in Sprite) / world (factory).
export * from "./types.js";
export * from "./component.js";
export * from "./world.js";
