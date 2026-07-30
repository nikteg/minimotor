import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFeature } from "../feature.js";
import { files, takeFlag } from "../utils.js";

const examples = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/cli/__examples");

const help = `Create a small Minimotor game

Usage:
  mm new <template> <directory> [--force]

Templates:
  minimal       Moving square and a fixed-step loop.
  platformer    Tile collision, movement, and jumping.
  multiplayer  Shared players with Net.game().
  physics      Opt-in Physics2D world and bodies.
`;

/** Template names come from directories, so adding an example adds a template. */
export function templateNames(): string[] {
  return readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function readTemplate(directory: string): Record<string, string> {
  return Object.fromEntries(
    files(directory).map((path) => [relative(directory, path), readFileSync(path, "utf8")]),
  );
}

/** Read the shared base and selected example directly from `__examples`. */
export function templateFiles(template: string, name: string): Record<string, string> {
  if (!templateNames().includes(template)) throw new Error(`unknown template "${template}"`);
  const sources = {
    ...readTemplate(resolve(examples, "_base")),
    ...readTemplate(resolve(examples, template)),
  };
  return Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [path, source.split("{{name}}").join(name)]),
  );
}

export default defineFeature({
  name: "new",
  summary: "Create minimal game projects from terse templates.",
  usage: ["mm new <template> <directory> [--force]"],
  run(input) {
    if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    const args = [...input];
    const force = takeFlag(args, "--force");
    const template = args.shift();
    const directory = args.shift();
    if (!template || !templateNames().includes(template) || !directory || args.length) {
      throw new Error(help);
    }
    const root = resolve(directory);
    if (existsSync(root) && readdirSync(root).length && !force) {
      throw new Error(`${root} is not empty; choose another directory or use --force`);
    }
    const name = basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");
    for (const [file, source] of Object.entries(templateFiles(template, name))) {
      const path = resolve(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    process.stdout.write(`created ${template} game in ${root}\n`);
    process.stdout.write(`next: cd ${directory} && pnpm install && pnpm dev\n`);
  },
});
