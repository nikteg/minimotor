import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFeature } from "../feature.js";
import { takeFlag, takeOption } from "../utils.js";

/** Package root of the minimotor this CLI runs out of (build/cli/features → ../../..). */
const minimotorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const START = '<script type="importmap">';
const END = "</script>";

const help = `Generate the browser import map for a bundler-free game

Usage:
  mm importmap <html-file> [--engine-dir <dir>] [--check]

A game that serves raw tsc output has no bundler to rewrite bare specifiers, so
the browser must resolve \`import ... from "minimotor/audio"\` itself. Every
subpath the game imports therefore needs an import-map entry, and a missing one
is invisible to tsc — it resolves subpaths through node_modules at compile time,
then emits them unchanged, and the page dies at load with "Failed to resolve
module specifier".

This writes that map from minimotor's own \`exports\`, so it cannot drift from the
package. Subpaths with no file under --engine-dir are skipped: a web build
(tsconfig.web.json) drops the node-only entries, and mapping them would point at
404s. Replaces the existing <script type="importmap"> block, which must already
be in the HTML so its position stays the page's decision.

Options:
  --engine-dir  Where the compiled engine was written.
                Default: <html-dir>/minimotor
  --check       Exit non-zero if the block is out of date, changing nothing.
`;

/** The specifier → URL map, given where the engine was compiled to. */
export function buildImportMap(engineDir: string, urlPrefix: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(minimotorRoot, "package.json"), "utf8")) as {
    exports: Record<string, string | { default?: string }>;
  };
  const imports: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath.includes("*")) continue; // a wildcard has no single URL
    const file = typeof target === "string" ? target : target.default;
    if (!file) continue;
    // "./build/features/audio/index.js" → "features/audio/index.js". A web build
    // keeps rootDir: src, so its layout matches build/.
    const rel = file.replace(/^\.\/build\//, "");
    if (!existsSync(resolve(engineDir, rel))) continue;
    imports[subpath === "." ? "minimotor" : `minimotor/${subpath.slice(2)}`] = `${urlPrefix}${rel}`;
  }
  return imports;
}

export default defineFeature({
  name: "importmap",
  summary: "Write the browser import map for a game served without a bundler.",
  usage: ["mm importmap <html-file> [--engine-dir <dir>] [--check]"],
  run(input) {
    if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    const args = [...input];
    const check = takeFlag(args, "--check");
    const engineDirArg = takeOption(args, "--engine-dir");
    const htmlArg = args.shift();
    if (!htmlArg || args.length) throw new Error(help);

    const html = resolve(htmlArg);
    if (!existsSync(html)) throw new Error(`no such file: ${html}`);
    const engineDir = resolve(engineDirArg ?? resolve(dirname(html), "minimotor"));
    if (!existsSync(engineDir)) {
      throw new Error(
        `no such directory: ${engineDir} (build the engine first, or pass --engine-dir)`,
      );
    }

    // URLs are relative to the HTML file, which is what the browser resolves against.
    const prefix = relative(dirname(html), engineDir).split(sep).join("/");
    const imports = buildImportMap(engineDir, prefix ? `./${prefix}/` : "./");

    const source = readFileSync(html, "utf8");
    const from = source.indexOf(START);
    if (from === -1) {
      throw new Error(`no ${START} block in ${htmlArg} — add an empty one where it should live`);
    }
    const to = source.indexOf(END, from) + END.length;
    const block = `${START}\n${JSON.stringify({ imports }, null, 2)}\n${END}`;
    const next = source.slice(0, from) + block + source.slice(to);
    const count = Object.keys(imports).length;

    if (check) {
      if (next !== source) {
        throw new Error(`${htmlArg} import map is stale — run: mm importmap ${htmlArg}`);
      }
      process.stdout.write(`up to date: ${htmlArg} (${count} entries)\n`);
      return;
    }
    if (next === source) {
      process.stdout.write(`unchanged: ${htmlArg} (${count} entries)\n`);
      return;
    }
    writeFileSync(html, next);
    process.stdout.write(`wrote ${count} entries to ${htmlArg}\n`);
  },
});
