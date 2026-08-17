#!/usr/bin/env node

/** Assemble the tree that gets published to the `dist` branch.
 *
 * WHY THIS EXISTS AT ALL. minimotor's `prepare` compiles on install, and
 * `build/` is gitignored, so every consumer of the git dependency has to build
 * it. pnpm 11 will not run a dependency's build without an `allowBuilds`
 * approval, and that approval is keyed by the tarball URL — which embeds the
 * commit sha. So a consumer's version bump touched three files instead of two,
 * and pnpm's refusal names the OLD sha, which reads exactly like the pin not
 * having taken. A branch carrying prebuilt output has no `prepare`, so there is
 * nothing to approve and the third file goes away.
 *
 * WHY THE LAYOUT IS UNCHANGED. The obvious "improvement" is to publish the
 * CONTENTS of build/ at the branch root and rewrite `exports` from
 * `./build/ui/index.js` to `./ui/index.js`. Do not: consumers who symlink
 * node_modules/minimotor at a sibling source checkout for local development
 * (a consumer's link script does exactly this) would then resolve
 * a layout that only the installed copy has, and every import would break the
 * moment they linked. Keeping `build/` in the path is what makes the linked
 * checkout and the installed package interchangeable.
 *
 * WHY IT IS DRIVEN BY `files`. The payload is whatever npm would pack, so the
 * dist branch cannot drift from the published package by someone editing one
 * list and not the other.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const outFlag = process.argv.indexOf("--out");
if (outFlag === -1 || !process.argv[outFlag + 1]) {
  process.stderr.write("usage: node tools/make-dist.mjs --out <dir>\n");
  process.exit(2);
}
const out = resolve(process.argv[outFlag + 1]);
if (out === resolve(root)) {
  process.stderr.write("refusing to assemble over the checkout itself\n");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

/** `build/` is the whole point; assembling without it would publish a package
 * whose every export is a 404, and pnpm would install it without complaint. */
await readFile(join(root, "build", "index.js")).catch(() => {
  throw new Error("build/index.js is missing — run `pnpm build` first");
});

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of manifest.files) {
  const from = join(root, entry);
  const to = join(out, entry);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

/** Everything an install needs, and nothing that runs. Dropping `scripts`
 * wholesale rather than just `prepare` is deliberate: none of them can work
 * without devDependencies, and a lifecycle name added upstream later must not
 * silently become an install hook here. Dropping `devDependencies` removes the
 * `minimotor: link:.` self-reference along with the rest. */
const { scripts: _scripts, devDependencies: _devDependencies, ...distManifest } = manifest;

/** No source sha and no timestamp in here on purpose. Either would change on
 * every push to main even when the compiler produced identical bytes, and the
 * workflow's "nothing changed, nothing to publish" check is what keeps a
 * consumer's pin valid across commits that did not alter the build. Provenance
 * lives in the dist commit message, which costs nothing to carry. */
await writeFile(join(out, "package.json"), `${JSON.stringify(distManifest, null, 2)}\n`);

await writeFile(
  join(out, "DIST.md"),
  `# The \`dist\` branch

Generated. Every commit here is \`tools/make-dist.mjs\` run over a clean build of
\`main\`, pushed by \`.github/workflows/publish-dist.yml\`. **Do not commit to it by
hand** — the next push to \`main\` overwrites the tree, and a hand-written commit
also loses the race the workflow's concurrency group is there to prevent.

It is an orphan branch: no ancestor in common with \`main\`, so cloning or
fetching it does not drag the source history along, and \`git log\` here is a
list of builds rather than source commits with a 3 MB diff attached. The source
commit each build came from is in its message as \`Source-Commit:\`.

History is append-only and is never rewritten. Consumers pin a commit from here
in their lockfile — pnpm resolves the branch to a sha at install time and
records it — so a force-push would 404 somebody's pinned tarball.

## Using it

    "minimotor": "github:nikteg/minimotor#dist"

The branch carries no \`prepare\` script because \`build/\` is already here, so
there is no build for pnpm to ask permission to run. Updating is
\`pnpm update minimotor\`; the lockfile keeps the build pinned.
`,
);

process.stdout.write(`[make-dist] assembled ${manifest.files.join(", ")} into ${out}\n`);
