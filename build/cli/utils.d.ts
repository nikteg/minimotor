import { type SpawnOptions } from "node:child_process";
/** Quote a string for generated TypeScript. */
export declare const quote: (value: string) => string;
/** Build a string-literal union, including the correct empty union. */
export declare const union: (values: string[]) => string;
/** Emit a formatted string-union type alias. */
export declare const unionType: (name: string, values: string[]) => string;
/** Use a bare property when valid and quote every other property safely. */
export declare const property: (value: string) => string;
/** Emit a compact array, expanding it only when the generated line is long. */
export declare const array: (values: string[], indent?: string, prefixLength?: number) => string;
/** Emit an `as const` string array declaration. */
export declare const constArray: (name: string, values: string[]) => string;
/** Turn an arbitrary editor name into a safe TypeScript identifier. */
export declare const identifier: (value: string) => string;
/** Recursively list files in stable order. */
export declare function files(root: string): string[];
/** Read the value following a flag and remove both from an argument list. */
export declare function takeOption(args: string[], ...names: string[]): string | undefined;
/** Read and remove a boolean flag. */
export declare function takeFlag(args: string[], ...names: string[]): boolean;
export declare function numberOption(args: string[], fallback: number, ...names: string[]): number;
export declare function percentile(values: readonly number[], ratio: number): number;
/** Run a child tool with inherited terminal IO and fail on non-zero exit. */
export declare function run(command: string, args: readonly string[], options?: SpawnOptions): Promise<void>;
