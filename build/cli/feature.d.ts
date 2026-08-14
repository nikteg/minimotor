/** One automatically discovered `mm` command namespace. */
export interface CliFeature {
    /** First command segment, for example `ldtk` in `mm ldtk types`. */
    readonly name: string;
    readonly summary: string;
    readonly usage: readonly string[];
    run(args: string[]): void | Promise<void>;
}
/** Type-check a feature definition without widening its literal metadata. */
export declare const defineFeature: <const T extends CliFeature>(feature: T) => T;
