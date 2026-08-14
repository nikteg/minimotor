export interface StateBinding<T = unknown> {
    save(): T;
    load(value: T): void;
}
export interface SnapshotsApi {
    register<T>(name: string, binding: StateBinding<T>): () => void;
    capture(): Record<string, unknown>;
    restore(snapshot: Readonly<Record<string, unknown>>): void;
}
export declare function createSnapshots(): SnapshotsApi;
