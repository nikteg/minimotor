import type { App } from "../engine/app.js";
import type { SnapshotsApi } from "../snapshots/index.js";
import type { StorageApi } from "../storage/index.js";
export interface AutosaveOptions<N extends string = string> {
    key?: string;
    everySteps?: number;
    store?: N;
}
export interface AutosaveApi {
    save(): Promise<void>;
    load(): Promise<boolean>;
    clear(): Promise<void>;
}
/** Periodically persist explicit snapshots through an explicit storage service. */
export declare function createAutosave<N extends string>(app: App, snapshots: SnapshotsApi, storage: StorageApi<N>, { key, everySteps, store }?: AutosaveOptions<N>): AutosaveApi;
