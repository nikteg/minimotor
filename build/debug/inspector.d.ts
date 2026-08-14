export interface Inspection {
    name: string;
    read(): unknown;
}
export interface InspectorApi {
    watch(name: string, read: () => unknown): () => void;
    snapshot(): Record<string, unknown>;
    readonly entries: readonly Inspection[];
}
export declare function createInspector(): InspectorApi;
