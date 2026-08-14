import type { App } from "../engine/index.js";
import { type SceneSpec, type SceneStackOptions } from "./stack.js";
export * from "./stack.js";
/** Scene factory bound to one app's clocks and viewport. */
export declare function createScenes(app: App): {
    create<K extends string>(map: Record<K, SceneSpec>, { clock, uiClock, view, ...options }?: Partial<SceneStackOptions>): import("./stack.js").SceneStack<K>;
};
