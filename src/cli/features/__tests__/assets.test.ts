// ---------- Assets CLI tests ----------
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAssets } from "@src/cli/features/assets.js";

describe("mm assets check", () => {
  it("checks JSON, PNG dimensions, and source references", () => {
    const root = mkdtempSync(join(tmpdir(), "mm-assets-"));
    mkdirSync(join(root, "art"));
    const png = Buffer.alloc(24);
    png.write("PNG", 1);
    png.writeUInt32BE(17, 16);
    png.writeUInt32BE(16, 20);
    writeFileSync(join(root, "art", "hero.png"), png);
    writeFileSync(join(root, "level.json"), "{}");
    writeFileSync(
      join(root, "game.ts"),
      'new URL("./art/hero.png", import.meta.url);\nnew URL("./missing.wav", import.meta.url);\n',
    );

    expect(checkAssets(root, 16)).toEqual([
      {
        level: "warning",
        file: "art/hero.png",
        message: "17×16 is not a multiple of 16px",
      },
      {
        level: "error",
        file: "game.ts",
        message: "missing referenced asset ./missing.wav",
      },
    ]);
  });

  it("validates Aseprite frames, tags, and image references", () => {
    const root = mkdtempSync(join(tmpdir(), "mm-aseprite-"));
    writeFileSync(
      join(root, "hero.json"),
      JSON.stringify({
        frames: [{ frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 }],
        meta: {
          image: "missing.png",
          frameTags: [{ name: "idle", from: 0, to: 2 }],
        },
      }),
    );

    expect(checkAssets(root)).toEqual([
      {
        level: "error",
        file: "hero.json",
        message: "Aseprite tag 0 has an invalid name or frame range",
      },
      {
        level: "error",
        file: "hero.json",
        message: "missing Aseprite image missing.png",
      },
    ]);
  });
});
