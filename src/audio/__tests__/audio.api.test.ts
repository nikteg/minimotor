import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Recipes } from "@src/audio/recipes.js";
import { sfx, buses, master } from "@src/audio/surface.js";
import { tone } from "@src/audio/sfx.js";

// The spec → voice mapping is the interesting part of `Audio.sfx`; stub the
// synth itself so the assertions are about what was ASKED for, not WebAudio.
vi.mock("../sfx.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/audio/sfx.js")>()),
  tone: vi.fn(),
}));
const toneCalls = () => vi.mocked(tone).mock.calls.map(([o]) => o);

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

describe("Audio.sfx spec → voice", () => {
  // Every later test needs a sounded play, and the unlock is a one-way gesture
  // latch — the pre-unlock warning above has to happen first.
  beforeAll(() => window.dispatchEvent(new Event("pointerdown")));
  beforeEach(() => vi.mocked(tone).mockClear());

  it("gives a sweep its own window, separate from the envelope's release", () => {
    sfx({
      jump: { shape: "square", freq: { from: 280, to: 620, ms: 126 }, ms: 180, attackMs: 0 },
    }).jump.play();
    expect(toneCalls()[0]).toMatchObject({
      wave: "square",
      freq: { from: 280, to: 620, time: 0.126 },
      attack: 0,
      release: 0.18,
    });
  });

  it("keeps a stepped pitch on ONE voice, so the second note doesn't re-attack", () => {
    sfx({ coin: { freq: [{ hz: 660 }, { hz: 990, atMs: 70 }], ms: 180 } }).coin.play();
    expect(toneCalls()).toHaveLength(1);
    expect(toneCalls()[0]?.freq).toEqual([
      { value: 660, at: 0, curve: "step" },
      { value: 990, at: 0.07, curve: "step" },
    ]);
  });

  it("stretch scales the envelope, sweeps, keyframes and layer delays alike", () => {
    sfx({
      chime: {
        freq: [{ hz: 400 }, { hz: 800, atMs: 100 }],
        ms: 200,
        layers: [{ freq: { from: 100, to: 200, ms: 50 }, ms: 100, delayMs: 40 }],
      },
    }).chime.play({ stretch: 0.5 });
    const [lead, layer] = toneCalls();
    expect(lead?.release).toBe(0.1);
    expect(lead?.freq).toMatchObject([{ at: 0 }, { at: 0.05 }]);
    expect(layer).toMatchObject({ delay: 0.02, release: 0.05, freq: { time: 0.025 } });
  });

  it("rolls pitch jitter ONCE per play, so layered voices stay in tune", () => {
    const rolls = [0, 1];
    const random = vi.spyOn(Math, "random").mockImplementation(() => rolls.shift() ?? 0);
    sfx({ chord: { freq: 400, layers: [{ freq: 600 }] } }).chord.play({ pitch: [0.5, 2] });
    expect(toneCalls().map((o) => o.freq)).toEqual([200, 300]); // both at the 0.5 roll
    expect(random).toHaveBeenCalledTimes(1);
    random.mockRestore();
  });
});

describe("Audio buses", () => {
  it("default buses exist as stable knobs", () => {
    expect(buses.sfx.name).toBe("sfx");
    expect(buses.music.name).toBe("music");
    expect(typeof master.volume).toBe("number");
  });
});
