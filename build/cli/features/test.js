// ---------- Browser testing CLI ----------
import { defineFeature } from "../../cli/feature.js";
import { run } from "../../cli/utils.js";
const help = `Run headless browser game tests

Usage:
  mm test [playwright options]

Examples:
  mm test
  mm test --grep "joins room"
  mm test --headed
  mm test --update-snapshots

Arguments are passed directly to Playwright Test.
`;
export default defineFeature({
    name: "test",
    summary: "Run headless Playwright game and screenshot tests.",
    usage: ["mm test [playwright options]"],
    async run(args) {
        if (args[0] === "-h" || args[0] === "--help") {
            process.stdout.write(help);
            return;
        }
        await run("playwright", ["test", ...args]);
    },
});
