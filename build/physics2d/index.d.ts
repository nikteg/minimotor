import type { App } from "../engine/app.js";
import { Phys, attach, type Physics2DOptions, type Physics2DWorld } from "./world.js";
export * from "./world.js";
/** Namespace-style export, matching the PascalCase service style:
 *  `import { Physics2D } from "minimotor/physics2d"` → `Physics2D.world()`. */
export interface Physics2DFeatureOptions extends Physics2DOptions {
    /** Advance automatically on this app's fixed loop. Default true. */
    autoStep?: boolean;
}
export interface Physics2DApi {
    readonly Phys: typeof Phys;
    world(options?: Physics2DFeatureOptions): Physics2DWorld;
    attach(ecs: Parameters<typeof attach>[0], physics: Parameters<typeof attach>[1], options?: Partial<Parameters<typeof attach>[2]>): void;
}
export declare function createPhysics2D(app: App): Physics2DApi;
