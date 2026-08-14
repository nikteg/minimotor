export interface RollbackApi {
    save<T>(step: number, state: T): void;
    load<T>(step: number): T | undefined;
    discardBefore(step: number): void;
    clear(): void;
}
export declare function createRollback(): RollbackApi;
