export interface InputContextApi {
    readonly active: string;
    set(name: string): void;
    is(name: string): boolean;
    within<T>(name: string, run: () => T): T;
}
export declare function createInputContext(initial?: string): InputContextApi;
