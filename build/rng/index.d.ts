export interface Rng {
    seed: number;
    random(): number;
    integer(min: number, max: number): number;
    choose<T>(values: readonly T[]): T;
}
export declare function createRng(seed?: number): Rng;
