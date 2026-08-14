import { createAssetStore } from "./store.js";
export * from "./store.js";
/** Create an asset cache owned and cleared by one app. */
export function createAssets(app) {
    const store = createAssetStore();
    app.onDestroy(() => store.clear());
    return store;
}
