// ---------- Layering ----------
// One folder per capability, and inside it exactly one file may know about the
// running app: `service.ts`. That single convention is what keeps the tree flat
// (no parallel `features/` mirror of `src/`) while still making the pure/bound
// boundary a real, checkable thing rather than a habit.
//
//   src/anim/       sheet.ts states.ts value.ts   ← pure, testable without a DOM
//                   service.ts                    ← createAnimation(app)
//
// Types are exempt everywhere: a pure module may NAME `App` (portals types its
// optional host as `Pick<App, "onStep" | "onDestroy">`) and one service may name
// another's api type, because injection is how services compose —
// `createUI(app, input)`, `createAutosave(app, snapshots, storage)`. What the
// rules forbid is a runtime edge: importing the app, or importing a sibling
// service's factory instead of accepting it as an argument.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "..");

function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" || entry === "__examples" ? [] : sources(path);
    }
    return entry.endsWith(".ts") ? [path] : [];
  });
}

interface Import {
  /** Module specifier as written, e.g. "../engine/app.js". */
  spec: string;
  /** Absolute path of the imported file, extension swapped back to .ts. */
  target: string;
  /** True when the statement can be erased at compile time. */
  typeOnly: boolean;
  /** Value bindings the statement pulls in, `*` for a namespace import. */
  bindings: string[];
}

/** Every `import`/`export ... from` in a file, tagged type-only or not. A
 *  statement is type-only when it says `import type`, or when every named
 *  specifier carries its own `type` prefix. */
function imports(file: string): Import[] {
  const source = readFileSync(file, "utf8");
  const pattern = /(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*"([^"]+)"/g;
  const found: Import[] = [];
  for (const [, typeKeyword, clause, spec] of source.matchAll(pattern)) {
    if (!spec.startsWith(".")) continue;
    const names = clause.slice(clause.indexOf("{") + 1, clause.lastIndexOf("}")).split(",");
    const braced = clause.includes("{") && !clause.replace(/\{[\s\S]*\}/, "").trim();
    found.push({
      spec,
      target: resolve(dirname(file), spec).replace(/\.js$/, ".ts"),
      typeOnly:
        Boolean(typeKeyword) ||
        (braced && names.every((name) => /^\s*type\s/.test(name) || !name.trim())),
      bindings: braced
        ? names
            .filter((name) => name.trim() && !/^\s*type\s/.test(name))
            .map((name) => name.trim().split(/\s+as\s+/)[0])
        : ["*"],
    });
  }
  return found;
}

const files = sources();
const rel = (path: string) => relative(SRC, path);
/** The app itself, the root barrel, and the Node-side CLI are not capabilities. */
const exempt = (path: string) =>
  rel(path).startsWith("engine/") || rel(path).startsWith("cli/") || rel(path) === "index.ts";

describe("layering", () => {
  it("finds the capability tree it is meant to police", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => rel(f).endsWith("/service.ts")).length).toBeGreaterThan(10);
    expect(files.some((f) => rel(f).startsWith("features/"))).toBe(false);
  });

  it("confines runtime knowledge of the app to service.ts", () => {
    const offenders = files
      .filter((file) => !exempt(file) && !file.endsWith("/service.ts"))
      .flatMap((file) =>
        imports(file)
          .filter((imp) => !imp.typeOnly && /engine\/(app|index)\.ts$/.test(imp.target))
          .map((imp) => `${rel(file)} imports values from ${imp.spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps services from reaching for each other at runtime", () => {
    const offenders = files
      .filter((file) => file.endsWith("/service.ts"))
      .flatMap((file) =>
        imports(file)
          .filter((imp) => !imp.typeOnly && imp.target.endsWith("/service.ts"))
          .map((imp) => `${rel(file)} imports values from ${imp.spec} — inject it instead`),
      );
    expect(offenders).toEqual([]);
  });

  it("gives every service.ts a capability directory of its own", () => {
    const strays = files
      .filter((file) => file.endsWith("/service.ts"))
      .filter((file) => dirname(file) === SRC)
      .map(rel);
    expect(strays).toEqual([]);
  });
});
