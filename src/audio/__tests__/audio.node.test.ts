// @vitest-environment node
//
// Audio must be IMPORTABLE WITHOUT A DOM. Nothing here plays a sound — the
// point is that reaching for the types, the recipes or `createMusicChannel`
// from a server, a CLI feature or a node-environment test does not blow up on a
// top-level `document`/`window`/`AudioContext` access. A module-scope
// `document.addEventListener` in the music scheduler used to make this throw.
import { describe, it, expect } from "vitest";

describe("minimotor/audio under Node", () => {
  it("imports with no DOM present", async () => {
    expect(typeof document).toBe("undefined");
    const mod = await import("@src/audio/index.js");
    expect(typeof mod.createAudio).toBe("function");
    expect(typeof mod.createMusicChannel).toBe("function");
    expect(typeof mod.sample).toBe("function");
  });

  it("exposes the pure pieces a non-browser caller wants", async () => {
    const mod = await import("@src/audio/index.js");
    expect(mod.Recipes).toBeDefined();
    expect(typeof mod.Mixer.bus).toBe("function");
  });
});
