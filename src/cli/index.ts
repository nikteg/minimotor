#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CliFeature } from "./feature.js";

export type { CliFeature } from "./feature.js";
export { defineFeature } from "./feature.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const featureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "features");

async function features(): Promise<CliFeature[]> {
  const files = readdirSync(featureDirectory)
    .filter((file) => file.endsWith(".feature.js"))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      const module = (await import(pathToFileURL(resolve(featureDirectory, file)).href)) as {
        default?: CliFeature;
      };
      if (!module.default) throw new Error(`${file} does not export a default feature`);
      return module.default;
    }),
  );
}

function help(available: readonly CliFeature[]): string {
  const commands = available
    .map((feature) => `  ${feature.name.padEnd(12)} ${feature.summary}`)
    .join("\n");
  return `Minimotor developer tools

Usage:
  mm <feature> [command] [options]
  mm --help
  mm --version

Features:
${commands}

Run mm <feature> --help for feature-specific usage.
`;
}

/** Discover features and run the mm CLI. */
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === "-v" || args[0] === "--version") {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      version: string;
    };
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const available = await features();
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(help(available));
    return;
  }

  const feature = available.find((candidate) => candidate.name === args[0]);
  if (!feature) throw new Error(`unknown feature "${args[0]}"\n\n${help(available)}`);
  await feature.run(args.slice(1));
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  void main().catch((error: unknown) => {
    process.stderr.write(`mm: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
