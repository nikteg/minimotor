// ---------- Project scaffolding CLI ----------
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFeature } from "../../cli/feature.js";
import { files, takeFlag } from "../../cli/utils.js";
const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../src/cli/__examples");
/** Package root of the minimotor this CLI is running out of (build/cli/features → ../../..). */
const minimotorRoot = resolve(here, "../../..");
/** The version of the minimotor this CLI is running out of. */
function ownVersion() {
    return JSON.parse(readFileSync(resolve(minimotorRoot, "package.json"), "utf8")).version;
}
/** Is this CLI running out of a source checkout rather than an installed copy? */
export function runningFromCheckout() {
    return !minimotorRoot.split(sep).includes("node_modules");
}
/**
 * What to write for the new project's `minimotor` dependency.
 *
 * The default is the published range, because that is what a generated project
 * should say for everyone who isn't hacking on the engine: it resolves from the
 * registry, it survives being committed and shared, and it doesn't encode a path
 * from the machine that ran the scaffold. Deciding this by sniffing whether the
 * CLI lives under `node_modules` guesses at intent and fails badly when it
 * guesses wrong — a stranger's project would point at a directory on someone
 * else's disk.
 *
 * `--link` is the explicit opt-in for engine development: `link:` rather than
 * `file:`, so edits to the checkout show up in the game without reinstalling.
 */
export function minimotorDependency(projectRoot, link = false) {
    if (!link)
        return `^${ownVersion()}`;
    const path = relative(projectRoot, minimotorRoot).split(sep).join("/");
    if (path === "")
        return "link:."; // scaffolded into the checkout itself
    // A sibling checkout gets the tidy `link:../minimotor`. Scaffolding somewhere
    // unrelated would otherwise produce a chain of `../` climbing to the root, so
    // past a couple of levels the absolute path is both shorter and clearer.
    const climbs = path.match(/^(\.\.\/)+/)?.[0].length ?? 0;
    if (climbs > 6)
        return `link:${minimotorRoot.split(sep).join("/")}`;
    return `link:${path.startsWith(".") ? path : `./${path}`}`;
}
const help = `Create a small Minimotor game

Usage:
  mm new <template> <directory> [--force] [--link]

Templates:
  minimal       Moving square and a fixed-step loop.
  platformer    Tile collision, movement, and jumping.
  multiplayer  Shared players with Net.game().
  physics      Opt-in Physics2D world and bodies.

Options:
  --force       Scaffold into a directory that is not empty.
  --link        Depend on THIS minimotor checkout (link:../minimotor) instead of
                the published package. For working on the engine and a game
                together; the default is the registry version.
`;
/** Template names come from directories, so adding an example adds a template. */
export function templateNames() {
    return readdirSync(examples, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
        .map((entry) => entry.name)
        .sort();
}
function readTemplate(directory) {
    return Object.fromEntries(files(directory).map((path) => [relative(directory, path), readFileSync(path, "utf8")]));
}
/**
 * Read the shared base and selected example directly from `__examples`, filling
 * the `{{name}}` and `{{minimotor}}` placeholders.
 */
export function templateFiles(template, name, minimotor = minimotorDependency(process.cwd(), false)) {
    if (!templateNames().includes(template))
        throw new Error(`unknown template "${template}"`);
    const sources = {
        ...readTemplate(resolve(examples, "_base")),
        ...readTemplate(resolve(examples, template)),
    };
    const fill = (source) => source.split("{{name}}").join(name).split("{{minimotor}}").join(minimotor);
    return Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, fill(source)]));
}
export default defineFeature({
    name: "new",
    summary: "Create minimal game projects from terse templates.",
    usage: ["mm new <template> <directory> [--force] [--link]"],
    run(input) {
        if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
            process.stdout.write(help);
            return;
        }
        const args = [...input];
        const force = takeFlag(args, "--force");
        const link = takeFlag(args, "--link");
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
        const minimotor = minimotorDependency(root, link);
        for (const [file, source] of Object.entries(templateFiles(template, name, minimotor))) {
            const path = resolve(root, file);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, source);
        }
        process.stdout.write(`created ${template} game in ${root} (minimotor ${minimotor})\n`);
        // Running from a checkout is the one case where the default might not be
        // what was meant, and where `pnpm install` fails outright if this version
        // isn't on the registry yet. Say so once instead of guessing.
        if (!link && runningFromCheckout()) {
            process.stdout.write(`note: depends on the published minimotor@${minimotor}; pass --link to use this checkout\n`);
        }
        process.stdout.write(`next: cd ${directory} && pnpm install && pnpm dev\n`);
        // The template ships an e2e suite, and Playwright needs its browser binaries
        // before `pnpm test` can run at all — a fresh machine fails with a wall of
        // ASCII art otherwise.
        process.stdout.write(`      then: npx playwright install chromium && pnpm test\n`);
    },
});
