#!/usr/bin/env node
export type { CliFeature } from "./feature.js";
export { defineFeature } from "./feature.js";
/** Discover features and run the mm CLI. */
export declare function main(args?: string[]): Promise<void>;
