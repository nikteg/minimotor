# The `dist` branch

Generated. Every commit here is `tools/make-dist.mjs` run over a clean build of
`main`, pushed by `.github/workflows/publish-dist.yml`. **Do not commit to it by
hand** — the next push to `main` overwrites the tree, and a hand-written commit
also loses the race the workflow's concurrency group is there to prevent.

It is an orphan branch: no ancestor in common with `main`, so cloning or
fetching it does not drag the source history along, and `git log` here is a
list of builds rather than source commits with a 3 MB diff attached. The source
commit each build came from is in its message as `Source-Commit:`.

History is append-only and is never rewritten. Consumers pin a commit from here
in their lockfile — pnpm resolves the branch to a sha at install time and
records it — so a force-push would 404 somebody's pinned tarball.

## Using it

    "minimotor": "github:nikteg/minimotor#dist"

The branch carries no `prepare` script because `build/` is already here, so
there is no build for pnpm to ask permission to run. Updating is
`pnpm update minimotor`; the lockfile keeps the build pinned.
