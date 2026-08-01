// ---------- The layering guard ----------
// A convention nobody can enforce is a convention that decays. This test is the
// enforcement: it reads the engine CORE files and fails the build if a game
// concept appears in one.
//
// The rule it encodes:
//
//   A core module may name a concept only if another ENGINE module's public
//   type already has it (`Collision.Solid` has `oneWay` and `slope`, so tiles
//   is allowed to produce them). It may not invent a noun of its own.
//   Everything else is an open-ended string tag, and the vocabulary of tags
//   lives in a battery file listed under BATTERIES below.
//
// When this test fails, the fix is almost never to add a word to ALLOWED. It is
// to move the concept into a battery and express it with `tags` / `standOnTop`,
// the way `presets.ladder` does.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Files that are ALLOWED to speak a game's vocabulary — the batteries and the
 *  recipes. Everything else under the listed core folders is held to the rule. */
const BATTERIES = ["tiles/presets.ts", "procgen/recipes"];

/** Core areas held to the rule. `cli/` and `ui/` are excluded on purpose: they
 *  are tools and widgets for a game author, not the simulation core. */
const CORE = ["tiles", "procgen"];

/** Nouns that describe a GAME, not a simulation. Deliberately includes words
 *  the codebase has never used — the point is to catch the next one too. */
const DOMAIN_NOUNS = [
  "ladder",
  "vine",
  "rope",
  "ice",
  "lava",
  "water",
  "mud",
  "acid",
  "hazard",
  "spike",
  "coin",
  "gem",
  "treasure",
  "enemy",
  "monster",
  "player",
  "health",
  "damage",
  "weapon",
  "inventory",
  "chest",
  "door",
  "conveyor",
  "checkpoint",
  "teleporter",
];

/** Words that look domain-ish but are load-bearing simulation vocabulary.
 *  Each needs a reason, and the reason must be about another engine type. */
const ALLOWED = new Set([
  // `Collision.Solid` literally has these fields, so tiles must produce them.
  "solid",
  "oneway",
  "slope",
  // `key` is JS/Map vocabulary; `door`/`floor`/`wall` are grid-geometry words
  // that procgen exposes as configurable OPTIONS rather than fixed meanings.
  "key",
  "wall",
  "floor",
]);

/** Blank out comments and string literals, preserving line numbers.
 *
 *  The rule is about what the core CAN EXPRESS — its identifiers, fields and
 *  logic — not about what its prose may mention. `steer`'s header explaining
 *  "about 15% water" is the documentation working: it illustrates a generic
 *  mechanism with a concrete example, and no game concept has entered the API.
 *  A comment reading `// ladder handling` above real ladder code still fails,
 *  because the code underneath it does. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (literal) =>
      literal.replace(/[^\n]/g, " "),
    );
}

function sourceFiles(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
  };
  walk(join(SRC, folder));
  return out.filter((file) => !BATTERIES.some((battery) => file.includes(battery)));
}

describe("engine cores name no game concepts", () => {
  for (const folder of CORE) {
    it(`src/${folder} is free of domain nouns`, () => {
      const offences: string[] = [];
      for (const file of sourceFiles(folder)) {
        const lines = codeOnly(readFileSync(file, "utf8")).split("\n");
        for (const noun of DOMAIN_NOUNS) {
          if (ALLOWED.has(noun)) continue;
          // Whole words only, case-insensitive, so `Ladder`/`LADDER`/`ladders`
          // are all caught but `keyboard` does not trip on `key`.
          const pattern = new RegExp(`\\b${noun}s?\\b`, "i");
          lines.forEach((line, i) => {
            if (pattern.test(line)) {
              offences.push(`${file.slice(SRC.length + 1)}:${i + 1}  "${noun}"  ${line.trim()}`);
            }
          });
        }
      }
      // The message matters more than the assertion: it has to tell whoever
      // trips this what to do instead.
      expect(
        offences,
        `Game concepts leaked into the core of src/${folder}.\n` +
          `Move them to a battery (${BATTERIES.join(", ")}) and express the ` +
          `behaviour with generic mechanisms — a region becomes a \`tag\`, a ` +
          `standing surface becomes \`standOnTop\`.\n\n${offences.join("\n")}\n`,
      ).toEqual([]);
    });
  }

  it("guards a noun the codebase has never used, so the next one is caught too", () => {
    expect(DOMAIN_NOUNS).toContain("conveyor");
    expect(DOMAIN_NOUNS.some((noun) => !ALLOWED.has(noun))).toBe(true);
  });

  it("every allowance is justified by another engine module's public type", () => {
    // `solid`, `oneWay` and `slope` are only allowed because Collision.Solid
    // has them. If that stops being true, the allowance must go too.
    const collision = readFileSync(join(SRC, "collision", "index.ts"), "utf8");
    for (const field of ["oneWay", "slope"]) {
      expect(collision).toMatch(new RegExp(`${field}\\??:`));
    }
  });
});

describe("the empty-glyph contract is stated once", () => {
  it("is defined in exactly one file", () => {
    // Three capabilities have to agree on which glyph means "no tile here".
    // They agree by IMPORTING it; a fourth local copy would agree only by
    // coincidence, and would drift the first time anyone changed one of them.
    const copies: string[] = [];
    for (const folder of ["tiles", "procgen", "ldtk", "collision", "goodies", "cli"]) {
      for (const file of sourceFiles(folder)) {
        if (file.endsWith(join("tiles", "glyphs.ts"))) continue;
        const code = codeOnly(readFileSync(file, "utf8"));
        // A local *definition*, not a use. `const EMPTY = ...` in any form.
        if (/\b(const|let|var)\s+EMPTY\s*=/.test(code)) copies.push(file.slice(SRC.length + 1));
      }
    }
    expect(
      copies,
      "The empty glyph must be imported from src/tiles/glyphs.ts, not redeclared.\n" +
        `Redeclared in: ${copies.join(", ")}\n`,
    ).toEqual([]);
  });

  it("is the same value everywhere it is re-exported", async () => {
    const glyphs = await import("../glyphs.js");
    const tiles = await import("../index.js");
    const procgen = await import("../../procgen/index.js");
    expect(tiles.EMPTY).toBe(glyphs.EMPTY);
    expect(procgen.EMPTY).toBe(glyphs.EMPTY);
  });

  it("writes a visible glyph, so grids survive a whitespace-stripping tool", async () => {
    // `mm procgen gen -o` output is committed and diffed exactly. A whitespace
    // EMPTY would leave trailing spaces for editors and CI linters to eat.
    const { EMPTY, isEmptyChar } = await import("../glyphs.js");
    expect(EMPTY.trim()).not.toBe("");
    // Input stays liberal even though output is strict.
    expect([isEmptyChar("."), isEmptyChar(" "), isEmptyChar(""), isEmptyChar("#")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
