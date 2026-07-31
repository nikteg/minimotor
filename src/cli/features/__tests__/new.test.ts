// ---------- Project scaffolding CLI tests ----------
import { describe, expect, it } from "vitest";
import { templateFiles, templateNames } from "@src/cli/features/new.js";

describe("mm new", () => {
  it("builds complete templates", () => {
    expect(templateNames()).toEqual(["minimal", "multiplayer", "physics", "platformer"]);
    for (const template of templateNames()) {
      const files = templateFiles(template, "my-game");
      expect(Object.keys(files).sort()).toEqual([
        "e2e/game.spec.ts",
        "index.html",
        "package.json",
        "playwright.config.ts",
        "src/main.ts",
        "tsconfig.json",
      ]);
      expect(files["src/main.ts"]).toContain('from "minimotor"');
      expect(JSON.parse(files["package.json"]).name).toBe("my-game");
      expect(Object.values(files).join("\n")).not.toContain("{{name}}");
    }
  });
});
