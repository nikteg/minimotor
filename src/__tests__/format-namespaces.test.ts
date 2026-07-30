import { describe, expect, it } from "vitest";
import * as Anim from "../anim/index.js";
import * as Aseprite from "../aseprite/index.js";
import * as LDtk from "../ldtk/index.js";
import * as Tiles from "../tiles/index.js";

describe("format namespaces", () => {
  it("keeps authoring formats out of generic runtime namespaces", () => {
    expect(Aseprite.sheet).toBeTypeOf("function");
    expect(LDtk.world).toBeTypeOf("function");
    expect("aseprite" in Anim).toBe(false);
    expect("LDtk" in Tiles).toBe(false);
  });
});
