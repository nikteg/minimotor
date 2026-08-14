import type { App } from "../engine/app.js";
import { type AssetStore } from "./store.js";
export * from "./store.js";
/** Create an asset cache owned and cleared by one app. */
export declare function createAssets(app: App): AssetStore;
