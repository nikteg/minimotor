import type { App } from "../engine/app.js";
import { createAssetStore, type AssetStore } from "./index.js";

// The subpath entry: the app-bound service plus the pure module it binds.
export * from "./index.js";

/** Create an asset cache owned and cleared by one app. */
export function createAssets(app: App): AssetStore {
  const store = createAssetStore();
  app.onDestroy(() => store.clear());
  return store;
}
