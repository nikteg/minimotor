export interface PresentPlayer<M = unknown> {
    id: string;
    joined: boolean;
    metadata: M;
}
export interface PresenceApi {
    readonly players: readonly PresentPlayer[];
    set<M>(id: string, metadata: M): void;
    remove(id: string): void;
    get<M>(id: string): PresentPlayer<M> | undefined;
    clear(): void;
}
export declare function createPresence(): PresenceApi;
