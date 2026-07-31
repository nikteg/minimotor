// Asset loading types, factories, and the app-owned public entry.
import type { App } from "@src/engine/app.js";
import { createAssetStore, type AssetStore } from "./store.js";

export * from "./store.js";

/** Create an asset cache owned and cleared by one app. */
export function createAssets(app: App): AssetStore {
  const store = createAssetStore();
  app.onDestroy(() => store.clear());
  return store;
}
