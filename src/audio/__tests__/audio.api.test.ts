import { describe, expect, it, vi } from "vitest";
import { Recipes, sfx, buses, master } from "../api.js";

describe("Audio.Recipes", () => {
  it("return plain, tweakable SfxSpec data", () => {
    const coin = Recipes.coin();
    expect(typeof coin).toBe("object");
    expect(coin.freq).toBe(988);
    // spreads like data:
    const tweaked = { ...Recipes.explosion(), ms: 400 };
    expect(tweaked.ms).toBe(400);
    expect(tweaked.noise).toBe(true);
    expect(() => JSON.stringify(coin)).not.toThrow();
  });
});

describe("Audio.sfx", () => {
  it("builds typed handles and drops pre-unlock plays with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = sfx({ jump: { shape: "square", freq: 880, ms: 90 } });
    expect(typeof s.jump.play).toBe("function");
    expect(s.jump.spec.freq).toBe(880);
    s.jump.play(); // locked (no gesture in jsdom, no AudioContext)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unlocks on the first gesture"));
    warn.mockRestore();
  });
});

describe("Audio buses", () => {
  it("default buses exist as stable knobs", () => {
    expect(buses.sfx.name).toBe("sfx");
    expect(buses.music.name).toBe("music");
    expect(typeof master.volume).toBe("number");
  });
});
