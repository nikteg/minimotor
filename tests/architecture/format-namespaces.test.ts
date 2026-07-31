// Cross-module public-surface architecture checks.
import { describe, expect, it } from "vitest";
import * as Anim from "@src/anim/index.js";
import * as Aseprite from "@src/aseprite/index.js";
import * as LDtk from "@src/ldtk/index.js";
import * as Tiles from "@src/tiles/index.js";

describe("format namespaces", () => {
  it("keeps authoring formats out of generic runtime namespaces", () => {
    expect(Aseprite.sheet).toBeTypeOf("function");
    expect(LDtk.world).toBeTypeOf("function");
    expect("aseprite" in Anim).toBe(false);
    expect("LDtk" in Tiles).toBe(false);
  });
});
