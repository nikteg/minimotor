import { Ecs } from "./types.js";
/** Create a fresh ECS world — its own entities, component stores, and
 *  systems, sharing nothing with other worlds. The blessed idiom is `const ecs
 *  = createEcs()`; make one per scene or per game and drop it to tear down. */
export declare function createEcs(): Ecs;
